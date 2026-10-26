-- notify_queue: ปิดสำหรับลูกค้า · trigger ใส่คิวเมื่อมีออเดอร์ (ซ้ำไม่เพิ่ม · ไม่ทำออเดอร์ล้ม) · claim/finish เฉพาะ service_role
begin;
delete from public.notify_queue; -- เริ่มจากคิวว่าง (rollback ท้ายไฟล์ ไม่กระทบข้อมูลจริง)
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'b@test.local');
insert into public.orders (code, customer_name, phone, pickup_at, total)
  values ('SC-9101', 'ก', '0X-XXX-XXXX', now() + interval '1 day', 130);
insert into public.shop_orders (code, user_id, total, ship_name, ship_phone, ship_address)
  values ('SH-9101', '00000000-0000-0000-0000-0000000000b1', 0, 'ก', '0X-XXX-XXXX', 'สมมติ');
update public.shop_orders set total = 380 where code = 'SH-9101'; -- เหมือน create_order: ใส่ยอดหลัง insert
set constraints all immediate; -- trigger ของ shop_orders เป็น deferred: สั่งให้ทำงานตอนนี้แทนตอน commit

do $$
declare r public.notify_queue;
begin
  select * into r from public.notify_queue where dedupe_key = 'order_placed:SC-9101';
  assert r.id is not null and r.status = 'pending' and r.kind = 'order_placed', 'ออเดอร์สั่งล่วงหน้าต้องเข้าคิว pending';
  assert r.payload = '{"code":"SC-9101","total":130,"source":"preorder"}'::jsonb, 'payload สั่งล่วงหน้าไม่ตรง: ' || r.payload::text;
  assert r.retry_key is not null and r.attempts = 0, 'ต้องมี retry_key และ attempts เริ่มที่ 0';
  select * into r from public.notify_queue where dedupe_key = 'order_placed:SH-9101';
  assert r.payload = '{"code":"SH-9101","total":380,"source":"shop"}'::jsonb, 'payload ร้านค้าต้องมียอดสุดท้าย: ' || coalesce(r.payload::text, 'null');
  insert into public.notify_queue (kind, payload, dedupe_key) values ('order_placed', '{}', 'order_placed:SC-9101') on conflict do nothing;
  assert (select count(*) from public.notify_queue where dedupe_key = 'order_placed:SC-9101') = 1, 'dedupe_key ซ้ำต้องไม่เพิ่มแถว';
end $$;

-- trigger ต้องไม่ทำออเดอร์ล้ม แม้ใส่คิวไม่ได้ (บังคับให้ insert ล้มด้วย check constraint)
savepoint s1;
alter table public.notify_queue add constraint nq_force_fail check (kind <> 'order_placed') not valid;
insert into public.orders (code, customer_name, phone, pickup_at, total)
  values ('SC-9102', 'ก', '0X-XXX-XXXX', now() + interval '1 day', 90);
do $$
begin
  assert exists (select 1 from public.orders where code = 'SC-9102'), 'ออเดอร์ต้องถูกบันทึกแม้ใส่คิวล้ม';
  assert not exists (select 1 from public.notify_queue where dedupe_key = 'order_placed:SC-9102'), 'ใส่คิวล้มจึงต้องไม่มีแถว';
end $$;
rollback to savepoint s1;

-- ลูกค้า / anon: อ่าน-เขียนคิว และเรียก claim/finish ไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$
declare ok boolean;
begin
  begin perform 1 from public.notify_queue; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้องอ่าน notify_queue ไม่ได้';
  begin perform * from public.claim_notifications(5); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้องเรียก claim_notifications ไม่ได้';
  begin perform public.finish_notification(gen_random_uuid(), 'sent'); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้องเรียก finish_notification ไม่ได้';
end $$;
set local role anon;
do $$
declare ok boolean;
begin
  begin perform 1 from public.notify_queue; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน notify_queue ไม่ได้';
  begin perform * from public.claim_notifications(5); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องเรียก claim_notifications ไม่ได้';
end $$;
reset role;

-- service_role: claim เลื่อนเวลา 5 นาที · finish ทุกผลลัพธ์
set local role service_role;
do $$
declare r public.notify_queue; v_id uuid; n int;
begin
  select count(*) into n from public.claim_notifications(10);
  assert n = 2, 'claim ครั้งแรกต้องได้ 2 แถว ได้ ' || n;
  select * into r from public.notify_queue where dedupe_key = 'order_placed:SC-9101';
  assert r.next_attempt_at > now() + interval '4 minutes', 'claim ต้องเลื่อน next_attempt_at ไปราว 5 นาที';
  select count(*) into n from public.claim_notifications(10);
  assert n = 0, 'claim ซ้ำทันทีต้องไม่ได้แถวเดิม';
  v_id := r.id;

  perform public.finish_notification(v_id, 'retry', repeat('x', 500));
  select * into r from public.notify_queue where id = v_id;
  assert r.status = 'pending' and r.attempts = 1, 'retry ครั้งแรกต้อง pending/attempts 1';
  assert r.next_attempt_at between now() + interval '1 minute 50 seconds' and now() + interval '2 minutes 10 seconds', 'retry ครั้งที่ 1 ต้องเลื่อน 2 นาที';
  assert length(r.last_error) = 300, 'last_error ต้องตัดที่ 300 ตัวอักษร';
  perform public.finish_notification(v_id, 'retry', 'e'); perform public.finish_notification(v_id, 'retry', 'e'); perform public.finish_notification(v_id, 'retry', 'e');
  select * into r from public.notify_queue where id = v_id;
  assert r.status = 'pending' and r.attempts = 4, 'ครั้งที่ 4 ยัง pending';
  perform public.finish_notification(v_id, 'retry', 'e');
  select * into r from public.notify_queue where id = v_id;
  assert r.status = 'dead' and r.attempts = 5, 'ครั้งที่ 5 ต้อง dead';

  select id into v_id from public.notify_queue where dedupe_key = 'order_placed:SH-9101';
  perform public.finish_notification(v_id, 'sent');
  select * into r from public.notify_queue where id = v_id;
  assert r.status = 'sent' and r.sent_at is not null, 'sent ต้องมี sent_at';
  update public.notify_queue set status = 'pending' where id = v_id;
  perform public.finish_notification(v_id, 'failed', 'HTTP 401');
  select * into r from public.notify_queue where id = v_id;
  assert r.status = 'failed' and r.last_error = 'HTTP 401', 'failed ต้องเก็บ error';
end $$;
reset role;
rollback;
