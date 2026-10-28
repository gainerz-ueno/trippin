-- タビビコール（AIが現地語でお店に予約の電話をかける）：回数券の残り・電話の記録
-- 料金は1回300円（回数券）。決済（Stripe）を作るまでは、運営者が SQL Editor で回数を足す
-- Supabase の管理画面 → SQL Editor に全部貼って Run（何度流しても大丈夫な書き方にしてあります）

-- ① 回数券の残り。書けるのは運営者と下の関数だけ。本人は自分の行を読めるだけ
create table if not exists public.call_credits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);
alter table public.call_credits enable row level security;
drop policy if exists "call_credits_select_own" on public.call_credits;
create policy "call_credits_select_own" on public.call_credits for select to authenticated using (auth.uid() = user_id);
revoke all on public.call_credits from anon, authenticated;
grant select on public.call_credits to authenticated;
-- 例（運営者が手で回数を足す。決済を作ったら Stripe の知らせで足す）：
--   insert into public.call_credits (user_id, credits) values ('<ユーザーID>', 5)
--   on conflict (user_id) do update set credits = public.call_credits.credits + excluded.credits, updated_at = now();

-- ② 電話1回＝1行。本人は自分の行を読めるだけ（書くのは下の関数だけ）
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  place_id text not null default '' check (char_length(place_id) <= 300),
  place_name text not null default '' check (char_length(place_name) <= 200),
  phone text not null check (phone ~ '^\+[0-9]{6,16}$'),
  lang text not null check (lang in ('ko-KR', 'cmn-TW', 'vi-VN', 'ja-JP', 'en-US')),
  request jsonb not null default '{}'::jsonb,          -- 日時・人数・名前・ひとこと
  status text not null default 'calling'
    check (status in ('calling', 'ringing', 'talking', 'done', 'no_answer', 'busy', 'failed', 'canceled')),
  outcome text check (outcome in ('booked', 'declined', 'alternative', 'unclear')),
  result jsonb,                                        -- 結果（日本語の要約・決まった日時など）
  transcript jsonb,                                    -- 会話の記録（AIとお店のやり取り）
  call_sid text check (char_length(call_sid) <= 64),
  duration integer,
  secret_hash text not null,                           -- 電話の仕組み（Cloudflare）だけが知る合言葉のハッシュ
  charged boolean not null default true,               -- 回数を使ったか（つながらなかったら戻す）
  is_test boolean not null default false               -- 運営者のテスト（本物のお店にはかけない）
);
create index if not exists calls_user_time on public.calls (user_id, created_at desc);
alter table public.calls enable row level security;
drop policy if exists "calls_select_own" on public.calls;
create policy "calls_select_own" on public.calls for select to authenticated using (auth.uid() = user_id);
revoke all on public.calls from anon, authenticated;
grant select (id, created_at, updated_at, place_id, place_name, phone, lang, request, status, outcome, result, transcript, duration, charged, is_test)
  on public.calls to authenticated;

-- 運営者（動作確認用）。回数の制限なし・自分のスマホ（テスト番号）にもかけられる
create or replace function public.call_is_owner(p_uid uuid)
returns boolean language sql immutable as $$
  select p_uid = 'be07854d-c007-4404-85cd-fddc9867e5ff'::uuid;
$$;

-- 残り回数（画面に出す用）
create or replace function public.my_call_credits()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then null
    when public.call_is_owner(auth.uid()) then jsonb_build_object('left', 999, 'owner', true)
    else jsonb_build_object('left', coalesce((select credits from public.call_credits where user_id = auth.uid()), 0), 'owner', false) end;
$$;
revoke all on function public.my_call_credits() from public, anon;
grant execute on function public.my_call_credits() to authenticated;

