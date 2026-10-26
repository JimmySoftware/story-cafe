-- pos_bills: เขียนตรง ๆ ไม่ได้ · เฉพาะพนักงานเรียก pos_record_bill ได้ · ส่งซ้ำไม่เพิ่มแถว · คิดเงินที่เซิร์ฟเวอร์ตามกติกา bill.ts
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'pos-staff@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'pos-cust@test.local');

-- anon: เรียกฟังก์ชัน/อ่าน/เขียนตารางไม่ได้เลย
set local role anon;
do $$
begin
  begin perform public.pos_record_bill('11111111-1111-4111-8111-111111111111', '[{"item":"ลาเต้","qty":1}]');
    assert false, 'anon เรียก pos_record_bill ได้';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.pos_bills; assert false, 'anon อ่าน pos_bills ได้';
  exception when insufficient_privilege then null; end;
  begin insert into public.pos_bills (client_order_id, subtotal, discount, total, points_earned, points_redeemed, at)
    values (gen_random_uuid(), 1, 0, 1, 0, 0, now()); assert false, 'anon เขียน pos_bills ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ลูกค้า (แม้ตั้ง user_metadata.role = staff เอง): เรียกไม่ได้ อ่านไม่ได้ เขียนตรงไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated","user_metadata":{"role":"staff"}}', true);
do $$
begin
  begin perform public.pos_record_bill('22222222-2222-4222-8222-222222222222', '[{"item":"ลาเต้","qty":1}]');
    assert false, 'ลูกค้าเรียก pos_record_bill ได้';
  exception when others then
    assert sqlerrm like 'forbidden:%', 'ต้องได้ forbidden แต่ได้ ' || sqlerrm;
  end;
  begin insert into public.pos_bills (client_order_id, subtotal, discount, total, points_earned, points_redeemed, at)
    values (gen_random_uuid(), 1, 0, 1, 0, 0, now()); assert false, 'ลูกค้าเขียน pos_bills ได้';
  exception when insufficient_privilege then null; end;
  begin insert into public.pos_bill_items (bill_id, item_name, qty, unit_price, line_total, label)
    values (gen_random_uuid(), 'x', 1, 1, 1, 'x'); assert false, 'ลูกค้าเขียน pos_bill_items ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ราคาที่คาดหวังอ่านจากตารางเมนู (ไม่พิมพ์ราคาซ้ำ) — อ่านก่อนสลับ role เพราะ authenticated ไม่มีสิทธิ์อ่าน options
select set_config('test.latte', (select price::text from public.menu_items where name = 'ลาเต้'), true),
       set_config('test.croissant', (select price::text from public.menu_items where name = 'ครัวซองต์เนย'), true),
       set_config('test.size_l', (select price_delta::text from public.options where kind = 'size' and label = 'L'), true),
       set_config('test.milk_oat', (select price_delta::text from public.options where kind = 'milk' and label = 'โอ๊ต'), true);

-- พนักงาน (app_metadata.role = staff)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare
  r jsonb; r2 jsonb; r3 jsonb;
  v_latte int; v_croissant int; v_l int; v_oat int; v_exp_subtotal int; v_exp_total int;
  v_id constant uuid := '33333333-3333-4333-8333-333333333333';
  v_n26 int; v_n27 int;
