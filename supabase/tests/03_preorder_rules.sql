-- กฎของร้าน 6 ข้อใน briefs/preorder.md บังคับที่ฐานข้อมูล
-- ฐานเวลา = "พรุ่งนี้ 10:00" (เวลาไทย) จึงไม่ขึ้นกับนาฬิกาตอนรัน · กฎที่ผูกกับ "เวลาตอนนี้" (ข้อ 3, 4, 6)
-- ทดสอบโดยปรับตัวเลขใน settings ภายใน transaction (ซึ่งพิสูจน์ด้วยว่ากฎอ่านจาก settings)
begin;

create function public._t_base() returns timestamptz language sql stable as
$$ select (((now() at time zone 'Asia/Bangkok')::date + 1 + time '10:00') at time zone 'Asia/Bangkok') $$;
create function public._t_item(p_name text, p_qty int, p_opts text[] default '{}') returns jsonb language sql stable as
$$ select jsonb_build_object('menu_item_id', id, 'qty', p_qty, 'options', to_jsonb(p_opts)) from public.menu_items where name = p_name $$;
-- รันคำสั่งแล้วคืนข้อความ error (หรือ 'ok') เพื่อเช็กรหัสที่ขึ้นต้นข้อความ
create function public._t_err(p_sql text) returns text language plpgsql as
$$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $$;
create function public._t_order(p_slot timestamptz, p_items jsonb, p_phone text default '081-000-0001') returns jsonb language sql as
$$ select public.place_preorder('ลูกค้าทดสอบ', p_phone, p_slot, p_items) $$;
create function public._t_slot_err(p_slot timestamptz, p_items jsonb) returns text language plpgsql as
$$ begin perform public._t_order(p_slot, p_items); return 'ok'; exception when others then return sqlerrm; end $$;


savepoint s;
-- ===== ค่าตั้งต้น + ราคาคิดที่ฐานข้อมูล + ข้อ 5 (จ่ายที่เคาน์เตอร์) =====
do $$
declare
  b timestamptz := public._t_base();
  r jsonb; v_price int; v_delta int;
begin
  assert (select cup_units from public.menu_items where name = 'ดริปกาแฟ เอธิโอเปีย') = 2, 'ดริปเอธิโอเปียต้อง 2 แก้ว';
  assert (select count(*) from public.menu_items where not is_drink and cup_units <> 0) = 0, 'เบเกอรี่ทุกรายการต้อง 0 แก้ว';
  assert (select count(*) from public.menu_items where is_drink and name <> 'ดริปกาแฟ เอธิโอเปีย' and cup_units <> 1) = 0, 'เครื่องดื่มอื่นต้อง 1 แก้ว';
  assert (select count(*) from public.settings where is_public and key in ('cups_per_slot','slot_minutes','min_lead_minutes','cancel_cutoff_minutes','expire_after_minutes','preorder_days')) = 6, 'ค่ากฎต้องอยู่ใน settings ครบ 6 key และ public';

  select price into v_price from public.menu_items where name = 'ดริปกาแฟ เอธิโอเปีย';
  select sum(price_delta) into v_delta from public.options where label in ('L','โอ๊ต','เพิ่ม shot เอสเปรสโซ');
  r := public._t_order(b, jsonb_build_array(public._t_item('ดริปกาแฟ เอธิโอเปีย', 1, array['L','โอ๊ต','เพิ่ม shot เอสเปรสโซ'])));
  assert (r ->> 'total')::int = v_price + v_delta, 'total ต้องเท่า menu_items.price + options.price_delta';
  assert (r ->> 'code') ~ '^SC-[0-9]{4}$', 'เลขออเดอร์ต้องรูปแบบ SC-NNNN';
  assert (select unit_price from public.order_items oi join public.orders o on o.id = oi.order_id where o.code = r ->> 'code') = v_price + v_delta, 'unit_price ต้องคิดที่ฐานข้อมูล';
  assert (select status from public.orders where code = r ->> 'code') = 'placed', 'ออเดอร์ใหม่ต้อง placed';
  -- ข้อ 5: ไม่มีการจ่ายออนไลน์ — ตารางไม่มีคอลัมน์การจ่ายเงิน
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('orders','order_items')
          and column_name ~* '(pay|card|paid|slip|transaction)') = 0, 'ห้ามมีคอลัมน์การจ่ายเงินออนไลน์';
end $$;
rollback to s; savepoint s;

