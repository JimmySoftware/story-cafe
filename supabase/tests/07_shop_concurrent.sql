-- สั่งพร้อมกัน: สินค้าเหลือชิ้นเดียว ลูกค้า 8 คน (คนละบัญชี) สั่งพร้อมกัน ต้องได้คนเดียว สต็อกเป็น 0 ไม่ติดลบ
-- ใช้หลาย connection จริง (dblink) จึง commit ข้อมูลจริงระหว่างทดสอบ แล้วลบทิ้งเองท้ายไฟล์
-- ใช้สินค้าทดสอบ sku test-last และผู้ใช้ conc-*@test.local · รหัสผ่านคือค่าเริ่มต้นของ Supabase ในเครื่องเท่านั้น
create extension if not exists dblink with schema public;
select set_config('test.dbhost', :'dbhost', false);

-- ล้างของรอบก่อน (ถ้าตกกลางทาง) แล้วเตรียมสินค้า 1 ชิ้น + ผู้ใช้ 8 คน และ commit ก่อน
delete from public.shop_orders where user_id in (select id from auth.users where email like 'conc-%@test.local');
delete from auth.users where email like 'conc-%@test.local';
delete from public.products where sku = 'test-last';
insert into public.products (sku, name, price, stock) values ('test-last', 'ชิ้นสุดท้าย (test)', 100, 1);
insert into auth.users (id, aud, role, email)
  select gen_random_uuid(), 'authenticated', 'authenticated', 'conc-' || g || '@test.local' from generate_series(1, 8) g;

do $$
declare
  n_conn constant int := 8;
  v_ok int := 0; v_out int := 0; v_other int := 0;
  v_uids uuid[] := array(select id from auth.users where email like 'conc-%@test.local' order by email);
  v_res text; i int; v_sql text;
begin
  v_sql := format($q$select pg_sleep(greatest(extract(epoch from (%L::timestamptz - clock_timestamp())), 0)),
    public.create_order('[{"sku":"test-last","qty":1}]', '{"name":"t","phone":"0X-XXX-XXXX","address":"สมมติ"}')::text$q$,
    clock_timestamp() + interval '1 second');

  for i in 1..n_conn loop
    perform dblink_connect('c' || i, 'host=' || current_setting('test.dbhost') || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres');
    perform dblink_exec('c' || i, 'set role authenticated');
    perform dblink_exec('c' || i, format('set request.jwt.claims = %L', json_build_object('sub', v_uids[i], 'role', 'authenticated')::text));
  end loop;
  for i in 1..n_conn loop
    perform dblink_send_query('c' || i, v_sql);
  end loop;

  for i in 1..n_conn loop
    begin
      select r into v_res from dblink_get_result('c' || i) as t(s text, r text);
      v_ok := v_ok + 1;
    exception when others then
      if sqlerrm like '%out_of_stock%' then v_out := v_out + 1; else v_other := v_other + 1; raise notice 'error อื่น: %', sqlerrm; end if;
    end;
    perform dblink_disconnect('c' || i);
  end loop;

  assert v_other = 0, 'ต้องไม่มี error อื่นนอกจาก out_of_stock';
  assert v_ok = 1, format('ต้องได้คนเดียว แต่ได้ %s', v_ok);
  assert v_out = n_conn - 1, format('อีก %s คนต้อง out_of_stock แต่ได้ %s', n_conn - 1, v_out);
  assert (select stock from public.products where sku = 'test-last') = 0, 'สต็อกต้องเป็น 0 พอดี';
  assert (select count(*) from public.shop_orders where user_id = any (v_uids)) = 1, 'ต้องมีออเดอร์ 1 รายการ';
  assert (select coalesce(sum(i.qty), 0) from public.shop_order_items i join public.products p on p.id = i.product_id where p.sku = 'test-last') = 1, 'ขายรวมต้อง 1 ชิ้น';
end $$;

-- เก็บกวาด (ถ้า assert ข้างบนตก ไฟล์หยุดก่อนถึงตรงนี้ — รอบหน้าบรรทัดล้างต้นไฟล์จัดการให้)
delete from public.shop_orders where user_id in (select id from auth.users where email like 'conc-%@test.local');
delete from auth.users where email like 'conc-%@test.local';
delete from public.products where sku = 'test-last';
drop extension dblink;
