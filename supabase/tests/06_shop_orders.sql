-- ร้านเมล็ดกาแฟ: create_order สำเร็จ · ไม่ล็อกอิน · ของไม่พอ · ล้มทั้งออเดอร์ · ลูกค้าเห็นของคนอื่นไม่ได้
-- ราคา/สต็อกอ่านจากตาราง products (seed จาก data/products.csv) ไม่พิมพ์เอง
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'b@test.local');
create temp table t_before as select sku, price, stock from public.products;
grant select on t_before to anon, authenticated;

-- ไม่ล็อกอิน
set local role anon;
do $$
declare ok boolean := false;
begin
  begin perform public.create_order('[{"sku":"beans-250","qty":1}]', '{"name":"x","phone":"1","address":"y"}');
  exception when others then ok := sqlerrm = 'not_authenticated'; end;
  assert ok, 'anon สั่งต้อง not_authenticated';
  begin perform 1 from public.shop_orders; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน shop_orders ไม่ได้';
  begin perform 1 from public.shop_order_items; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน shop_order_items ไม่ได้';
  assert (select count(*) from public.products) = 2, 'anon ต้องอ่านสินค้าได้';
end $$;
reset role;

-- ผู้ใช้ A สั่งสำเร็จ
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('test.a', (public.create_order('[{"sku":"beans-250","qty":2},{"sku":"drip-5","qty":1}]',
  '{"name":"ก","phone":"0X-XXX-XXXX","address":"ที่อยู่สมมติ"}'))::text, true);
do $$
declare r jsonb := current_setting('test.a')::jsonb; ok boolean;
begin
  assert r ->> 'code' ~ '^SH-[0-9]{4}$', 'code ต้องเป็นรูป SH-NNNN';
  assert (r ->> 'total')::int = (select 2 * b1.price + b2.price from t_before b1, t_before b2 where b1.sku = 'beans-250' and b2.sku = 'drip-5'), 'total ต้องคิดจาก products.price';
  assert (select stock from public.products where sku = 'beans-250') = (select stock - 2 from t_before where sku = 'beans-250'), 'สต็อก beans ต้องลด 2';
  assert (select stock from public.products where sku = 'drip-5') = (select stock - 1 from t_before where sku = 'drip-5'), 'สต็อก drip ต้องลด 1';
  assert (select count(*) from public.shop_orders) = 1 and (select count(*) from public.shop_order_items) = 2, 'A ต้องเห็นออเดอร์ตัวเอง';

  -- กฎอื่น
  ok := false; begin perform public.create_order('[]', '{"name":"a","phone":"b","address":"c"}'); exception when others then ok := sqlerrm like 'empty_order%'; end; assert ok, 'empty_order';
  foreach r in array array['[{"sku":"beans-250","qty":0}]'::jsonb, '[{"sku":"beans-250","qty":11}]', '[{"sku":"beans-250","qty":1.5}]'] loop
    ok := false; begin perform public.create_order(r, '{"name":"a","phone":"b","address":"c"}'); exception when others then ok := sqlerrm like 'bad_qty%'; end; assert ok, 'bad_qty ' || r::text;
  end loop;
  ok := false; begin perform public.create_order('[{"sku":"nope","qty":1}]', '{"name":"a","phone":"b","address":"c"}'); exception when others then ok := sqlerrm like 'bad_product%'; end; assert ok, 'bad_product';
  ok := false; begin perform public.create_order('[{"sku":"beans-250","qty":1}]', '{"name":"a","phone":" ","address":"c"}'); exception when others then ok := sqlerrm like 'bad_ship%'; end; assert ok, 'bad_ship';
  ok := false; begin update public.products set stock = 999; exception when insufficient_privilege then ok := true; end; assert ok, 'ลูกค้าแก้ stock ตรง ๆ ไม่ได้';
  ok := false; begin insert into public.shop_orders (code, user_id, total, ship_name, ship_phone, ship_address) values ('SH-0000', auth.uid(), 0, 'a', 'b', 'c'); exception when insufficient_privilege then ok := true; end; assert ok, 'ลูกค้าเขียน shop_orders ตรง ๆ ไม่ได้';
end $$;

-- ของไม่พอ + ล้มทั้งออเดอร์ (รายการแรกพอ รายการที่ 2 ไม่พอ → รายการแรกต้องไม่ถูกตัด)
reset role;
update public.products set stock = 1 where sku = 'drip-5';
set local role authenticated;
do $$
declare ok boolean := false; msg text; s_beans int; n_orders int;
begin
  select stock into s_beans from public.products where sku = 'beans-250';
  select count(*) into n_orders from public.shop_orders;
  begin perform public.create_order('[{"sku":"beans-250","qty":3},{"sku":"drip-5","qty":2}]', '{"name":"a","phone":"b","address":"c"}');
  exception when others then msg := sqlerrm; ok := sqlerrm like 'out_of_stock%'; end;
  assert ok, 'ของไม่พอต้อง out_of_stock ได้ ' || coalesce(msg, 'ไม่ error');
  assert msg like '%drip-5%', 'ข้อความ out_of_stock ต้องต่อท้ายด้วย sku';
  assert (select stock from public.products where sku = 'beans-250') = s_beans, 'ล้มทั้งออเดอร์: รายการแรกต้องไม่ถูกตัดสต็อก';
  assert (select stock from public.products where sku = 'drip-5') = 1, 'drip-5 ต้องยังเหลือ 1';
  assert (select count(*) from public.shop_orders) = n_orders, 'ล้มทั้งออเดอร์: ต้องไม่เกิดออเดอร์';
end $$;
-- ซื้อชิ้นสุดท้ายได้ แล้วหมดพอดี (ไม่ติดลบ)
do $$
declare ok boolean := false;
begin
  perform public.create_order('[{"sku":"drip-5","qty":1}]', '{"name":"a","phone":"b","address":"c"}');
  assert (select stock from public.products where sku = 'drip-5') = 0, 'ซื้อชิ้นสุดท้ายแล้วสต็อกต้อง 0';
  begin perform public.create_order('[{"sku":"drip-5","qty":1}]', '{"name":"a","phone":"b","address":"c"}');
  exception when others then ok := sqlerrm like 'out_of_stock%'; end;
  assert ok, 'ของหมดต้อง out_of_stock';
end $$;

-- ผู้ใช้ B เห็นของ A ไม่ได้
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.shop_orders) = 0, 'B ต้องไม่เห็นออเดอร์ของ A';
  assert (select count(*) from public.shop_order_items) = 0, 'B ต้องไม่เห็นรายการของ A';
end $$;
rollback;
