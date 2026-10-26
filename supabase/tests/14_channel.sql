-- channel: คอลัมน์+ค่าเริ่มต้น · p_channel ของ pos_record_bill / place_preorder / create_order · bad_channel
-- sales_summary.by_channel ครบสี่ช่องและรวมเท่ายอดรวม · payload คิวแจ้งเตือน · morning_summary_data.by_channel · rollback ทุกอย่าง
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'ch-staff@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'ch-cust@test.local');

-- ลายเซ็นไม่ซ้อน: แต่ละฟังก์ชันเหลือตัวเดียว
do $$
begin
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pos_record_bill') = 1, 'pos_record_bill overload';
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'place_preorder') = 1, 'place_preorder overload';
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_order') = 1, 'create_order overload';
end $$;

-- ฐานเปรียบเทียบก่อนเพิ่มข้อมูลทดสอบ (เผื่อฐานมีข้อมูลของวันนี้อยู่แล้ว)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
select set_config('test.base', public.sales_summary()::text, true);

-- POS: ไม่ส่ง p_channel = store · ส่ง delivery / line · ค่านอกรายการ = bad_channel
do $$
declare r jsonb; ok boolean;
begin
  r := public.pos_record_bill(gen_random_uuid(), '[{"item":"ลาเต้","qty":1}]'::jsonb);
  assert (select channel from public.pos_bills where id = (r ->> 'id')::uuid) = 'store', 'POS ค่าเริ่มต้นต้องเป็น store';
  r := public.pos_record_bill(gen_random_uuid(), '[{"item":"ลาเต้","qty":2}]'::jsonb, 0, 0, null, now(), null, 'delivery');
  assert (select channel from public.pos_bills where id = (r ->> 'id')::uuid) = 'delivery', 'POS delivery';
  r := public.pos_record_bill(gen_random_uuid(), '[{"item":"ลาเต้","qty":1}]'::jsonb, p_channel => 'line');
  assert (select channel from public.pos_bills where id = (r ->> 'id')::uuid) = 'line', 'POS line';
  foreach r in array array['"facebook"'::jsonb, '""'::jsonb] loop
    ok := false;
    begin perform public.pos_record_bill(gen_random_uuid(), '[{"item":"ลาเต้","qty":1}]'::jsonb, p_channel => r #>> '{}');
    exception when others then ok := sqlerrm like 'bad_channel:%'; end;
    assert ok, 'POS bad_channel ' || r::text;
  end loop;
  ok := false;
  begin perform public.pos_record_bill(gen_random_uuid(), '[{"item":"ลาเต้","qty":1}]'::jsonb, p_channel => null);
  exception when others then ok := sqlerrm like 'bad_channel:%'; end;
  assert ok, 'POS channel null';
end $$;

-- ร้านค้าออนไลน์: create_order ไม่ส่ง = web · delivery ได้ · ผิด = bad_channel
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
do $$
declare r jsonb; ok boolean;
begin
  r := public.create_order('[{"sku":"drip-5","qty":1}]', '{"name":"a","phone":"b","address":"c"}');
  perform set_config('test.shop_web', r ->> 'code', true);
  r := public.create_order('[{"sku":"drip-5","qty":1}]', '{"name":"a","phone":"b","address":"c"}', 'delivery');
  perform set_config('test.shop_delivery', r ->> 'code', true);
  ok := false;
  begin perform public.create_order('[{"sku":"drip-5","qty":1}]', '{"name":"a","phone":"b","address":"c"}', 'x');
  exception when others then ok := sqlerrm like 'bad_channel:%'; end;
  assert ok, 'create_order bad_channel';
end $$;
reset role;
do $$
begin
  assert (select channel from public.shop_orders where code = current_setting('test.shop_web')) = 'web', 'shop ค่าเริ่มต้น web';
  assert (select channel from public.shop_orders where code = current_setting('test.shop_delivery')) = 'delivery', 'shop delivery';
end $$;

-- พรีออเดอร์ (anon): พรุ่งนี้ 10:00 เวลาไทย
set local role anon;
do $$
declare r jsonb; ok boolean;
  v_at timestamptz := (((now() at time zone 'Asia/Bangkok')::date + 1)::timestamp + time '10:00') at time zone 'Asia/Bangkok';
  v_item text := (select id::text from public.menu_items where name = 'ครัวซองต์เนย');
  v_items jsonb;
begin
  v_items := jsonb_build_array(jsonb_build_object('menu_item_id', v_item, 'qty', 1));
  r := public.place_preorder('ก', '0X-XXX-XXXX', v_at, v_items);
  perform set_config('test.pre_web', r ->> 'code', true);
  r := public.place_preorder('ข', '0X-XXX-XXXX', v_at, v_items, 'line');
  perform set_config('test.pre_line', r ->> 'code', true);
  ok := false;
  begin perform public.place_preorder('ค', '0X-XXX-XXXX', v_at, v_items, 'x');
  exception when others then ok := sqlerrm like 'bad_channel:%'; end;
  assert ok, 'place_preorder bad_channel';
end $$;
reset role;
set constraints all immediate;
do $$
begin
  assert (select channel from public.orders where code = current_setting('test.pre_web')) = 'web', 'preorder ค่าเริ่มต้น web';
  assert (select channel from public.orders where code = current_setting('test.pre_line')) = 'line', 'preorder line';
  -- payload คิวแจ้งเตือนมี channel ของออเดอร์นั้น
  assert (select payload ->> 'channel' from public.notify_queue where dedupe_key = 'order_placed:' || current_setting('test.pre_line')) = 'line', 'payload preorder line';
  assert (select payload ->> 'channel' from public.notify_queue where dedupe_key = 'order_placed:' || current_setting('test.pre_web')) = 'web', 'payload preorder web';
  assert (select payload ->> 'channel' from public.notify_queue where dedupe_key = 'order_placed:' || current_setting('test.shop_delivery')) = 'delivery', 'payload shop delivery';
  -- ค่านอกรายการเขียนตรง ๆ ก็ไม่ได้ (check constraint)
  begin update public.orders set channel = 'x' where code = current_setting('test.pre_web'); assert false, 'ยอมรับ channel นอกรายการ';
  exception when check_violation then null; end;
end $$;

-- sales_summary: ผลต่างจากฐาน = ที่เพิ่งสร้าง · สี่ช่องครบ · ผลรวมช่อง = ยอดรวม
-- POS: store 1 บิล 1 แก้ว · delivery 1 บิล 2 แก้ว · line 1 บิล 1 แก้ว · พรีออเดอร์ web/line (พรุ่งนี้ แต่ created_at = วันนี้) · ร้านค้า status pending ไม่นับ
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare b jsonb := current_setting('test.base')::jsonb; s jsonb := public.sales_summary(); c text;
begin
  assert (select array_agg(k order by k) from jsonb_object_keys(s -> 'by_channel') k) = array['delivery','line','store','web'], 'by_channel ต้องมีครบสี่ช่อง';
  assert (s #>> '{by_channel,delivery,bills}')::int - (b #>> '{by_channel,delivery,bills}')::int = 1, 'delivery bills';
  assert (s #>> '{by_channel,delivery,cups}')::int - (b #>> '{by_channel,delivery,cups}')::int = 2, 'delivery cups';
  assert (s #>> '{by_channel,delivery,revenue}')::int - (b #>> '{by_channel,delivery,revenue}')::int
       = (select total from public.pos_bills where channel = 'delivery' order by created_at desc limit 1), 'delivery revenue';
  assert (s #>> '{by_channel,store,bills}')::int - (b #>> '{by_channel,store,bills}')::int = 1, 'store bills';
  -- line: POS 1 + พรีออเดอร์ 1
  assert (s #>> '{by_channel,line,bills}')::int - (b #>> '{by_channel,line,bills}')::int = 2, 'line bills';
  for c in select unnest(array['bills','revenue','cups']) loop
    assert (select sum((s #>> array['by_channel', k, c])::int) from unnest(array['store','line','web','delivery']) k) = (s ->> c)::int, 'ผลรวมช่อง ' || c;
  end loop;
end $$;
reset role;

-- morning_summary_data: by_channel นับออเดอร์ที่รับพรุ่งนี้แยกช่อง (web 1, line 1) และมีครบสี่ช่อง
do $$
declare m jsonb := public.morning_summary_data(((now() at time zone 'Asia/Bangkok')::date + 1));
begin
  assert (select array_agg(k order by k) from jsonb_object_keys(m -> 'by_channel') k) = array['delivery','line','store','web'], 'morning by_channel ครบสี่ช่อง';
  assert (m #>> '{by_channel,line}')::int >= 1 and (m #>> '{by_channel,web}')::int >= 1, 'morning by_channel นับช่อง';
  assert (select sum(v::int) from jsonb_each_text(m -> 'by_channel') e(k, v)) = (m ->> 'orders')::int, 'ผลรวมช่อง = orders';
end $$;
rollback;