-- ===== ข้อ 1: ช่องละ 6 แก้ว (นับแก้ว ไม่ใช่ออเดอร์ · เบเกอรี่ไม่นับ) =====
do $$
declare b timestamptz := public._t_base();
begin
  perform public._t_order(b, jsonb_build_array(public._t_item('ลาเต้', 3)));
  perform public._t_order(b, jsonb_build_array(public._t_item('ลาเต้', 1), public._t_item('มัทฉะลาเต้', 2)));
  assert (select cups_used from public.pickup_slots where slot_start = b) = 6, '2 ออเดอร์ = 6 แก้ว';
  assert public._t_slot_err(b, jsonb_build_array(public._t_item('ลาเต้', 1))) like 'slot_full%', 'แก้วที่ 7 ต้อง slot_full';
  assert (select cups_used from public.pickup_slots where slot_start = b) = 6, 'ออเดอร์ที่ถูกปฏิเสธต้องไม่กินโควตา';
  -- เบเกอรี่ไม่นับ: ช่องเต็มแล้วยังสั่งเบเกอรี่ได้
  perform public._t_order(b, jsonb_build_array(public._t_item('ครัวซองต์เนย', 5)));
  assert (select cups_used from public.pickup_slots where slot_start = b) = 6, 'เบเกอรี่ต้องไม่เพิ่ม cups_used';
  -- ออเดอร์เดียวที่ใหญ่เกินช่องเปล่า
  assert public._t_slot_err(b + interval '10 minutes', jsonb_build_array(public._t_item('ลาเต้', 7))) like 'slot_full%', '7 แก้วในออเดอร์เดียวต้อง slot_full';
  -- ตัวเลข 6 อ่านจาก settings
  update public.settings set value = '2'::jsonb where key = 'cups_per_slot';
  assert public._t_slot_err(b + interval '20 minutes', jsonb_build_array(public._t_item('ลาเต้', 3))) like 'slot_full%', 'ลด cups_per_slot เป็น 2 แล้ว 3 แก้วต้องไม่ผ่าน';
  perform public._t_order(b + interval '20 minutes', jsonb_build_array(public._t_item('ลาเต้', 2)));
end $$;
rollback to s; savepoint s;

-- ===== ข้อ 2: ดริปกาแฟเอธิโอเปียนับ 2 แก้ว =====
do $$
declare b timestamptz := public._t_base();
begin
  perform public._t_order(b, jsonb_build_array(public._t_item('ดริปกาแฟ เอธิโอเปีย', 2)));
  assert (select cups_used from public.pickup_slots where slot_start = b) = 4, 'ดริป 2 ถ้วย = 4 แก้ว';
  assert (select sum(cups) from public.order_items) = 4, 'order_items.cups ต้อง 4';
  perform public._t_order(b, jsonb_build_array(public._t_item('ลาเต้', 2)));  -- ครบ 6 พอดี
  assert public._t_slot_err(b, jsonb_build_array(public._t_item('ลาเต้', 1))) like 'slot_full%', 'ครบ 6 แล้วต้องเต็ม';
  -- ช่องเหลือ 1 แก้ว: ลาเต้ได้ แต่ดริป (2 แก้ว) ไม่ได้
  assert public._t_slot_err(b + interval '10 minutes', jsonb_build_array(public._t_item('ลาเต้', 5), public._t_item('ดริปกาแฟ เอธิโอเปีย', 1))) like 'slot_full%', '5 + ดริป(2) = 7 ต้อง slot_full';
  perform public._t_order(b + interval '10 minutes', jsonb_build_array(public._t_item('ลาเต้', 5)));
  assert public._t_slot_err(b + interval '10 minutes', jsonb_build_array(public._t_item('ดริปกาแฟ เอธิโอเปีย', 1))) like 'slot_full%', 'เหลือ 1 แก้ว ดริปต้องไม่ผ่าน';
  perform public._t_order(b + interval '10 minutes', jsonb_build_array(public._t_item('ลาเต้', 1)));
end $$;
rollback to s; savepoint s;

-- ===== ข้อ 3: สั่งล่วงหน้าอย่างน้อย 15 นาที · ช่องเต็มกดเลือกไม่ได้ =====
do $$
declare
  b timestamptz := public._t_base();
  v_day date := (b at time zone 'Asia/Bangkok')::date;
