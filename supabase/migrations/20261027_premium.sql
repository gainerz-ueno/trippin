-- Tabibi：プレミアム（予定）・「AIで作る」の回数・有料のeガイドブック・わからないことを測る記録
-- 数字の根拠は docs/マネタイズ根拠.md。app/lib/plan.js の数字と必ず同じにする
-- Supabase の管理画面 → SQL Editor に全部貼って Run（何度流しても大丈夫な書き方にしてあります）
-- 流す前に：この SQL は guidebook_view を作り直します（有料のページを返さないため）

-- ① どのプランか（サーバー側の切り替え）。書けるのは運営者だけ（SQL Editor／service role）。本人は自分の行を読めるだけ
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'premium_month', 'premium_year')),
  started_at timestamptz not null default now(),
  until timestamptz,                       -- この日時を過ぎたら無料に戻る（null＝期限なし）
  note text check (char_length(note) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.entitlements enable row level security;
drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own" on public.entitlements for select to authenticated using (auth.uid() = user_id);
revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;
-- 例（運営者が手で切り替える。決済を作ったら Stripe の知らせで書き換える）：
--   insert into public.entitlements (user_id, plan, until) values ('<ユーザーID>', 'premium_month', now() + interval '1 month')
--   on conflict (user_id) do update set plan = excluded.plan, until = excluded.until, started_at = now(), updated_at = now();

-- ② 「AIで作る」を使った記録（1回＝1行。うまく描けなかったら refunded = true で回数を戻す）
create table if not exists public.ai_uses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  refunded boolean not null default false
);
create index if not exists ai_uses_user_time on public.ai_uses (user_id, created_at);
alter table public.ai_uses enable row level security;
drop policy if exists "ai_uses_select_own" on public.ai_uses;
create policy "ai_uses_select_own" on public.ai_uses for select to authenticated using (auth.uid() = user_id);
revoke all on public.ai_uses from anon, authenticated;
grant select on public.ai_uses to authenticated;

-- ③ 回数の決まり：無料＝合計1回／月払い＝毎月10回（日本時間の1日から）／年払い＝1年で87回（app/lib/plan.js と同じ）
create or replace function public.ai_quota_of(p_uid uuid)
returns table (plan text, lim integer, used integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public.entitlements%rowtype;
  since timestamptz;
begin
  select * into e from public.entitlements x where x.user_id = p_uid;
  if not found or e.plan = 'free' or (e.until is not null and e.until < now()) then
    plan := 'free'; lim := 1; since := '-infinity';
  elsif e.plan = 'premium_month' then
    plan := e.plan; lim := 10;
    since := greatest(e.started_at, date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo');
  else
    plan := e.plan; lim := 87;
    since := greatest(e.started_at, coalesce(e.until, now()) - interval '1 year');
  end if;
  select count(*) into used from public.ai_uses u where u.user_id = p_uid and not u.refunded and u.created_at >= since;
  return next;
end;
$$;
revoke all on function public.ai_quota_of(uuid) from public, anon, authenticated;

-- いまのプランと残り回数（画面に出す用）
create or replace function public.my_plan()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then null else
    (select jsonb_build_object('plan', q.plan, 'limit', q.lim, 'used', q.used, 'left', greatest(0, q.lim - q.used))
     from public.ai_quota_of(auth.uid()) q) end;
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- 1回使う（残っていなければ null）。同じ人が同時に押しても数えまちがえないように、その人だけ順番待ちにする
create or replace function public.ai_quota_use()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  q record;
  t uuid;
begin
  if me is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || me::text));
  select * into q from public.ai_quota_of(me);
  if q.used >= q.lim then return null; end if;
  insert into public.ai_uses (user_id) values (me) returning id into t;
  return t;
end;
$$;
revoke all on function public.ai_quota_use() from public, anon;
grant execute on function public.ai_quota_use() to authenticated;

