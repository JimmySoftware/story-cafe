-- สั่งพร้อมกัน: ช่องที่เหลือแก้วเดียว สั่งพร้อมกัน 10 คน ต้องได้คนเดียว
-- ต้องใช้หลาย connection จริง (dblink) จึง commit ข้อมูลจริงระหว่างทดสอบ แล้วลบทิ้งเองท้ายไฟล์
-- ใช้ช่อง "พรุ่งนี้ 16:50" และลบออเดอร์ของ test ตามชื่อลูกค้า (test-concurrent-*) · รหัสผ่านคือค่าเริ่มต้นของ Supabase ในเครื่องเท่านั้น
create extension if not exists dblink with schema public;
select set_config('test.dbhost', :'dbhost', false);

-- เตรียมช่องให้เหลือ 1 แก้ว และ commit ก่อน (connection อื่นต้องมองเห็น)
delete from public.orders where customer_name like 'test-concurrent-%';
delete from public.pickup_slots where slot_start = (((now() at time zone 'Asia/Bangkok')::date + 1 + time '16:50') at time zone 'Asia/Bangkok');
insert into public.pickup_slots (slot_start, cups_used)
  select (((now() at time zone 'Asia/Bangkok')::date + 1 + time '16:50') at time zone 'Asia/Bangkok'), (value #>> '{}')::int - 1 from public.settings where key = 'cups_per_slot';

do $$
declare
  b timestamptz := (((now() at time zone 'Asia/Bangkok')::date + 1 + time '10:00') at time zone 'Asia/Bangkok') + interval '6 hours 50 minutes';
  v_item uuid := (select id from public.menu_items where name = 'ลาเต้');
  n_conn constant int := 10;
  v_ok int := 0; v_full int := 0; v_other int := 0;
  v_res text; i int; v_sql text;
begin
  v_sql := format($q$select pg_sleep(greatest(extract(epoch from (%L::timestamptz - clock_timestamp())), 0)), public.place_preorder('test-concurrent-%%s', '0800000000', %L::timestamptz,
    jsonb_build_array(jsonb_build_object('menu_item_id', %L, 'qty', 1)))::text$q$, clock_timestamp() + interval '1 second', b, v_item);

  -- ต่อครบทุก connection ก่อน แล้วค่อยส่งคำสั่ง ทุกตัวรอถึงเวลาเดียวกัน (pg_sleep) จึงเริ่มพร้อมกันจริง
  for i in 1..n_conn loop
    perform dblink_connect('c' || i, 'host=' || current_setting('test.dbhost') || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres');
  end loop;
  for i in 1..n_conn loop
    perform dblink_send_query('c' || i, format(v_sql, i));
  end loop;

  for i in 1..n_conn loop
    begin
      select r into v_res from dblink_get_result('c' || i) as t(s text, r text);
      v_ok := v_ok + 1;
    exception when others then
      if sqlerrm like '%slot_full%' then v_full := v_full + 1; else v_other := v_other + 1; raise notice 'error อื่น: %', sqlerrm; end if;
    end;
    perform dblink_disconnect('c' || i);
  end loop;

  declare v_used int; v_orders int;
  begin
    select cups_used into v_used from public.pickup_slots where slot_start = b;
    select count(*) into v_orders from public.orders where customer_name like 'test-concurrent-%';
    assert v_other = 0, 'ต้องไม่มี error อื่นนอกจาก slot_full';
    assert v_ok = 1, format('ต้องได้คนเดียว แต่ได้ %s', v_ok);
    assert v_full = n_conn - 1, format('อีก %s คนต้อง slot_full แต่ได้ %s', n_conn - 1, v_full);
    assert v_orders = 1, 'ต้องมีออเดอร์ 1 รายการ';
    assert v_used = (select (value #>> '{}')::int from public.settings where key = 'cups_per_slot'), 'cups_used ต้องเท่า cups_per_slot พอดี ไม่เกิน';
  end;
end $$;

-- เก็บกวาด (ถ้า assert ข้างบนตก ไฟล์จะหยุดก่อนถึงตรงนี้ — รอบหน้าบรรทัด delete ต้นไฟล์จะล้างให้)
delete from public.orders where customer_name like 'test-concurrent-%';
delete from public.pickup_slots where slot_start = (((now() at time zone 'Asia/Bangkok')::date + 1 + time '16:50') at time zone 'Asia/Bangkok');
drop extension dblink;
