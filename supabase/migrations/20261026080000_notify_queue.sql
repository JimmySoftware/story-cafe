-- แจ้งเตือนเจ้าของร้านทาง LINE ตอนมีออเดอร์ใหม่ (briefs/notify.md)
-- ฐานข้อมูลแค่ "ใส่คิว" ตอนสร้างออเดอร์ (ไม่เรียกเน็ตใน transaction) · ฟังก์ชัน notify_owner มาหยิบจากคิวไปส่งทีหลัง

create table public.notify_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  retry_key uuid not null default gen_random_uuid(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- ปิดทั้งหมดสำหรับลูกค้า (ไม่มี policy) · service_role ข้าม RLS
alter table public.notify_queue enable row level security;
revoke all on public.notify_queue from anon, authenticated;

create index notify_queue_due_idx on public.notify_queue (next_attempt_at) where status = 'pending';

-- trigger ห้าม raise error เด็ดขาด: ถ้าใส่คิวไม่ได้ ก็ปล่อยให้ออเดอร์ผ่านไปเฉย ๆ
-- ออเดอร์ร้านค้าออนไลน์ใส่ยอดทีหลัง insert (create_order) จึงใช้ constraint trigger แบบ deferred
-- เพื่อให้อ่านยอดสุดท้ายตอน commit · ออเดอร์สั่งล่วงหน้ามียอดตั้งแต่ insert
create function public.enqueue_order_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_source text := case tg_table_name when 'orders' then 'preorder' else 'shop' end;
  v_code text;
  v_total int;
begin
  if tg_table_name = 'orders' then
    select code, total into v_code, v_total from public.orders where id = new.id;
  else
    select code, total into v_code, v_total from public.shop_orders where id = new.id;
  end if;
  if v_code is null then
    return null;
  end if;
  insert into public.notify_queue (kind, payload, dedupe_key)
  values ('order_placed', jsonb_build_object('code', v_code, 'total', v_total, 'source', v_source), 'order_placed:' || v_code)
  on conflict do nothing;
  return null;
exception when others then
  raise warning 'enqueue_order_notification: ใส่คิวแจ้งเตือนไม่สำเร็จ (sqlstate %)', sqlstate;
  return null;
end $$;

create trigger orders_notify after insert on public.orders
  for each row execute function public.enqueue_order_notification();

create constraint trigger shop_orders_notify after insert on public.shop_orders
  deferrable initially deferred
  for each row execute function public.enqueue_order_notification();

-- หยิบแถวที่ถึงเวลา แล้วเลื่อน next_attempt_at ไป 5 นาที กันสองตัวหยิบแถวเดียวกัน
create function public.claim_notifications(p_limit int default 10) returns setof public.notify_queue
language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select id from public.notify_queue
     where status = 'pending' and next_attempt_at <= now()
     order by next_attempt_at, created_at
     limit greatest(coalesce(p_limit, 10), 0)
     for update skip locked
  )
  update public.notify_queue q
     set next_attempt_at = now() + interval '5 minutes'
    from picked
   where q.id = picked.id
  returning q.*;
end $$;

-- sent → ส่งแล้ว · retry → นับครั้ง เลื่อนเวลา 2^attempts นาที (เพดาน 60) ถึง 5 ครั้งเป็น dead · failed → ผิดถาวร
create function public.finish_notification(p_id uuid, p_outcome text, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_outcome = 'sent' then
    update public.notify_queue
       set status = 'sent', sent_at = now(), last_error = null
     where id = p_id;
  elsif p_outcome = 'retry' then
    update public.notify_queue
       set attempts = attempts + 1,
           status = case when attempts + 1 >= 5 then 'dead' else 'pending' end,
           next_attempt_at = now() + make_interval(mins => least(power(2, attempts + 1)::int, 60)),
           last_error = left(p_error, 300)
     where id = p_id;
  elsif p_outcome = 'failed' then
    update public.notify_queue
       set status = 'failed', last_error = left(p_error, 300)
     where id = p_id;
  else
    raise exception 'bad_outcome';
  end if;
end $$;

revoke all on function public.enqueue_order_notification() from public, anon, authenticated;
revoke all on function public.claim_notifications(int) from public, anon, authenticated;
revoke all on function public.finish_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;
grant execute on function public.finish_notification(uuid, text, text) to service_role;
