-- Tabibi：ログイン対策3つ（同意の記録・ログイン失敗のロック・ログイン／設定変更の記録）
-- Supabase の管理画面 → SQL Editor に全部貼って Run（何度流しても大丈夫な書き方にしてあります）
-- 鍵（service_role）は使わない。表は直接さわれず、決まった関数だけで読み書きする

-- ① 利用規約・プライバシーポリシーへの同意（自分の行だけ）
create table if not exists public.consents (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  version text not null check (char_length(version) between 1 and 20),
  email text not null default '',
  accepted_at timestamptz not null default now()
);
alter table public.consents enable row level security;
drop policy if exists "consents_select_own" on public.consents;
create policy "consents_select_own" on public.consents for select to authenticated using (auth.uid() = user_id);
revoke all on public.consents from anon, authenticated;
grant select on public.consents to authenticated;

-- 同意を記録する。メールアドレスは、ログインしているアカウントのものを使う（画面から送られた値は使わない）
create or replace function public.record_consent(v text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
begin
  if auth.uid() is null then return false; end if;
  if v is null or char_length(v) not between 1 and 20 then return false; end if;
  select coalesce(u.email, '') into em from auth.users u where u.id = auth.uid();
  insert into public.consents (user_id, version, email, accepted_at) values (auth.uid(), v, em, now())
  on conflict (user_id) do update set version = excluded.version, email = excluded.email, accepted_at = now();
  return true;
end;
$$;
revoke all on function public.record_consent(text) from public;
grant execute on function public.record_consent(text) to authenticated;

-- ② 共通パスワードの失敗のロック：5回失敗したら30分
create table if not exists public.login_fails (
  k text primary key check (char_length(k) <= 64),
  n int not null default 0,
  last_at timestamptz not null default now(),
  until_at timestamptz
);
alter table public.login_fails enable row level security;
revoke all on public.login_fails from anon, authenticated;
-- 方針なし＝画面から直接は読み書きできない（下の関数だけ）

-- ロックが残っている秒数（0＝ロックなし）
create or replace function public.login_gate(key text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select greatest(0, ceil(extract(epoch from (f.until_at - now())))::int) from public.login_fails f where f.k = key and f.until_at is not null), 0);
$$;

-- 失敗を1回数える。返すのはロックが残っている秒数（0＝まだロックされていない）
-- 成功したときの「数え直し」は、外から呼べると悪用されるので作らない（最後の失敗から30分で自然に数え直す）
create or replace function public.login_fail(key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.login_fails;
begin
  if key is null or char_length(key) not between 8 and 64 then return 0; end if;
  delete from public.login_fails where last_at < now() - interval '1 day';
  select * into r from public.login_fails where k = key for update;
  if not found then
    insert into public.login_fails (k, n, last_at) values (key, 1, now());
    return 0;
  end if;
  if r.until_at is not null and r.until_at > now() then
    return ceil(extract(epoch from (r.until_at - now())))::int;
  end if;
  if now() - r.last_at >= interval '30 minutes' then r.n := 0; end if;
  r.n := r.n + 1;
  if r.n >= 5 then
    update public.login_fails set n = 0, last_at = now(), until_at = now() + interval '30 minutes' where k = key;
    return 1800;
  end if;
  update public.login_fails set n = r.n, last_at = now(), until_at = null where k = key;
  return 0;
end;
$$;
revoke all on function public.login_gate(text) from public;
revoke all on function public.login_fail(text) from public;
grant execute on function public.login_gate(text) to anon, authenticated;
grant execute on function public.login_fail(text) to anon, authenticated;

-- ③ ログイン・設定変更の記録（メールを送るかどうかの判断にも使う）
create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('login', 'share_create', 'share_delete', 'guide_publish')),
  device text not null default '' check (char_length(device) <= 80),
  mailed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists security_events_user on public.security_events (user_id, kind, created_at desc);
alter table public.security_events enable row level security;
drop policy if exists "security_events_select_own" on public.security_events;
create policy "security_events_select_own" on public.security_events for select to authenticated using (auth.uid() = user_id);
revoke all on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

-- 記録する。同じ種類が10分以内にあれば記録せず null を返す（＝メールも送らない。連打で迷惑メールにならないように）
create or replace function public.log_security_event(k text, dev text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  nid bigint;
begin
  if auth.uid() is null then return null; end if;
  if k not in ('login', 'share_create', 'share_delete', 'guide_publish') then return null; end if;
  if exists (select 1 from public.security_events e where e.user_id = auth.uid() and e.kind = k and e.created_at > now() - interval '10 minutes') then
    return null;
  end if;
  insert into public.security_events (user_id, kind, device) values (auth.uid(), k, left(coalesce(dev, ''), 80)) returning id into nid;
  return nid;
end;
$$;

create or replace function public.mark_security_event_mailed(eid bigint)
returns boolean
language sql
security definer
set search_path = public
as $$
  with u as (update public.security_events set mailed = true where id = eid and user_id = auth.uid() returning 1)
  select exists (select 1 from u);
$$;
revoke all on function public.log_security_event(text, text) from public;
revoke all on function public.mark_security_event_mailed(bigint) from public;
grant execute on function public.log_security_event(text, text) to authenticated;
grant execute on function public.mark_security_event_mailed(bigint) to authenticated;
