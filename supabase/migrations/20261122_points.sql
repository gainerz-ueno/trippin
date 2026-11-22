-- Tabibi のポイント制（2026-11-22 社長決定）
-- ・ポイントを買って使う（月額なし）。1000円＝150ポイント
-- ・お店の検索 2pt／口コミを見る 1pt／AIで画像を作る 3pt／タビビコール 45pt（3分ごと）
-- ・はじめての人にお試し10ポイント
-- ・運営者のアカウントは使い放題（動作確認のため。call_is_owner と同じ人）
-- 減らす・戻す・足すは、すべてこのファイルの関数を通す（画面から直接書き換えられないように、表は読むだけにする）

create table if not exists public.points (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  trial_given boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.points enable row level security;
drop policy if exists "points_select_own" on public.points;
create policy "points_select_own" on public.points for select to authenticated using (auth.uid() = user_id);
revoke all on public.points from anon, authenticated;
grant select on public.points to authenticated;

-- 使った・戻した・買ったの記録（1行＝1回）
create table if not exists public.point_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  kind text not null,          -- trial / buy / search / reviews / image / call / refund
  ref text,                    -- 戻したときの元の記録・買ったときの注文番号など
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists point_log_user on public.point_log (user_id, created_at desc);
alter table public.point_log enable row level security;
drop policy if exists "point_log_select_own" on public.point_log;
create policy "point_log_select_own" on public.point_log for select to authenticated using (auth.uid() = user_id);
revoke all on public.point_log from anon, authenticated;
grant select on public.point_log to authenticated;

-- ポイントの注文（Stripe の決済画面）。書くのはサーバー（管理用の鍵）だけ
create table if not exists public.point_orders (
  id text primary key,                 -- Stripe の Checkout Session の番号
  user_id uuid not null references auth.users(id) on delete cascade,
  points integer not null check (points > 0),
  amount integer not null check (amount > 0), -- 円
  status text not null default 'open', -- open / paid / expired
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists point_orders_user on public.point_orders (user_id, created_at desc);
alter table public.point_orders enable row level security;
drop policy if exists "point_orders_select_own" on public.point_orders;
create policy "point_orders_select_own" on public.point_orders for select to authenticated using (auth.uid() = user_id);
revoke all on public.point_orders from anon, authenticated;
grant select on public.point_orders to authenticated;

-- 使うポイント（ここだけで決める）
create or replace function public.point_cost(kind text)
returns integer language sql immutable as $$
  select case kind when 'search' then 2 when 'reviews' then 1 when 'image' then 3 when 'call' then 45 else null end;
$$;

-- 残りのポイント（はじめての人には、ここでお試し10ポイントを付ける）
create or replace function public.my_points()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b integer;
begin
  if me is null then return null; end if;
  if public.call_is_owner(me) then return jsonb_build_object('balance', 9999, 'owner', true); end if;
  insert into public.points (user_id, balance, trial_given) values (me, 10, true)
  on conflict (user_id) do nothing;
  if found then
    insert into public.point_log (user_id, delta, kind) values (me, 10, 'trial');
  end if;
  select balance into b from public.points where user_id = me;
  return jsonb_build_object('balance', coalesce(b, 0), 'owner', false,
    'cost', jsonb_build_object('search', 2, 'reviews', 1, 'image', 3, 'call', 45));
end;
$$;
revoke all on function public.my_points() from public, anon;
grant execute on function public.my_points() to authenticated;

-- ポイントを使う：足りれば減らして記録の番号（ticket）を返す。足りなければ null。運営者は減らさず 'owner'
create or replace function public.points_spend(kind text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c integer := public.point_cost(kind);
  t uuid;
begin
  if me is null or c is null or kind = 'call' then return null; end if; -- 電話は call_start / call_extend で減らす
  if public.call_is_owner(me) then return 'owner'; end if;
  perform public.my_points(); -- 行がなければお試しを付ける
  update public.points set balance = balance - c, updated_at = now() where user_id = me and balance >= c;
  if not found then return null; end if;
  insert into public.point_log (user_id, delta, kind) values (me, -c, kind) returning id into t;
  return t::text;
end;
$$;
revoke all on function public.points_spend(text) from public, anon;
grant execute on function public.points_spend(text) to authenticated;

-- うまくいかなかったときに戻す（本人の、10分以内の、まだ戻していない記録だけ）
create or replace function public.points_refund(ticket text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  l public.point_log;
begin
  if me is null or ticket is null or ticket !~ '^[0-9a-f-]{36}$' then return false; end if;
  select * into l from public.point_log where id = ticket::uuid and user_id = me and delta < 0 and not refunded
    and kind in ('search', 'reviews', 'image') and created_at > now() - interval '10 minutes' for update;
  if not found then return false; end if;
  update public.point_log set refunded = true where id = l.id;
  update public.points set balance = balance - l.delta, updated_at = now() where user_id = me;
  insert into public.point_log (user_id, delta, kind, ref) values (me, -l.delta, 'refund', l.id::text);
  return true;
end;
$$;
revoke all on function public.points_refund(text) from public, anon;
grant execute on function public.points_refund(text) to authenticated;

-- 買ったポイントを足す（サーバーが Stripe で支払い済みを確かめてから、管理用の鍵で呼ぶ。同じ注文は1回だけ）
create or replace function public.points_grant(order_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o public.point_orders;
begin
  select * into o from public.point_orders where id = order_id for update;
  if not found or o.status = 'paid' then return false; end if;
  update public.point_orders set status = 'paid', paid_at = now() where id = o.id;
  insert into public.points (user_id, balance) values (o.user_id, o.points)
  on conflict (user_id) do update set balance = public.points.balance + excluded.balance, updated_at = now();
  insert into public.point_log (user_id, delta, kind, ref) values (o.user_id, o.points, 'buy', o.id);
  return true;
end;
$$;
revoke all on function public.points_grant(text) from public, anon, authenticated;
grant execute on function public.points_grant(text) to service_role;

-- ---- タビビコールもポイントで（3分ごとに45ポイント）----
-- 画面に出す残り（今までの my_call_credits と同じ形。left は電話の回数＝3分の区切りの数）
create or replace function public.my_call_credits()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare p jsonb;
begin
  if auth.uid() is null then return null; end if;
  if public.call_is_owner(auth.uid()) then return jsonb_build_object('left', 999, 'owner', true, 'points', 9999); end if;
  p := public.my_points();
  return jsonb_build_object('left', (p->>'balance')::int / 45, 'owner', false, 'points', (p->>'balance')::int);
end;
$$;
revoke all on function public.my_call_credits() from public, anon;
grant execute on function public.my_call_credits() to authenticated;

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
  if exists (select 1 from public.calls where user_id = me and status in ('calling', 'ringing', 'talking') and created_at > now() - interval '10 minutes') then
    return null;
  end if;
  if not owner then
    perform public.my_points();
    update public.points set balance = balance - 45, updated_at = now() where user_id = me and balance >= 45;
    if not found then return null; end if;
  end if;
  insert into public.calls (user_id, place_id, place_name, phone, lang, request, secret_hash, charged, is_test)
  values (me, left(coalesce(p->>'place_id', ''), 300), left(coalesce(p->>'place_name', ''), 200), p->>'phone', p->>'lang',
          coalesce(p->'request', '{}'::jsonb), encode(digest(secret, 'sha256'), 'hex'), not owner, test)
  returning id into t;
  if not owner then insert into public.point_log (user_id, delta, kind, ref) values (me, -45, 'call', t::text); end if;
  return t;
end;
$$;
revoke all on function public.call_start(jsonb, text) from public, anon;
grant execute on function public.call_start(jsonb, text) to authenticated;

-- つながらなかったときに戻す・3分を過ぎたら続ける：ポイントで
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
    update public.calls set charged = false, tickets = 0 where id = cid;
    -- つながらなかった：使ったポイント（45×区切りの数）を戻す
    insert into public.points (user_id, balance) values (c.user_id, 45 * greatest(c.tickets, 1))
    on conflict (user_id) do update set balance = public.points.balance + excluded.balance, updated_at = now();
    insert into public.point_log (user_id, delta, kind, ref) values (c.user_id, 45 * greatest(c.tickets, 1), 'refund', cid::text);
  end if;
  return true;
end;
$$;
revoke all on function public.call_update(uuid, text, jsonb) from public;
grant execute on function public.call_update(uuid, text, jsonb) to anon, authenticated;

-- 3分を過ぎたら、もう1枚チケットを使って話を続ける（電話の仕組みから。合言葉が合うときだけ）
-- use = false：使わずに「まだ残っているか」だけ答える（締めくくりを始めるかどうかの判断）
-- use = true ：1枚使う。残っていなければ false（＝電話を切る）
create or replace function public.call_extend(cid uuid, secret text, use boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  c public.calls%rowtype;
  owner boolean;
begin
  select * into c from public.calls where id = cid and secret_hash = encode(digest(coalesce(secret, ''), 'sha256'), 'hex') for update;
  if not found or c.status not in ('calling', 'ringing', 'talking') or c.tickets >= 10 then return false; end if;
  owner := public.call_is_owner(c.user_id);
  if not use then
    return owner or coalesce((select balance from public.points where user_id = c.user_id), 0) >= 45;
  end if;
  if not owner then
    update public.points set balance = balance - 45, updated_at = now() where user_id = c.user_id and balance >= 45;
    if not found then return false; end if;
    insert into public.point_log (user_id, delta, kind, ref) values (c.user_id, -45, 'call', cid::text);
  end if;
  update public.calls set tickets = tickets + 1, updated_at = now() where id = cid;
  return true;
end;
$$;
revoke all on function public.call_extend(uuid, text, boolean) from public;
grant execute on function public.call_extend(uuid, text, boolean) to anon, authenticated;


-- 今までの回数券（call_credits）が残っている人は、1枚＝45ポイントに置きかえる（1回だけ）
insert into public.points (user_id, balance)
select user_id, credits * 45 from public.call_credits where credits > 0
on conflict (user_id) do update set balance = public.points.balance + excluded.balance, updated_at = now();
update public.call_credits set credits = 0, updated_at = now() where credits > 0;