begin
  -- ช่องเต็ม → bookable = false, ช่องอื่นยัง true
  perform public._t_order(b, jsonb_build_array(public._t_item('ลาเต้', 6)));
  assert (select not bookable and cups_left = 0 from public.available_slots(v_day) where slot_start = b), 'ช่องเต็มต้อง bookable = false, cups_left = 0';
  assert (select bookable and cups_left = 6 from public.available_slots(v_day) where slot_start = b + interval '10 minutes'), 'ช่องว่างต้อง bookable = true';
  -- ดริป 1 แก้วในอีกช่อง → เหลือ 4
  perform public._t_order(b + interval '10 minutes', jsonb_build_array(public._t_item('ดริปกาแฟ เอธิโอเปีย', 1)));
  assert (select cups_left from public.available_slots(v_day) where slot_start = b + interval '10 minutes') = 4, 'cups_left ต้องหักดริป 2 แก้ว';
  -- ช่องของวัน: 07:30 ถึง 16:50 ทุก 10 นาที = 57 ช่อง
  assert (select count(*) from public.available_slots(v_day)) = 57, 'ต้องมี 57 ช่อง (07:30–16:50)';
  assert (select min(slot_start) from public.available_slots(v_day)) = b - interval '2 hours 30 minutes', 'ช่องแรก 07:30';
  assert (select max(slot_start) from public.available_slots(v_day)) = b + interval '6 hours 50 minutes', 'ช่องสุดท้าย 16:50';

  -- ใกล้เกิน min_lead_minutes → too_late และ bookable = false (ปรับกฎเป็น 3000 นาที ให้พรุ่งนี้ 10:00 "ใกล้เกิน")
  update public.settings set value = '3000'::jsonb where key = 'min_lead_minutes';
  assert public._t_slot_err(b + interval '30 minutes', jsonb_build_array(public._t_item('ลาเต้', 1))) like 'too_late%', 'เหลือเวลาน้อยกว่า min_lead ต้อง too_late';
  assert (select count(*) from public.available_slots(v_day) where bookable) = 0, 'ใกล้เกิน min_lead ต้อง bookable = false ทุกช่อง';
  update public.settings set value = '15'::jsonb where key = 'min_lead_minutes';
  perform public._t_order(b + interval '30 minutes', jsonb_build_array(public._t_item('ลาเต้', 1)));

  -- ช่องที่ผ่านมาแล้ว (เมื่อวานซืน: ไม่ขึ้นกับเวลาของวัน) → too_late ไม่ว่ากฎจะเป็นเท่าไร
  assert public._t_slot_err(b - interval '2 days', jsonb_build_array(public._t_item('ลาเต้', 1))) like 'too_late%', 'เวลาที่ผ่านไปแล้วต้อง too_late';
end $$;
rollback to s; savepoint s;

-- ===== กฎรอบข้างของ place_preorder: รหัส error ตาม brief =====
do $$
declare
  b timestamptz := public._t_base();
  v_item jsonb := public._t_item('ลาเต้', 1);
begin
  assert public._t_slot_err(b, '[]'::jsonb) like 'empty_order%', 'ไม่มีรายการต้อง empty_order';
  assert public._t_slot_err(b + interval '5 minutes', jsonb_build_array(v_item)) like 'bad_slot%', 'ไม่ตรงช่อง 10 นาทีต้อง bad_slot';
  assert public._t_slot_err(b + interval '30 seconds', jsonb_build_array(v_item)) like 'bad_slot%', 'มีวินาทีต้อง bad_slot';
  assert public._t_slot_err(b - interval '2 hours 40 minutes', jsonb_build_array(v_item)) like 'outside_hours%', '07:20 ต้อง outside_hours';
  assert public._t_slot_err(b + interval '7 hours', jsonb_build_array(v_item)) like 'outside_hours%', '17:00 ต้อง outside_hours';
  perform public._t_order(b - interval '2 hours 30 minutes', jsonb_build_array(v_item));   -- 07:30 ได้
  perform public._t_order(b + interval '6 hours 50 minutes', jsonb_build_array(v_item));   -- 16:50 ได้
  assert public._t_slot_err(b + interval '1 day', jsonb_build_array(v_item)) like 'too_far%', 'มะรืนต้อง too_far';
  update public.settings set value = '2'::jsonb where key = 'preorder_days';
  perform public._t_order(b + interval '1 day', jsonb_build_array(v_item));
  assert public._t_slot_err(b, jsonb_build_array(jsonb_build_object('menu_item_id', gen_random_uuid(), 'qty', 1))) like 'bad_item%', 'เมนูไม่มีต้อง bad_item';
  assert public._t_slot_err(b, jsonb_build_array(public._t_item('ลาเต้', 1, array['ไซซ์ยักษ์']))) like 'bad_option%', 'ตัวเลือกไม่มีต้อง bad_option';
  assert public._t_slot_err(b, jsonb_build_array(public._t_item('ครัวซองต์เนย', 1, array['L']))) like 'bad_option%', 'ตัวเลือกกับเบเกอรี่ต้อง bad_option';
  assert public._t_slot_err(b, jsonb_build_array(public._t_item('ลาเต้', 1, array['S','L']))) like 'bad_option%', 'ไซซ์ซ้ำหมวดต้อง bad_option';
  assert public._t_slot_err(b, jsonb_build_array(public._t_item('ลาเต้', 0))) like 'bad_item%', 'qty 0 ต้อง bad_item';
  assert (select count(*) from public.pickup_slots where slot_start = b) = 0, 'ออเดอร์ที่ถูกปฏิเสธต้องไม่ทิ้งโควตา';
