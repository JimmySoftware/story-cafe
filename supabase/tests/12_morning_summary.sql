-- morning_summary_data / confirm_preorder / record_line_event: นับตามวันเวลาไทย · แก้วรวม · ของใกล้หมด · เรียกได้เฉพาะ service_role
begin;
delete from public.orders; -- เริ่มจากไม่มีออเดอร์ (rollback ท้ายไฟล์ ไม่กระทบข้อมูลจริง)
update public.ingredients set stock = reorder_level + 1000; -- ทุกตัวพอ
update public.ingredients set stock = reorder_level where name = 'นมวัว';        -- เท่าระดับสั่ง = ใกล้หมด
update public.ingredients set stock = reorder_level - 1 where name = 'ชาซีลอน'; -- ต่ำกว่า = ใกล้หมด
update public.ingredients set stock = reorder_level + 1 where name = 'นมโอ๊ต'; -- เกินนิดเดียว = ยังพอ

insert into public.orders (code, customer_name, phone, pickup_at, status, total) values
  ('SC-9201', 'ก', '0X-XXX-XXXX', timestamptz '2030-05-10 09:00+07', 'placed', 150),
  ('SC-9202', 'ก', '0X-XXX-XXXX', timestamptz '2030-05-10 14:30+07', 'confirmed', 225),
  ('SC-9203', 'ก', '0X-XXX-XXXX', timestamptz '2030-05-10 11:00+07', 'cancelled', 375),
  ('SC-9204', 'ก', '0X-XXX-XXXX', timestamptz '2030-05-10 00:30+07', 'placed', 75),   -- 17:30 UTC ของวันก่อน แต่เป็นวันที่ 10 เวลาไทย
  ('SC-9205', 'ก', '0X-XXX-XXXX', timestamptz '2030-05-11 00:00+07', 'placed', 75);   -- วันถัดไป ต้องไม่นับ
insert into public.order_items (order_id, menu_item_id, qty, unit_price, cups)
  select o.id, (select id from public.menu_items order by name limit 1), c.qty, 75, c.cups
    from public.orders o join (values ('SC-9201', 2, 2), ('SC-9202', 3, 3), ('SC-9203', 5, 5), ('SC-9204', 1, 1), ('SC-9205', 9, 9)) c(code, qty, cups) on c.code = o.code;

do $$
declare d jsonb := public.morning_summary_data(date '2030-05-10'); n text[];
begin
  assert d->>'day' = '2030-05-10', 'day ไม่ตรง: ' || d::text;
  assert (d->>'orders')::int = 3, 'ต้องนับเฉพาะ placed/confirmed ของวันนั้นเวลาไทย (3): ' || d::text;
  assert (d->>'cups')::int = 6, 'แก้วรวมต้อง 2+3+1 = 6 (ไม่คูณ qty ซ้ำ): ' || d::text;
  assert d->>'first_pickup' = '00:30' and d->>'last_pickup' = '14:30', 'ช่วงเวลารับไม่ตรง: ' || d::text;
  select array_agg(x->>'name') into n from jsonb_array_elements(d->'low_stock') x;
  assert 'นมวัว' = any(n) and 'ชาซีลอน' = any(n), 'ของที่ stock <= reorder_level ต้องขึ้น: ' || d::text;
  assert not ('นมโอ๊ต' = any(n)), 'ของที่ยังพอต้องไม่ขึ้น';
  assert (select x ? 'unit' and x ? 'reorder_level' and x ? 'stock' from jsonb_array_elements(d->'low_stock') x limit 1), 'low_stock ต้องมี name/stock/unit/reorder_level';

  d := public.morning_summary_data(date '2030-06-01');
  assert (d->>'orders')::int = 0 and (d->>'cups')::int = 0 and d->'first_pickup' = 'null'::jsonb, 'วันที่ไม่มีออเดอร์ต้องได้ 0 และเวลาเป็น null: ' || d::text;
  assert public.morning_summary_data()->>'day' = to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD'), 'ค่าเริ่มต้นต้องเป็นวันนี้เวลาไทย';
end $$;

-- confirm_preorder / record_line_event
do $$
declare r jsonb;
begin
  r := public.confirm_preorder('SC-9201');
  assert r = '{"code":"SC-9201","status":"confirmed"}'::jsonb, 'ยืนยันครั้งแรกคืนค่าผิด: ' || r::text;
  assert (select status from public.orders where code = 'SC-9201') = 'confirmed', 'ต้องเปลี่ยนเป็น confirmed';
  assert public.confirm_preorder('SC-9201') = '{"already":true}'::jsonb, 'ยืนยันซ้ำต้อง already';
  begin perform public.confirm_preorder('SC-9203'); assert false, 'cancelled ต้องยืนยันไม่ได้';
  exception when others then assert sqlerrm = 'bad_status', 'ต้อง bad_status แต่ได้ ' || sqlerrm; end;
  begin perform public.confirm_preorder('SC-NOPE'); assert false, 'ไม่พบต้อง error';
  exception when others then assert sqlerrm = 'not_found', 'ต้อง not_found แต่ได้ ' || sqlerrm; end;
  assert public.record_line_event('t-1') is true, 'event ใหม่ต้อง true';
  assert public.record_line_event('t-1') is false, 'event ซ้ำต้อง false';
end $$;

-- ลูกค้า (anon / authenticated) เรียกฟังก์ชันและอ่าน line_events ไม่ได้
do $$
declare r text; f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    foreach f in array array['public.confirm_preorder(''SC-9201'')', 'public.record_line_event(''x'')', 'public.morning_summary_data()'] loop
      begin execute 'select ' || f; assert false, r || ' เรียก ' || f || ' ได้';
      exception when insufficient_privilege then null; end;
    end loop;
    begin perform 1 from public.line_events; assert false, r || ' อ่าน line_events ได้';
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;
rollback;
