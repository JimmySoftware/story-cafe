-- monthly_sales: เฉพาะพนักงาน · รวมทั้งเดือนตามเวลาไทย (ขอบวัน/ขอบเดือน) · เท่ากับผลรวม sales_summary รายวัน · rollback ทุกอย่าง
-- ใช้พฤษภาคม 2031 ที่ไม่มีข้อมูลจริง
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'ms-staff@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'ms-cust@test.local');

insert into public.pos_bills (client_order_id, subtotal, discount, total, points_earned, points_redeemed, at) values
  (gen_random_uuid(), 100, 0, 100, 0, 0, '2031-05-01 00:00:00+07'),   -- วันแรกของเดือน (ไทย) = 2031-04-30 17:00 UTC ต้องนับ
  (gen_random_uuid(), 50, 0, 50, 0, 0, '2031-05-31 23:59:59+07'),     -- วันสุดท้าย (ไทย)
  (gen_random_uuid(), 7, 0, 7, 0, 0, '2031-06-01 00:00:00+07'),       -- เดือนถัดไป ห้ามนับ
  (gen_random_uuid(), 9, 0, 9, 0, 0, '2031-04-30 23:59:59+07');       -- เดือนก่อน ห้ามนับ

set local role anon;
do $$ begin
  begin perform public.monthly_sales('2031-05-10'); assert false, 'anon เรียกได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated","user_metadata":{"role":"staff"}}', true);
do $$ begin
  begin perform public.monthly_sales('2031-05-10'); assert false, 'ลูกค้าเรียกได้';
  exception when others then assert sqlerrm like 'forbidden:%', 'ต้อง forbidden แต่ได้ ' || sqlerrm; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare r jsonb := public.monthly_sales('2031-05-17'); d int;
begin
  assert r ->> 'month' = '2031-05', 'month ' || r::text;
  assert (r ->> 'days')::int = 31, 'พฤษภาคมต้องมี 31 วัน';
  assert (r ->> 'revenue')::int = 150, 'ยอดรวมต้อง 150 (ไม่นับเดือนอื่น) แต่ได้ ' || (r ->> 'revenue');
  assert (r ->> 'bills')::int = 2, 'บิลต้อง 2';
  assert jsonb_array_length(r -> 'by_day') = 31, 'by_day ต้อง 31 แถว';
  assert (r -> 'by_day' -> 0 ->> 'day') = '2031-05-01' and (r -> 'by_day' -> 0 ->> 'revenue')::int = 100, 'วันที่ 1';
  assert (r -> 'by_day' -> 30 ->> 'day') = '2031-05-31' and (r -> 'by_day' -> 30 ->> 'revenue')::int = 50, 'วันที่ 31';
  assert (select sum((e ->> 'revenue')::int) from jsonb_array_elements(r -> 'by_day') e) = (r ->> 'revenue')::int, 'รายวันรวมต้องเท่ายอดเดือน';
  -- วันไหนของเดือนก็ได้ผลเดียวกัน · กุมภาพันธ์ปีอธิกสุรทิน 29 วัน
  assert public.monthly_sales('2031-05-01') = r, 'วันที่ในเดือนต่างกันต้องได้ผลเดียวกัน';
  assert (public.monthly_sales('2032-02-10') ->> 'days')::int = 29, 'ก.พ. 2032 ต้อง 29 วัน';
  assert public.monthly_sales(null) ->> 'month' = to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM'), 'null = เดือนนี้';
end $$;
reset role;
rollback;
