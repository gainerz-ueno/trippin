-- Tabibi：お土産（souvenirs）と 1日の回る順番（trip_plans）の表、共有リンク用の関数（shared_extras）
-- Supabase の管理画面 → SQL Editor に全部貼って Run（何度流しても大丈夫な書き方にしてあります）
-- 決まりはほかの表と同じ：「自分の行だけ読める・書ける」（auth.uid() = user_id）

-- ① お土産：1つ＝1行。data に名前・買ったお店・値段・写真（小さくしたもの）・メモ・「買ってよかった」が入る
create table if not exists public.souvenirs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  trip text not null default '' check (char_length(trip) <= 60),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 300000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists souvenirs_user_trip on public.souvenirs (user_id, trip);

-- ② 1日の回る順番：旅（フォルダ）ごとに1行。data に日ごとの行き先の順番が入る
create table if not exists public.trip_plans (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip text not null check (char_length(trip) between 1 and 60),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, trip)
);

-- ③ RLS（自分の行だけ）
alter table public.souvenirs enable row level security;
alter table public.trip_plans enable row level security;

drop policy if exists "souvenirs_select_own" on public.souvenirs;
drop policy if exists "souvenirs_insert_own" on public.souvenirs;
drop policy if exists "souvenirs_update_own" on public.souvenirs;
drop policy if exists "souvenirs_delete_own" on public.souvenirs;
create policy "souvenirs_select_own" on public.souvenirs for select to authenticated using (auth.uid() = user_id);
create policy "souvenirs_insert_own" on public.souvenirs for insert to authenticated with check (auth.uid() = user_id);
create policy "souvenirs_update_own" on public.souvenirs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "souvenirs_delete_own" on public.souvenirs for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "trip_plans_select_own" on public.trip_plans;
drop policy if exists "trip_plans_insert_own" on public.trip_plans;
drop policy if exists "trip_plans_update_own" on public.trip_plans;
drop policy if exists "trip_plans_delete_own" on public.trip_plans;
create policy "trip_plans_select_own" on public.trip_plans for select to authenticated using (auth.uid() = user_id);
create policy "trip_plans_insert_own" on public.trip_plans for insert to authenticated with check (auth.uid() = user_id);
create policy "trip_plans_update_own" on public.trip_plans for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trip_plans_delete_own" on public.trip_plans for delete to authenticated using (auth.uid() = user_id);

revoke all on public.souvenirs from anon;
revoke all on public.trip_plans from anon;
grant select, insert, update, delete on public.souvenirs to authenticated;
grant select, insert, update, delete on public.trip_plans to authenticated;

-- ④ 共有リンク（/s/…）で見せる「回る順番」と「お土産」
--    共有しているフォルダの分だけを返す。宿泊先（hotel）は返さない（泊まっている場所を他人に見せない）
create or replace function public.shared_extras(share_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.user_id is null then null else jsonb_build_object(
    'plan', (
      select p.data - 'hotel'
      from public.trip_plans p
      where p.user_id = s.user_id and p.trip = s.folder
    ),
    'souvenirs', coalesce((
      select jsonb_agg(v.data order by v.created_at)
      from public.souvenirs v
      where v.user_id = s.user_id and v.trip = s.folder
    ), '[]'::jsonb)
  ) end
  from (select sh.user_id, sh.folder from public.shares sh where sh.id = share_id limit 1) s;
$$;
revoke all on function public.shared_extras(text) from public;
grant execute on function public.shared_extras(text) to anon, authenticated;
