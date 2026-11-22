-- 2026-11-22 社長決定：スクショからさがす3pt・お店の詳細1pt・AIのおすすめ1pt を足す
create or replace function public.point_cost(kind text)
returns integer language sql immutable as $$
  select case kind when 'search' then 2 when 'reviews' then 1 when 'details' then 1 when 'recommend' then 1
    when 'screenshot' then 3 when 'image' then 3 when 'call' then 45 else null end;
$$;
