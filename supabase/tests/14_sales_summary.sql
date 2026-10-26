-- sales_summary: เฉพาะพนักงาน · วันไทย · นับเฉพาะสถานะที่กำหนด · แก้ว · by_hour · by_source รวมได้เท่ากับยอดรวม
-- ใช้วันในอนาคตไกล (2031-03-03) ที่ไม่มีข้อมูลจริง เพื่อให้ตัวเลขแน่นอน · rollback ทุกอย่าง
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'ss-staff@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'authenticated', 'authenticated', 'ss-cust@test.local');

-- ข้อมูลตัวอย่าง (เวลาเป็นเวลาไทย +07)
-- POS: ลาเต้ ×2 (2 แก้ว) 08:15 · ลาเต้ ×1 + ครัวซองต์ ×3 (1 แก้ว) 08:45 · ดริปเอธิโอเปีย ×1 (2 หน่วย) 00:30 ไทย (= 2031-03-02 17:30 UTC)
-- บิล 23:59:59 ไทย ของวันที่ 3 และ 00:00 ของวันที่ 4 ต้องแยกวันถูก
insert into public.pos_bills (id, client_order_id, subtotal, discount, total, points_earned, points_redeemed, at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', gen_random_uuid(), 200, 0, 200, 0, 0, '2031-03-03 08:15:00+07'),
  ('aaaaaaaa-0000-4000-8000-000000000002', gen_random_uuid(), 150, 0, 150, 0, 0, '2031-03-03 08:45:00+07'),
  ('aaaaaaaa-0000-4000-8000-000000000003', gen_random_uuid(), 120, 0, 120, 0, 0, '2031-03-03 00:30:00+07'),
  ('aaaaaaaa-0000-4000-8000-000000000004', gen_random_uuid(), 10, 0, 10, 0, 0, '2031-03-03 23:59:59+07'),
  ('aaaaaaaa-0000-4000-8000-000000000005', gen_random_uuid(), 999, 0, 999, 0, 0, '2031-03-04 00:00:00+07');
insert into public.pos_bill_items (bill_id, item_name, qty, unit_price, line_total, label) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ลาเต้', 2, 100, 200, 'ลาเต้'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'ลาเต้', 1, 60, 60, 'ลาเต้'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'ครัวซองต์เนย', 3, 30, 90, 'ครัวซองต์เนย'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'ดริปกาแฟ เอธิโอเปีย', 1, 120, 120, 'ดริป'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'ครัวซองต์เนย', 1, 10, 10, 'ครัวซองต์เนย'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'ลาเต้', 9, 111, 999, 'ลาเต้');

-- สั่งล่วงหน้า: placed 08:20 (3 แก้ว) · picked_up 14:00 (2 แก้ว) นับ · cancelled / expired / confirmed ไม่นับ
insert into public.orders (id, code, customer_name, phone, pickup_at, status, total, created_at) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'SS-T-1', 'ก', '0X-XXX-XXXX', '2031-03-03 09:00+07', 'placed', 300, '2031-03-03 08:20:00+07'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'SS-T-2', 'ข', '0X-XXX-XXXX', '2031-03-03 15:00+07', 'picked_up', 200, '2031-03-03 14:00:00+07'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'SS-T-3', 'ค', '0X-XXX-XXXX', '2031-03-03 15:00+07', 'cancelled', 1000, '2031-03-03 14:10:00+07'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'SS-T-4', 'ง', '0X-XXX-XXXX', '2031-03-03 15:00+07', 'expired', 1000, '2031-03-03 14:20:00+07'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'SS-T-5', 'จ', '0X-XXX-XXXX', '2031-03-03 15:00+07', 'confirmed', 1000, '2031-03-03 14:30:00+07');
insert into public.order_items (order_id, menu_item_id, qty, unit_price, cups)
select o.oid, (select id from public.menu_items where name = 'ลาเต้'), 1, 100, o.cups
  from (values ('bbbbbbbb-0000-4000-8000-000000000001'::uuid, 2), ('bbbbbbbb-0000-4000-8000-000000000001'::uuid, 1),
               ('bbbbbbbb-0000-4000-8000-000000000002'::uuid, 2), ('bbbbbbbb-0000-4000-8000-000000000003'::uuid, 7)) as o(oid, cups);

