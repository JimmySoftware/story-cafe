-- สรุปเช้า 07:00 + กดยืนยันออเดอร์จาก LINE (briefs/morning.md) ส่วนฐานข้อมูล
-- ฟังก์ชันฝั่ง LINE (morning_summary / line_webhook) ทำแยก · ไม่มี token หรือ URL ในไฟล์นี้

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- สถานะ confirmed (ของเดิม: placed / cancelled / picked_up / expired)
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('placed', 'confirmed', 'cancelled', 'picked_up', 'expired'));

-- เก็บ webhookEventId ที่รับแล้ว · ปิดทั้งหมดสำหรับลูกค้า (ไม่มี policy) · service_role ข้าม RLS
create table public.line_events (
  id text primary key,
  received_at timestamptz not null default now()
);
alter table public.line_events enable row level security;
revoke all on public.line_events from anon, authenticated;

-- ใหม่ → true · เคยรับแล้ว → false
create function public.record_line_event(p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.line_events (id) values (p_id) on conflict (id) do nothing;
  return found;
end $$;

-- placed → confirmed · ยืนยันซ้ำ → {"already":true} · ไม่พบ → not_found · สถานะอื่น → bad_status
create function public.confirm_preorder(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where code = p_code for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_order.status = 'confirmed' then
    return jsonb_build_object('already', true);
  end if;
  if v_order.status <> 'placed' then
    raise exception 'bad_status';
  end if;
  update public.orders set status = 'confirmed' where id = v_order.id;
  return jsonb_build_object('code', p_code, 'status', 'confirmed');
end $$;

-- ข้อมูลสรุปเช้า: ออเดอร์ placed/confirmed ที่เวลารับอยู่ในวันนั้น (เวลาไทย)
-- order_items.cups เป็นจำนวนแก้วของทั้งรายการแล้ว จึงรวมตรง ๆ ไม่คูณ qty ซ้ำ
create function public.morning_summary_data(p_day date default (now() at time zone 'Asia/Bangkok')::date)
returns jsonb
language sql stable security definer set search_path = public as $$
  with day_orders as (
    select id, pickup_at at time zone 'Asia/Bangkok' as local_pickup
      from public.orders
     where status in ('placed', 'confirmed')
       and (pickup_at at time zone 'Asia/Bangkok')::date = p_day
  )
  select jsonb_build_object(
    'day', to_char(p_day, 'YYYY-MM-DD'),
    'orders', (select count(*) from day_orders),
    'cups', coalesce((select sum(oi.cups) from public.order_items oi join day_orders d on d.id = oi.order_id), 0),
    'first_pickup', (select to_char(min(local_pickup), 'HH24:MI') from day_orders),
    'last_pickup', (select to_char(max(local_pickup), 'HH24:MI') from day_orders),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'stock', stock, 'unit', unit, 'reorder_level', reorder_level) order by name)
        from public.ingredients
       where stock <= reorder_level
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.record_line_event(text) from public, anon, authenticated;
revoke all on function public.confirm_preorder(text) from public, anon, authenticated;
revoke all on function public.morning_summary_data(date) from public, anon, authenticated;
grant execute on function public.record_line_event(text) to service_role;
grant execute on function public.confirm_preorder(text) to service_role;
grant execute on function public.morning_summary_data(date) to service_role;

-- 07:00 เวลาไทย = 00:00 UTC (pg_cron ใช้ UTC) · เรียกฟังก์ชัน morning_summary ผ่าน net.http_post
-- URL กับ key อ่านจาก Vault ตอนรัน (ตั้งชื่อ morning_summary_url / morning_summary_key นอกไฟล์นี้)
-- คำสั่งเขียนบรรทัดเดียวให้อ่านจาก cron.job ได้ง่าย
select cron.schedule(
  'morning-summary',
  '0 0 * * *',
  $job$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'morning_summary_url'), headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'morning_summary_key')), body := '{}'::jsonb)$job$
);
