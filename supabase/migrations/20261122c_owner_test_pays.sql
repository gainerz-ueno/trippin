-- 2026-11-22 運営者の試し電話（is_test）でもポイントを使う
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
  pays boolean;
  test boolean := coalesce((p->>'is_test')::boolean, false);
  t uuid;
begin
  if me is null or secret is null or char_length(secret) < 32 then return null; end if;
  owner := public.call_is_owner(me);
  if test and not owner then return null; end if;
  pays := not owner or test; -- 2026-11-22 運営者の試し電話もポイントを使う（減るかを確かめるため）
  perform pg_advisory_xact_lock(hashtext('call:' || me::text));
  if exists (select 1 from public.calls where user_id = me and status in ('calling', 'ringing', 'talking') and created_at > now() - interval '10 minutes') then
    return null;
  end if;
  if pays then
    if not owner then perform public.my_points(); end if;
    update public.points set balance = balance - 45, updated_at = now() where user_id = me and balance >= 45;
    if not found then return null; end if;
  end if;
  insert into public.calls (user_id, place_id, place_name, phone, lang, request, secret_hash, charged, is_test)
  values (me, left(coalesce(p->>'place_id', ''), 300), left(coalesce(p->>'place_name', ''), 200), p->>'phone', p->>'lang',
          coalesce(p->'request', '{}'::jsonb), encode(digest(secret, 'sha256'), 'hex'), pays, test)
  returning id into t;
  if pays then insert into public.point_log (user_id, delta, kind, ref) values (me, -45, 'call', t::text); end if;
  return t;
end;
$$;
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
  owner := public.call_is_owner(c.user_id) and not c.is_test; -- 試し電話は運営者もポイントを使う
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