-- ร้านออนไลน์: paid 08:30 · shipped 20:00 นับ · pending / cancelled ไม่นับ
insert into public.shop_orders (id, code, user_id, status, total, ship_name, ship_phone, ship_address, created_at) values
  ('cccccccc-0000-4000-8000-000000000001', 'SS-S-1', '00000000-0000-0000-0000-0000000000e2', 'paid', 400, 'ก', '0X-XXX-XXXX', 'x', '2031-03-03 08:30:00+07'),
  ('cccccccc-0000-4000-8000-000000000002', 'SS-S-2', '00000000-0000-0000-0000-0000000000e2', 'shipped', 500, 'ก', '0X-XXX-XXXX', 'x', '2031-03-03 20:00:00+07'),
  ('cccccccc-0000-4000-8000-000000000003', 'SS-S-3', '00000000-0000-0000-0000-0000000000e2', 'pending', 5000, 'ก', '0X-XXX-XXXX', 'x', '2031-03-03 09:00:00+07'),
  ('cccccccc-0000-4000-8000-000000000004', 'SS-S-4', '00000000-0000-0000-0000-0000000000e2', 'cancelled', 5000, 'ก', '0X-XXX-XXXX', 'x', '2031-03-03 09:10:00+07');

-- อ่าน cup_units ก่อนสลับ role (authenticated อ่านตารางเมนูตรง ๆ ไม่ได้)
select set_config('test.drip_units', (select cup_units::text from public.menu_items where name = 'ดริปกาแฟ เอธิโอเปีย'), true);

-- anon: เรียกไม่ได้
set local role anon;
do $$
begin
  begin perform public.sales_summary('2031-03-03'); assert false, 'anon เรียก sales_summary ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ลูกค้า (แม้ตั้ง user_metadata.role = staff เอง): forbidden
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated","user_metadata":{"role":"staff"}}', true);
do $$
begin
  begin perform public.sales_summary('2031-03-03'); assert false, 'ลูกค้าเรียก sales_summary ได้';
  exception when others then
    assert sqlerrm like 'forbidden:%', 'ต้องได้ forbidden แต่ได้ ' || sqlerrm;
  end;
end $$;
reset role;

-- พนักงาน
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare
  r jsonb;
  v_drip int; v_hours jsonb;