end $$;
rollback to s; savepoint s;

-- ===== ข้อ 4: ยกเลิกได้จนถึง 30 นาทีก่อนเวลารับ =====
do $$
declare
  b timestamptz := public._t_base();
  r jsonb; r2 jsonb;
begin
  r := public._t_order(b, jsonb_build_array(public._t_item('ดริปกาแฟ เอธิโอเปีย', 1), public._t_item('ครัวซองต์เนย', 1)), '081-234-5678');
  perform public._t_order(b, jsonb_build_array(public._t_item('ลาเต้', 2)));
  assert (select cups_used from public.pickup_slots where slot_start = b) = 4, 'ก่อนยกเลิกต้อง 4 แก้ว';

  assert public._t_err(format('select public.cancel_preorder(%L, %L)', r ->> 'code', '089-999-9999')) like 'not_found%', 'เบอร์ไม่ตรงต้อง not_found';
  assert public._t_err(format('select public.cancel_preorder(%L, %L)', 'SC-0000x', '081-234-5678')) like 'not_found%', 'ไม่พบเลขออเดอร์ต้อง not_found';
  assert (select status from public.orders where code = r ->> 'code') = 'placed', 'ยกเลิกไม่สำเร็จต้องไม่เปลี่ยนสถานะ';

  -- เลยเส้นตาย (ปรับ cancel_cutoff_minutes เป็น 3000 ให้พรุ่งนี้ 10:00 "ใกล้เกิน") → too_late_to_cancel
  update public.settings set value = '3000'::jsonb where key = 'cancel_cutoff_minutes';
  assert public._t_err(format('select public.cancel_preorder(%L, %L)', r ->> 'code', '081-234-5678')) like 'too_late_to_cancel%', 'เลยเส้นตายต้อง too_late_to_cancel';
  assert (select cups_used from public.pickup_slots where slot_start = b) = 4, 'ยกเลิกไม่ได้ต้องไม่คืนแก้ว';
  update public.settings set value = '30'::jsonb where key = 'cancel_cutoff_minutes';

  -- ยกเลิกทัน: คืนแก้ว (ดริป 2; เบเกอรี่ 0) และเบอร์เทียบเฉพาะตัวเลข
  r2 := public.cancel_preorder(r ->> 'code', '0812345678');
  assert (select status from public.orders where code = r ->> 'code') = 'cancelled', 'ต้องเป็น cancelled';
  assert (select cups_used from public.pickup_slots where slot_start = b) = 2, 'ต้องคืน 2 แก้ว';
  -- ยกเลิกซ้ำไม่คืนแก้วซ้ำ
  assert public._t_err(format('select public.cancel_preorder(%L, %L)', r ->> 'code', '081-234-5678')) like 'not_cancellable%', 'ยกเลิกซ้ำต้องไม่ได้';
  assert (select cups_used from public.pickup_slots where slot_start = b) = 2, 'ยกเลิกซ้ำต้องไม่คืนแก้วซ้ำ';
  -- ช่องว่างขึ้นมาแล้ว สั่งได้อีก
  perform public._t_order(b, jsonb_build_array(public._t_item('ลาเต้', 4)));
end $$;
rollback to s; savepoint s;

-- ===== ข้อ 6: ออเดอร์ที่เลยเวลารับ 30 นาทีแล้วไม่มาเอา ร้านทิ้งได้ =====
do $$
declare
  v_old uuid; v_recent uuid; v_future uuid; v_cancelled uuid; n int;
