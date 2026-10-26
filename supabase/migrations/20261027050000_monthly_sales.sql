-- รายงานสิ้นเดือน: monthly_sales(p_month) — ยอดขายรวมรายเดือน + แยกรายวัน (วันตามเวลาไทย)
-- สูตรของร้าน (mine/recipe.md) · เฉพาะพนักงาน/เจ้าของ · ใช้กติกานับยอดเดียวกับ sales_summary ทุกวันของเดือนรวมกัน (ไม่มีกติกาที่สองให้ตัวเลขไม่ตรงกัน) · ยังไม่คิด VAT (กฎร้านข้อ 2)

create function public.monthly_sales(p_month date default ((now() at time zone 'Asia/Bangkok')::date))
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_first date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Bangkok')::date))::date;
  v_result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'staff' then
    raise exception 'forbidden: เฉพาะพนักงานหรือเจ้าของร้านเท่านั้นที่ดูรายงานสิ้นเดือนได้';
  end if;

  with d as (
    select g::date as day, public.sales_summary(g::date) as s
      from generate_series(v_first, (v_first + interval '1 month - 1 day')::date, interval '1 day') g
  )
  select jsonb_build_object(
    'month', to_char(v_first, 'YYYY-MM'),
    'days', count(*)::int,
    'bills', coalesce(sum((s ->> 'bills')::int), 0)::int,
    'revenue', coalesce(sum((s ->> 'revenue')::int), 0)::int,
    'cups', coalesce(sum((s ->> 'cups')::int), 0)::int,
    'by_day', jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'bills', (s ->> 'bills')::int,
                                           'revenue', (s ->> 'revenue')::int, 'cups', (s ->> 'cups')::int) order by day)
  ) into v_result from d;
  return v_result;
end $$;

revoke all on function public.monthly_sales(date) from public, anon, authenticated;
grant execute on function public.monthly_sales(date) to authenticated;