-- うまく描けなかったときに戻す（自分の分だけ）
create or replace function public.ai_quota_refund(ticket uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  with r as (
    update public.ai_uses set refunded = true
    where id = ticket and user_id = auth.uid() and not refunded
    returning 1
  ) select exists (select 1 from r);
$$;
revoke all on function public.ai_quota_refund(uuid) from public, anon;
grant execute on function public.ai_quota_refund(uuid) to authenticated;

-- ④ 有料のeガイドブック：値段（0＝無料。有料は100〜50,000円＝note の有料記事と同じ範囲）と、無料で見せるページ数
alter table public.guidebooks add column if not exists price integer not null default 0;
alter table public.guidebooks add column if not exists free_pages integer not null default 0;
alter table public.guidebooks drop constraint if exists guidebooks_price_range;
alter table public.guidebooks add constraint guidebooks_price_range check (price = 0 or price between 100 and 50000);
alter table public.guidebooks drop constraint if exists guidebooks_free_pages_range;
alter table public.guidebooks add constraint guidebooks_free_pages_range check (free_pages between 0 and 60);

-- 読むページ（/g/…）：公開しているものだけ。有料のときは、表紙と無料のページまでしか返さない（作った本人は全部）
drop function if exists public.guidebook_view(text);
create function public.guidebook_view(gid text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select * from public.guidebooks where id = gid and published limit 1
  ), pg as (
    select e.ord, p.path
    from g
    cross join lateral jsonb_array_elements_text(to_jsonb(g.page_ids)) with ordinality as e(pid, ord)
    join public.note_pages p on p.id::text = e.pid and p.user_id = g.user_id
  ), shown as (
    select pg.* from pg, g
    where g.price = 0 or g.user_id = auth.uid() or pg.ord <= g.free_pages
  )
  select case when not exists (select 1 from g) then null else (
    select jsonb_build_object(
      'title', g.title, 'author', g.author, 'description', g.description,
      'price', g.price, 'free_pages', g.free_pages,
      'total_pages', (select count(*) from pg),
      'locked', (select count(*) from shown) < (select count(*) from pg),
      'cover', (select p.path from public.note_pages p where p.id::text = g.cover_id::text and p.user_id = g.user_id),
      'pages', coalesce((select jsonb_agg(path order by ord) from shown), '[]'::jsonb)
    ) from g) end;
$$;
revoke all on function public.guidebook_view(text) from public;
grant execute on function public.guidebook_view(text) to anon, authenticated;

-- ⑤ わからないことを測る記録（docs/マネタイズ根拠.md の「わからないこと」）
--    決まった名前だけ。ログインしている人は「1人・1日・1つの出来事」につき1回だけ数える（同じ人が何回押しても1）
create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  name text not null check (name ~ '^[a-z_]{1,40}$'),
  detail text not null default '' check (char_length(detail) <= 40),
  day date not null default ((now() at time zone 'Asia/Tokyo')::date),
  created_at timestamptz not null default now()
);
create unique index if not exists events_once_a_day on public.events (user_id, name, detail, day) where user_id is not null;
create index if not exists events_name_day on public.events (name, day);
alter table public.events enable row level security;
-- 読み書きの決まりは作らない（だれも直接は読めない・書けない。書くのは下の関数だけ、読むのは運営者が SQL Editor で）
revoke all on public.events from anon, authenticated;

create or replace function public.log_event(ev text, detail text default '')
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if log_event.ev not in ('search', 'add_place', 'localname', 'ai_recommend', 'ai_quota_hit', 'prem_sheet', 'prem_interest',
                'guide_paid_set', 'guide_locked_view', 'guide_buy_interest', 'tpl_pick', 'share_create',
                'souvenir_add', 'sv_cap_hit', 'sv_mark') then
    return;
  end if;
  insert into public.events (user_id, name, detail)
  values (auth.uid(), log_event.ev, left(coalesce(log_event.detail, ''), 40))
  on conflict (user_id, name, detail, day) where user_id is not null do nothing;
end;
$$;
revoke all on function public.log_event(text, text) from public;
grant execute on function public.log_event(text, text) to anon, authenticated;

-- 数字の見方（運営者が SQL Editor で）：
--   日ごとの人数      select day, name, detail, count(*) from public.events group by 1,2,3 order by 1 desc, 2;
--   プレミアムの人数  select plan, count(*) from public.entitlements where until is null or until > now() group by 1;
--   AIの使われ方      select date_trunc('day', created_at) d, count(*) filter (where not refunded) from public.ai_uses group by 1 order by 1 desc;