begin
  r := public.sales_summary('2031-03-03');
  v_drip := current_setting('test.drip_units')::int;

  assert r ->> 'day' = '2031-03-03', 'day ผิด: ' || (r ->> 'day');

  -- POS 4 บิล (บิล 00:30 และ 23:59:59 นับวันนี้ · 2031-03-04 00:00 ไม่นับ) รวม 480 บาท
  -- แก้ว: 2×ลาเต้ + 1×ลาเต้ + ดริป×cup_units (ครัวซองต์ 0)
  assert (r #>> '{by_source,pos,bills}')::int = 4, 'pos bills: ' || (r #>> '{by_source,pos,bills}');
  assert (r #>> '{by_source,pos,revenue}')::int = 480, 'pos revenue: ' || (r #>> '{by_source,pos,revenue}');
  assert (r #>> '{by_source,pos,cups}')::int = 3 + v_drip, 'pos cups: ' || (r #>> '{by_source,pos,cups}');
  -- สั่งล่วงหน้า: เฉพาะ placed + picked_up = 2 ใบ 500 บาท 5 แก้ว
  assert (r #>> '{by_source,preorder,bills}')::int = 2, 'preorder bills: ' || (r #>> '{by_source,preorder,bills}');
  assert (r #>> '{by_source,preorder,revenue}')::int = 500, 'preorder revenue';
  assert (r #>> '{by_source,preorder,cups}')::int = 5, 'preorder cups';
  -- ร้านออนไลน์: paid + shipped = 2 ใบ 900 บาท 0 แก้ว
  assert (r #>> '{by_source,shop,bills}')::int = 2, 'shop bills';
  assert (r #>> '{by_source,shop,revenue}')::int = 900, 'shop revenue';
  assert (r #>> '{by_source,shop,cups}')::int = 0, 'shop cups';

  -- รวม = ผลรวมของ by_source
  assert (r ->> 'bills')::int = 8, 'bills รวม: ' || (r ->> 'bills');
  assert (r ->> 'revenue')::int = 1880, 'revenue รวม: ' || (r ->> 'revenue');
  assert (r ->> 'cups')::int = 8 + v_drip, 'cups รวม: ' || (r ->> 'cups');

  -- by_hour: เรียงชั่วโมงน้อย→มาก รวมทุกช่องทาง · 0, 8, 14, 20, 23
  v_hours := r -> 'by_hour';
  assert jsonb_array_length(v_hours) = 5, 'จำนวนชั่วโมง: ' || v_hours::text;
  assert (select array_agg((h ->> 'hour')::int) from jsonb_array_elements(v_hours) h) = array[0, 8, 14, 20, 23], 'ลำดับชั่วโมง: ' || v_hours::text;
  -- 00 ไทย: POS ดริป 1 บิล 120 บาท
  assert v_hours -> 0 = jsonb_build_object('hour', 0, 'bills', 1, 'cups', v_drip, 'revenue', 120), 'ชั่วโมง 0: ' || (v_hours -> 0)::text;
  -- 08: POS 2 บิล (200+150) + สั่งล่วงหน้า 1 (300) + ร้านออนไลน์ 1 (400) = 4 บิล 1050 บาท · แก้ว 2+1+3+0
  assert v_hours -> 1 = jsonb_build_object('hour', 8, 'bills', 4, 'cups', 6, 'revenue', 1050), 'ชั่วโมง 8: ' || (v_hours -> 1)::text;
  assert v_hours -> 2 = jsonb_build_object('hour', 14, 'bills', 1, 'cups', 2, 'revenue', 200), 'ชั่วโมง 14: ' || (v_hours -> 2)::text;
  assert v_hours -> 3 = jsonb_build_object('hour', 20, 'bills', 1, 'cups', 0, 'revenue', 500), 'ชั่วโมง 20: ' || (v_hours -> 3)::text;
  assert v_hours -> 4 = jsonb_build_object('hour', 23, 'bills', 1, 'cups', 0, 'revenue', 10), 'ชั่วโมง 23: ' || (v_hours -> 4)::text;
  -- ผลรวม by_hour = ยอดรวม
  assert (select sum((h ->> 'revenue')::int) from jsonb_array_elements(v_hours) h) = (r ->> 'revenue')::int, 'by_hour revenue ไม่เท่ายอดรวม';
  assert (select sum((h ->> 'bills')::int) from jsonb_array_elements(v_hours) h) = (r ->> 'bills')::int, 'by_hour bills ไม่เท่ายอดรวม';
  assert (select sum((h ->> 'cups')::int) from jsonb_array_elements(v_hours) h) = (r ->> 'cups')::int, 'by_hour cups ไม่เท่ายอดรวม';

  -- วันถัดไปเห็นแค่บิล 00:00 ของวันที่ 4
  r := public.sales_summary('2031-03-04');
  assert (r ->> 'bills')::int = 1 and (r ->> 'revenue')::int = 999 and (r ->> 'cups')::int = 9, 'วันที่ 4: ' || r::text;
  assert (r -> 'by_hour' -> 0 ->> 'hour')::int = 0, 'วันที่ 4 ต้องอยู่ชั่วโมง 0';

  -- วันที่ไม่มีขาย: ศูนย์ทั้งหมด by_hour ว่าง by_source ครบ 3 คีย์
  r := public.sales_summary('2031-03-10');
  assert (r ->> 'bills')::int = 0 and (r ->> 'revenue')::int = 0 and (r ->> 'cups')::int = 0, 'วันว่างต้องเป็น 0';
  assert r -> 'by_hour' = '[]'::jsonb, 'by_hour วันว่างต้องว่าง';
  assert (select count(*) from jsonb_object_keys(r -> 'by_source')) = 3, 'by_source ต้องมี 3 คีย์';
  assert (r #>> '{by_source,shop,bills}')::int = 0, 'by_source วันว่างต้องเป็น 0';

  -- ค่าเริ่มต้น = วันนี้เวลาไทย
  r := public.sales_summary();
  assert r ->> 'day' = to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD'), 'default day ผิด';
end $$;
reset role;
rollback;
