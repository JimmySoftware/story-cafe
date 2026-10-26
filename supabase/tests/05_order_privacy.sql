-- ลูกค้า (anon) อ่าน orders/order_items/pickup_slots ตรง ๆ ไม่ได้ ดูได้ผ่าน lookup_order เท่านั้น
begin;
select set_config('test.code', (public.place_preorder('ลูกค้า ก', '090-000-0111', ((date_trunc('day', now() at time zone 'Asia/Bangkok') + interval '1 day 16 hours 30 minutes') at time zone 'Asia/Bangkok')
  , jsonb_build_array(jsonb_build_object('menu_item_id', (select id from public.menu_items where name = 'ลาเต้'), 'qty', 1, 'options', '[]'::jsonb)))) ->> 'code', true);

set local role anon;
do $$
declare ok boolean; r jsonb; t text; c text := current_setting('test.code');
begin
  foreach t in array array['orders', 'order_items', 'pickup_slots'] loop
    ok := false;
    begin execute format('select 1 from public.%I', t); exception when insufficient_privilege then ok := true; end;
    assert ok, 'anon ต้องอ่านตาราง ' || t || ' ตรง ๆ ไม่ได้';
  end loop;

  r := public.lookup_order(c, '0900000111');
  assert r ->> 'code' = c and r ->> 'customer_name' = 'ลูกค้า ก' and jsonb_array_length(r -> 'items') = 1,
    'lookup_order ต้องคืนออเดอร์เมื่อรหัส + เบอร์ตรง';
  assert r -> 'items' -> 0 ->> 'name' = 'ลาเต้', 'lookup_order ต้องคืนชื่อเมนู';

  ok := false;
  begin perform public.lookup_order(c, '0999999999'); exception when others then ok := sqlerrm = 'not_found'; end;
  assert ok, 'เบอร์ผิดต้อง not_found';
  ok := false;
  begin perform public.lookup_order('SC-NOPE', '0900000111'); exception when others then ok := sqlerrm = 'not_found'; end;
  assert ok, 'รหัสผิดต้อง not_found ข้อความเดียวกัน';
  ok := false;
  begin perform public.lookup_order(c, ''); exception when others then ok := sqlerrm = 'not_found'; end;
  assert ok, 'เบอร์ว่างต้อง not_found';
end $$;
rollback;