begin
  insert into public.orders (code, customer_name, phone, pickup_at, total) values ('SC-T001', 'เก่า', '0810000001', now() - interval '31 minutes', 0) returning id into v_old;
  insert into public.orders (code, customer_name, phone, pickup_at, total) values ('SC-T002', 'เพิ่งเลย', '0810000002', now() - interval '29 minutes', 0) returning id into v_recent;
  insert into public.orders (code, customer_name, phone, pickup_at, total) values ('SC-T003', 'อนาคต', '0810000003', public._t_base(), 0) returning id into v_future;
  insert into public.orders (code, customer_name, phone, pickup_at, total, status) values ('SC-T004', 'ยกเลิกแล้ว', '0810000004', now() - interval '3 hours', 0, 'cancelled') returning id into v_cancelled;

  n := public.expire_stale_preorders();
  assert n = 1, 'ต้องทิ้ง 1 ออเดอร์ (ได้ %)', n;
  assert (select status from public.orders where id = v_old) = 'expired', 'เลย 31 นาทีต้อง expired';
  assert (select status from public.orders where id = v_recent) = 'placed', 'เลยแค่ 29 นาทียังไม่ทิ้ง';
  assert (select status from public.orders where id = v_future) = 'placed', 'ยังไม่ถึงเวลารับต้องไม่ทิ้ง';
  assert (select status from public.orders where id = v_cancelled) = 'cancelled', 'ที่ยกเลิกแล้วต้องไม่ถูกเปลี่ยน';

  -- ตัวเลข 30 อ่านจาก settings
  update public.settings set value = '10'::jsonb where key = 'expire_after_minutes';
  assert public.expire_stale_preorders() = 1, 'expire_after_minutes = 10 ต้องทิ้งอีก 1 (เลย 29 นาที)';
  assert (select status from public.orders where id = v_recent) = 'expired', 'ต้อง expired ตามค่าใน settings';
end $$;
rollback to s; savepoint s;

-- ===== สิทธิ์ของ anon: เรียกฟังก์ชันได้ อ่านได้ แต่เขียนตารางตรง ๆ ไม่ได้ =====
create function public._t_anon_run() returns void language plpgsql as $$
declare
  b timestamptz := public._t_base();
  r jsonb; ok boolean;
begin
  r := public.place_preorder('ลูกค้า anon', '0812223333', b, jsonb_build_array(public._t_item('ลาเต้', 1)));
  assert r ->> 'code' is not null, 'anon ต้องสั่งผ่าน place_preorder ได้';
  assert (select count(*) from public.available_slots((b at time zone 'Asia/Bangkok')::date)) = 57, 'anon เรียก available_slots ได้';
  ok := false; begin perform 1 from public.orders; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน orders ตรง ๆ ไม่ได้ (briefs/rls.md)';
  ok := false; begin perform 1 from public.order_items; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน order_items ตรง ๆ ไม่ได้ (briefs/rls.md)';
  ok := false; begin perform 1 from public.pickup_slots; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน pickup_slots ตรง ๆ ไม่ได้ (briefs/rls.md)';
  ok := false; begin insert into public.orders (code, customer_name, phone, pickup_at, total) values ('SC-9999', 'x', 'x', b, 0); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้อง insert orders ไม่ได้';
  ok := false; begin update public.orders set total = 0; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้อง update orders ไม่ได้';
  ok := false; begin delete from public.order_items; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้อง delete order_items ไม่ได้';
  ok := false; begin insert into public.order_items (order_id, menu_item_id, qty, unit_price, cups) select id, (select id from public.menu_items limit 1), 1, 0, 0 from public.orders limit 1; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้อง insert order_items ไม่ได้';
  ok := false; begin update public.pickup_slots set cups_used = 0; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องแก้ pickup_slots ไม่ได้';
  ok := false; begin insert into public.pickup_slots (slot_start) values (b + interval '1 hour'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้อง insert pickup_slots ไม่ได้';
  ok := false; begin perform public.expire_stale_preorders(); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องเรียก expire_stale_preorders ไม่ได้';
  ok := false; begin perform public.preorder_setting('cups_per_slot'); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องเรียกตัวช่วยภายในไม่ได้';
  ok := false; begin update public.settings set value = '99'::jsonb where key = 'cups_per_slot'; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องแก้กฎใน settings ไม่ได้';

  assert (public.cancel_preorder(r ->> 'code', '0812223333') ->> 'cups_returned')::int = 1, 'anon ยกเลิกผ่าน cancel_preorder ได้และคืนแก้ว';
end $$;
set local role anon;
select public._t_anon_run();
reset role;
rollback;
