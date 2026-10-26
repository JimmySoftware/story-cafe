-- สรุปยอดขายรายวัน (briefs/owner.md ส่วน A) · ฟังก์ชันเดียวนับทุกช่องทาง: POS, สั่งล่วงหน้า, ร้านเมล็ดกาแฟออนไลน์
-- พนักงาน = JWT app_metadata.role = 'staff' (ไม่เชื่อ user_metadata ที่ผู้ใช้แก้เองได้)
-- วัน = วันตามเวลา Asia/Bangkok · ไม่มีสำเนาสูตรนับที่อื่น (หน้าจอเรียกฟังก์ชันนี้อย่างเดียว)

create function public.sales_summary(p_day date default (now() at time zone 'Asia/Bangkok')::date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Bangkok')::date);
  v_from timestamptz := (coalesce(p_day, (now() at time zone 'Asia/Bangkok')::date))::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := ((coalesce(p_day, (now() at time zone 'Asia/Bangkok')::date)) + 1)::timestamp at time zone 'Asia/Bangkok';
  v_result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'staff' then
    raise exception 'forbidden: เฉพาะพนักงานหรือเจ้าของร้านเท่านั้นที่ดูสรุปยอดขายได้';
  end if;

  with sales as (
    -- POS: ทุกบิล · แก้ว = Σ qty × cup_units ของเมนู (เมนูที่หาไม่เจอนับ 0)
    select 'pos'::text as source, b.at as ts, b.total,
           coalesce((select sum(i.qty * m.cup_units)
                       from public.pos_bill_items i
                       join public.menu_items m on m.name = i.item_name
                      where i.bill_id = b.id), 0)::int as cups
      from public.pos_bills b
     where b.at >= v_from and b.at < v_to
    union all
    -- สั่งล่วงหน้า: เฉพาะ placed / picked_up
    select 'preorder', o.created_at, o.total,
           coalesce((select sum(oi.cups) from public.order_items oi where oi.order_id = o.id), 0)::int
      from public.orders o
     where o.status in ('placed', 'picked_up')
       and o.created_at >= v_from and o.created_at < v_to
    union all
    -- ร้านออนไลน์: เฉพาะ paid / shipped · ไม่นับแก้ว
    select 'shop', s.created_at, s.total, 0
      from public.shop_orders s
     where s.status in ('paid', 'shipped')
       and s.created_at >= v_from and s.created_at < v_to
  ),
  src as (
    select k.source,
           count(s.source) as bills,
           coalesce(sum(s.total), 0) as revenue,
           coalesce(sum(s.cups), 0) as cups
      from (values ('pos'), ('preorder'), ('shop')) as k(source)
      left join sales s on s.source = k.source
     group by k.source
  ),
  hrs as (
    select extract(hour from ts at time zone 'Asia/Bangkok')::int as hour,
           count(*) as bills, sum(cups) as cups, sum(total) as revenue
      from sales
     group by 1
  )
  select jsonb_build_object(
    'day', to_char(v_day, 'YYYY-MM-DD'),
    'bills', (select coalesce(sum(bills), 0) from src)::int,
    'revenue', (select coalesce(sum(revenue), 0) from src)::int,
    'cups', (select coalesce(sum(cups), 0) from src)::int,
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', hour, 'bills', bills, 'cups', cups, 'revenue', revenue)
                                          order by hour) from hrs), '[]'::jsonb),
    'by_source', (select jsonb_object_agg(source, jsonb_build_object('bills', bills, 'revenue', revenue, 'cups', cups)) from src)
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.sales_summary(date) from public, anon, authenticated;
grant execute on function public.sales_summary(date) to authenticated;
