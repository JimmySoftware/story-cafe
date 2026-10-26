-- ทางสำรองสลิป: ส่งสลิปของคนอื่นไม่ได้ · ลูกค้าอนุมัติเองไม่ได้ · พนักงานอนุมัติ → paid · ปฏิเสธ → ยัง pending
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'b@test.local');
insert into public.shop_orders (id, code, user_id, total, ship_name, ship_phone, ship_address) values
  ('00000000-0000-0000-0000-00000000f001', 'SH-9001', '00000000-0000-0000-0000-0000000000a1', 380, 'ก', '0X-XXX-XXXX', 'สมมติ'),
  ('00000000-0000-0000-0000-00000000f002', 'SH-9002', '00000000-0000-0000-0000-0000000000a1', 380, 'ก', '0X-XXX-XXXX', 'สมมติ'),
  ('00000000-0000-0000-0000-00000000f003', 'SH-9003', '00000000-0000-0000-0000-0000000000a1', 380, 'ก', '0X-XXX-XXXX', 'สมมติ');

-- anon เรียกไม่ได้
set local role anon;
do $$
declare ok boolean;
begin
  begin perform public.submit_slip('SH-9001', 'slips/x.jpg'); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องส่งสลิปไม่ได้';
  begin perform public.review_slip(gen_random_uuid(), true); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องรีวิวสลิปไม่ได้';
end $$;
reset role;

-- ลูกค้า A ส่งสลิปของตัวเอง
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('test.s1', (public.submit_slip('SH-9001', 'slips/a.jpg'))::text, true);
select set_config('test.s2', (public.submit_slip('SH-9002', 'slips/b.jpg'))::text, true);
do $$
declare ok boolean; s1 uuid := (current_setting('test.s1')::jsonb ->> 'slip_id')::uuid;
begin
  assert current_setting('test.s1')::jsonb ->> 'status' = 'pending', 'สลิปใหม่ต้อง pending';
  assert (select count(*) from public.payment_slips) = 2, 'A ต้องเห็นสลิปของตัวเอง';
  -- ส่งซ้ำตอนยังมีสลิป pending / ออเดอร์ว่างเปล่า path
  begin perform public.submit_slip('SH-9001', 'slips/a2.jpg'); ok := false; exception when others then ok := sqlerrm = 'slip_pending'; end;
  assert ok, 'ส่งสลิปซ้ำตอนมี pending ต้อง slip_pending';
  begin perform public.submit_slip('SH-9003', '  '); ok := false; exception when others then ok := sqlerrm = 'bad_path'; end;
  assert ok, 'path ว่างต้อง bad_path';
  -- ลูกค้าอนุมัติเองไม่ได้ ไม่ว่าจะส่ง role มาจากไหน
  begin perform public.review_slip(s1, true); ok := false; exception when others then ok := sqlerrm = 'forbidden'; end;
  assert ok, 'ลูกค้าอนุมัติเองต้อง forbidden';
  -- เขียนตารางตรง ๆ ไม่ได้
  begin insert into public.payment_slips (order_id, storage_path) values ('00000000-0000-0000-0000-00000000f003', 'x'); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้อง insert payment_slips เองไม่ได้';
  begin update public.payment_slips set status = 'approved'; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้อง update payment_slips เองไม่ได้';
end $$;

-- ใส่ role staff ใน user_metadata (ผู้ใช้แก้เองได้) ต้องไม่ถูกเชื่อ
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","user_metadata":{"role":"staff"}}', true);
do $$
declare ok boolean;
begin
  begin perform public.review_slip((current_setting('test.s1')::jsonb ->> 'slip_id')::uuid, true); ok := false; exception when others then ok := sqlerrm = 'forbidden'; end;
  assert ok, 'user_metadata.role = staff ต้องไม่ได้สิทธิ์';
end $$;

-- ลูกค้า B ส่งสลิปให้ออเดอร์ของ A ไม่ได้ (ข้อความเหมือนออเดอร์ที่ไม่มี) · ดูสลิปของ A ไม่ได้
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
do $$
declare ok boolean; m1 text; m2 text;
begin
  begin perform public.submit_slip('SH-9003', 'slips/evil.jpg'); ok := false; exception when others then ok := true; m1 := sqlerrm; end;
  assert ok and m1 = 'not_found', 'B ส่งสลิปให้ออเดอร์ของ A ต้อง not_found';
  begin perform public.submit_slip('SH-0000', 'slips/evil.jpg'); exception when others then m2 := sqlerrm; end;
  assert m1 = m2, 'ออเดอร์คนอื่นกับออเดอร์ที่ไม่มีต้องข้อความเดียวกัน';
  assert (select count(*) from public.payment_slips) = 0, 'B ต้องไม่เห็นสลิปของ A';
end $$;

-- พนักงาน: อนุมัติสลิป 1 → paid · ปฏิเสธสลิป 2 → ยัง pending พร้อมเหตุผล
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare ok boolean; s1 uuid := (current_setting('test.s1')::jsonb ->> 'slip_id')::uuid; s2 uuid := (current_setting('test.s2')::jsonb ->> 'slip_id')::uuid;
begin
  reset role;
  assert (select status from public.shop_orders where code = 'SH-9001') = 'pending', 'ก่อนอนุมัติต้อง pending';
  set local role authenticated;
  perform public.review_slip(s1, true);
  perform public.review_slip(s2, false, 'ยอดไม่ตรง');
  begin perform public.review_slip(s1, false, 'กลับคำ'); ok := false; exception when others then ok := sqlerrm = 'already_reviewed'; end;
  assert ok, 'รีวิวซ้ำต้อง already_reviewed';
  begin perform public.review_slip(gen_random_uuid(), true); ok := false; exception when others then ok := sqlerrm = 'not_found'; end;
  assert ok, 'ไม่พบสลิปต้อง not_found';
end $$;
reset role;
do $$
begin
  assert (select status from public.shop_orders where code = 'SH-9001') = 'paid', 'อนุมัติแล้วออเดอร์ต้อง paid';
  assert (select status from public.payment_slips where storage_path = 'slips/a.jpg') = 'approved', 'สลิปต้อง approved';
  assert (select reviewed_at from public.payment_slips where storage_path = 'slips/a.jpg') is not null, 'ต้องมี reviewed_at';
  assert (select status from public.shop_orders where code = 'SH-9002') = 'pending', 'ปฏิเสธแล้วออเดอร์ต้องยัง pending';
  assert (select status || '/' || reason from public.payment_slips where storage_path = 'slips/b.jpg') = 'rejected/ยอดไม่ตรง', 'สลิปต้อง rejected พร้อมเหตุผล';
end $$;

-- ออเดอร์ paid แล้วส่งสลิปไม่ได้ · หลังถูกปฏิเสธส่งใหม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare ok boolean;
begin
  begin perform public.submit_slip('SH-9001', 'slips/late.jpg'); ok := false; exception when others then ok := sqlerrm = 'not_pending'; end;
  assert ok, 'ออเดอร์ paid แล้วต้องส่งสลิปไม่ได้';
  perform public.submit_slip('SH-9002', 'slips/b2.jpg');
end $$;
rollback;
