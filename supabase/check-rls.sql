-- Tabibi：Supabase の「自分のデータは自分だけ」の決まり（RLS）を確かめるためのSQL（読むだけ。何も変えない）
-- Supabase の管理画面 → SQL Editor に貼って Run すると、結果が表で出ます。
-- 期待する結果：
--   ① どの表も rls_enabled = true
--   ② items / settings / photos / shares / note_pages / guidebooks のどの決まりも、
--      条件（using / with_check）に auth.uid() = user_id が入っている
--   ③ storage の photos / guide の入れ物は public = false
--   ④ shared_folder / guidebook_view は security definer で、メモ（memo）・元の投稿（srcUrl）を返さない

-- ① 表ごとに RLS がオンになっているか
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- ② 決まり（ポリシー）の中身
select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

-- ③ 写真の入れ物が公開になっていないか
select id, public from storage.buckets order by id;

-- ④ だれでも呼べる関数の中身（共有リンク・公開eガイドブック・AIの回数）
select p.proname, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('shared_folder', 'guidebook_view', 'ai_credits_left', 'use_ai_credit', 'refund_ai_credit');