-- 電話を始める：回数を1つ使って、電話の行を作る（残っていなければ null）
-- secret は電話の仕組み（Cloudflare）が作った合言葉。保存するのはハッシュだけ
create or replace function public.call_start(p jsonb, secret text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  me uuid := auth.uid();
  owner boolean;
  test boolean := coalesce((p->>'is_test')::boolean, false);
  t uuid;
begin
  if me is null or secret is null or char_length(secret) < 32 then return null; end if;
  owner := public.call_is_owner(me);
  if test and not owner then return null; end if;
  perform pg_advisory_xact_lock(hashtext('call:' || me::text));
  -- 同じ人が同時に何本もかけない（かけている途中の電話があれば止める）
  if exists (select 1 from public.calls where user_id = me and status in ('calling', 'ringing', 'talking') and created_at > now() - interval '10 minutes') then
    return null;
  end if;
  if not owner then
    update public.call_credits set credits = credits - 1, updated_at = now() where user_id = me and credits > 0;
    if not found then return null; end if;
  end if;
  insert into public.calls (user_id, place_id, place_name, phone, lang, request, secret_hash, charged, is_test)
  values (me, left(coalesce(p->>'place_id', ''), 300), left(coalesce(p->>'place_name', ''), 200), p->>'phone', p->>'lang',
          coalesce(p->'request', '{}'::jsonb), encode(digest(secret, 'sha256'), 'hex'), not owner, test)
  returning id into t;
  return t;
end;
$$;
revoke all on function public.call_start(jsonb, text) from public, anon;
grant execute on function public.call_start(jsonb, text) to authenticated;

-- 電話の仕組み（Cloudflare）から、途中経過と結果を書き込む（合言葉が合うときだけ）
-- つながらなかった（no_answer / busy / failed / canceled）ときは、回数を1つ戻す
create or replace function public.call_update(cid uuid, secret text, patch jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  c public.calls%rowtype;
  st text := patch->>'status';
begin
  select * into c from public.calls where id = cid for update;
  if not found or c.secret_hash <> encode(digest(coalesce(secret, ''), 'sha256'), 'hex') then return false; end if;
  -- 終わった電話は「話し中」などに戻さない
  if st is not null and c.status in ('done', 'no_answer', 'busy', 'failed', 'canceled') and st in ('calling', 'ringing', 'talking') then st := null; end if;
  if st is not null and st not in ('calling', 'ringing', 'talking', 'done', 'no_answer', 'busy', 'failed', 'canceled') then st := null; end if;
  update public.calls set
    status = coalesce(st, status),
    outcome = case when patch->>'outcome' in ('booked', 'declined', 'alternative', 'unclear') then patch->>'outcome' else outcome end,
    result = coalesce(patch->'result', result),
    transcript = coalesce(patch->'transcript', transcript),
    call_sid = coalesce(left(patch->>'call_sid', 64), call_sid),
    duration = coalesce((patch->>'duration')::integer, duration),
    updated_at = now()
  where id = cid;
  if st in ('no_answer', 'busy', 'failed', 'canceled') and c.charged then
    update public.calls set charged = false where id = cid;
    insert into public.call_credits (user_id, credits) values (c.user_id, 1)
    on conflict (user_id) do update set credits = public.call_credits.credits + 1, updated_at = now();
  end if;
  return true;
end;
$$;
revoke all on function public.call_update(uuid, text, jsonb) from public;
grant execute on function public.call_update(uuid, text, jsonb) to anon, authenticated;

-- 電話の仕組みが会話の前に読む（合言葉が合うときだけ。お店の名前・言語・予約の中身）
create or replace function public.call_brief(cid uuid, secret text)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object('place_name', place_name, 'lang', lang, 'request', request, 'is_test', is_test, 'status', status)
  from public.calls where id = cid and secret_hash = encode(digest(coalesce(secret, ''), 'sha256'), 'hex');
$$;
revoke all on function public.call_brief(uuid, text) from public;
grant execute on function public.call_brief(uuid, text) to anon, authenticated;

-- 数字の見方（運営者が SQL Editor で）：
--   電話の結果     select date_trunc('day', created_at) d, status, outcome, count(*) from public.calls group by 1,2,3 order by 1 desc;
--   回数を足す     上の ① の例