begin
  -- เลขลำดับของวัน: นับต่อจากบิลที่มีอยู่แล้วในฐานข้อมูล (test อื่น/ข้อมูลจริงอาจมีบิลของวันนั้นอยู่) ไม่สมมติว่าวันนั้นว่าง
  select coalesce(max(substring(code from 13)::int), 0) into v_n26 from public.pos_bills where code like 'PB-20261026-%';
  select coalesce(max(substring(code from 13)::int), 0) into v_n27 from public.pos_bills where code like 'PB-20261027-%';
  v_latte := current_setting('test.latte')::int;
  v_croissant := current_setting('test.croissant')::int;
  v_l := current_setting('test.size_l')::int;
  v_oat := current_setting('test.milk_oat')::int;
  v_exp_subtotal := v_latte + v_l + v_oat + v_croissant;
  v_exp_total := v_exp_subtotal - 30;

  -- ตัวอย่างบิลบท 20 (จันทร์): ใช้ 30 แต้ม รับ 200 · ยอดมาจากตารางเมนู ไม่ได้มาจาก client
  r := public.pos_record_bill(v_id,
    '[{"item":"ลาเต้","qty":1,"options":{"size":"L","milk":"โอ๊ต","sweetness":"50%"}},{"item":"ครัวซองต์เนย","qty":1}]',
    30, 100, 200, '2026-10-26T10:00:00+07:00', '0X-XXX-XXXX');
  assert (r ->> 'subtotal')::int = v_exp_subtotal, 'subtotal ผิด: ' || r::text;
  assert (r ->> 'discount')::int = 30 and (r ->> 'points_redeemed')::int = 30, 'ส่วนลดผิด: ' || r::text;
  assert (r ->> 'total')::int = v_exp_total, 'total ผิด: ' || r::text;
  assert (r ->> 'change')::int = 200 - v_exp_total, 'เงินทอนผิด: ' || r::text;
  assert (r ->> 'points_earned')::int = v_exp_total / 25, 'แต้มวันจันทร์ผิด: ' || r::text;
  assert r ->> 'code' = 'PB-20261026-' || lpad((v_n26 + 1)::text, 4, '0'), 'code ผิด: ' || (r ->> 'code');
  assert (r ->> 'duplicate')::boolean = false, 'ครั้งแรกต้อง duplicate=false';
  assert (select label from public.pos_bill_items where bill_id = (r ->> 'id')::uuid and item_name = 'ลาเต้') = 'ลาเต้ L โอ๊ต หวาน 50%', 'label ผิด';
  assert (select staff from public.pos_bills where id = (r ->> 'id')::uuid) = '00000000-0000-0000-0000-0000000000d1', 'staff ต้องเป็นผู้บันทึก';

  -- ส่งซ้ำ (แม้ส่งรายการอื่นมา) → บิลเดิม ไม่เพิ่มแถว
  r2 := public.pos_record_bill(v_id, '[{"item":"เอสเปรสโซ","qty":5}]', 0, 0, null, now(), null);
  assert (r2 ->> 'duplicate')::boolean = true, 'ส่งซ้ำต้อง duplicate=true';
  assert r2 ->> 'id' = r ->> 'id' and r2 ->> 'code' = r ->> 'code' and r2 -> 'total' = r -> 'total', 'ส่งซ้ำต้องได้บิลเดิม';
  assert (select count(*) from public.pos_bills where client_order_id = v_id) = 1, 'ส่งซ้ำแล้วแถวเพิ่ม';
  assert (select count(*) from public.pos_bill_items where bill_id = (r ->> 'id')::uuid) = 2, 'รายการในบิลเปลี่ยนหลังส่งซ้ำ';

  -- id ต่าง วันเดียวกัน → code ถัดไป · วันไทยดูจาก p_at (17:30 UTC วันที่ 26 = 00:30 วันที่ 27 ไทย)
  r3 := public.pos_record_bill('44444444-4444-4444-8444-444444444444', '[{"item":"ลาเต้","qty":2}]', 0, 0, null, '2026-10-26T15:00:00Z');
  assert r3 ->> 'code' = 'PB-20261026-' || lpad((v_n26 + 2)::text, 4, '0'), 'code ที่สองผิด: ' || (r3 ->> 'code');
  r3 := public.pos_record_bill('55555555-5555-4555-8555-555555555555', '[{"item":"ลาเต้","qty":2}]', 0, 0, null, '2026-10-26T17:30:00Z');
  assert r3 ->> 'code' = 'PB-20261027-' || lpad((v_n27 + 1)::text, 4, '0'), 'ข้ามเที่ยงคืนไทยต้องนับเป็นวันใหม่ (เลขวันนั้นเริ่มจากของวันนั้น ไม่ใช่ต่อจากวันก่อน): ' || (r3 ->> 'code');

  -- วันเสาร์ (ไทย) แต้ม ×2 · 2026-10-24 = เสาร์ · 17:30Z วันศุกร์ = 00:30 เสาร์ไทย
  r3 := public.pos_record_bill('66666666-6666-4666-8666-666666666666', '[{"item":"ลาเต้","qty":2}]', 0, 0, null, '2026-10-23T17:30:00Z');
  assert (r3 ->> 'points_earned')::int = ((v_latte * 2) / 25) * 2, 'เสาร์ต้อง ×2 ตามเวลาไทย: ' || r3::text;
  r3 := public.pos_record_bill('77777777-7777-4777-8777-777777777777', '[{"item":"ลาเต้","qty":2}]', 0, 0, null, '2026-10-24T17:30:00Z');
  assert (r3 ->> 'points_earned')::int = (v_latte * 2) / 25, 'อาทิตย์ (ไทย) ต้อง ×1: ' || r3::text;

  -- แต้มที่ใช้ถูกจำกัดด้วยยอดคงเหลือ
  r3 := public.pos_record_bill('88888888-8888-4888-8888-888888888888', '[{"item":"ลาเต้","qty":1}]', 999, 10, null, now());
  assert (r3 ->> 'discount')::int = 10, 'ใช้แต้มเกินคงเหลือต้องถูกจำกัด: ' || r3::text;

  -- พนักงานอ่านบิลได้
  assert (select count(*) from public.pos_bills) >= 6, 'พนักงานต้องอ่านบิลได้';
end $$;

-- บิลผิด: error code ขึ้นต้นข้อความ และไม่เหลือแถวไว้ (retry ได้ด้วย id เดิมหลังแก้)
do $$
declare
  procedure_cases constant text[][] := array[
    ['unknown_item', '[{"item":"ไม่มีเมนูนี้","qty":1}]', '0'],
    ['bad_qty', '[{"item":"ลาเต้","qty":0}]', '0'],
    ['bad_qty', '[{"item":"ลาเต้","qty":100}]', '0'],
    ['bad_qty', '[{"item":"ลาเต้","qty":1.5}]', '0'],
    ['bad_option', '[{"item":"ลาเต้","qty":1,"options":{"size":"XL"}}]', '0'],
    ['bad_option', '[{"item":"ลาเต้","qty":1,"options":{"extra_shots":5}}]', '0'],
    ['bad_option', '[{"item":"ครัวซองต์เนย","qty":1,"options":{"size":"L"}}]', '0'],
    ['bad_points', '[{"item":"ลาเต้","qty":1}]', '-1'],
    ['empty_bill', '[]', '0'],
    ['cash_short', '[{"item":"ลาเต้","qty":1}]', '0']
  ];
  c text[];
  n int;
  v_before int := (select count(*) from public.pos_bills);
begin
  foreach c slice 1 in array procedure_cases loop
    begin
      perform public.pos_record_bill(gen_random_uuid(), c[2]::jsonb,
        case when c[1] = 'bad_points' then c[3]::int else 0 end, 0,
        case when c[1] = 'cash_short' then 1 else null end);
      assert false, 'ต้อง error ' || c[1];
    exception when others then
      assert sqlerrm like c[1] || ': %', format('ต้องได้ %s แต่ได้ %s', c[1], sqlerrm);
    end;
  end loop;
  assert (select count(*) from public.pos_bills) = v_before, 'บิลผิดต้องไม่เหลือแถว';
end $$;
reset role;

rollback;
