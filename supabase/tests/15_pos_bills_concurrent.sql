-- pos_record_bill พร้อมกัน: id เดียว 10 สาย → 1 แถว ไม่มี error · id ต่างกัน 10 สาย → code ไม่ซ้ำ
-- ใช้หลาย connection จริง (dblink) จึง commit ข้อมูลจริงระหว่างทดสอบ แล้วลบทิ้งเองท้ายไฟล์ · ผู้ใช้ทดสอบ pos-conc@test.local
create extension if not exists dblink with schema public;
select set_config('test.dbhost', :'dbhost', false);

-- บิลทดสอบตัดสต็อกจริงด้วย (commit แล้ว) จึงคืนสต็อกและลบประวัติของบิลเหล่านี้ก่อนลบบิล
update public.ingredients g set stock = g.stock - s.d
  from (select h.ingredient_id, sum(h.delta) as d from public.stock_history h
          join public.pos_bills b on b.id = h.source_id
         where h.source = 'pos_bill' and b.customer_phone = 'test-conc' group by 1) s
 where g.id = s.ingredient_id;
delete from public.stock_history h using public.pos_bills b
 where h.source = 'pos_bill' and h.source_id = b.id and b.customer_phone = 'test-conc';
delete from public.pos_bills where customer_phone = 'test-conc';
delete from auth.users where email = 'pos-conc@test.local';
insert into auth.users (id, aud, role, email) values (gen_random_uuid(), 'authenticated', 'authenticated', 'pos-conc@test.local');

do $$
declare
  n_conn constant int := 10;
  v_uid uuid := (select id from auth.users where email = 'pos-conc@test.local');
  v_same constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_res text; v_ok int; v_dup int; v_err int; i int; v_sql text; v_phase int;
  v_codes text[];
begin
  for i in 1..n_conn loop
    perform dblink_connect('c' || i, 'host=' || current_setting('test.dbhost') || ' port=5432 dbname=' || current_database() || ' user=postgres password=postgres');
    perform dblink_exec('c' || i, 'set role authenticated');
    perform dblink_exec('c' || i, format('set request.jwt.claims = %L',
      json_build_object('sub', v_uid, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'staff'))::text));
  end loop;

  for v_phase in 1..2 loop
    v_ok := 0; v_dup := 0; v_err := 0; v_codes := '{}';
    for i in 1..n_conn loop
      v_sql := format($q$select pg_sleep(greatest(extract(epoch from (%L::timestamptz - clock_timestamp())), 0)),
        public.pos_record_bill(%L::uuid, '[{"item":"ลาเต้","qty":1}]', 0, 0, null, '2026-10-26T10:00:00+07:00', 'test-conc')::text$q$,
        clock_timestamp() + interval '1 second',
        case v_phase when 1 then v_same else gen_random_uuid() end);
      perform dblink_send_query('c' || i, v_sql);
    end loop;
    for i in 1..n_conn loop
      begin
        select r into v_res from dblink_get_result('c' || i) as t(s text, r text);
        perform * from dblink_get_result('c' || i) as t(s text, r text);
        v_ok := v_ok + 1;
        if (v_res::jsonb ->> 'duplicate')::boolean then v_dup := v_dup + 1; end if;
        v_codes := v_codes || (v_res::jsonb ->> 'code');
      exception when others then
        v_err := v_err + 1; raise notice 'error: %', sqlerrm;
      end;
    end loop;
    assert v_err = 0, format('เฟส %s: ต้องไม่มีสายไหน error แต่มี %s', v_phase, v_err);
    if v_phase = 1 then
      assert (select count(*) from public.pos_bills where client_order_id = v_same) = 1, 'id เดียว 10 สายต้องได้ 1 แถว';
      assert v_dup = n_conn - 1, format('ต้อง duplicate %s สาย แต่ได้ %s', n_conn - 1, v_dup);
      assert (select count(distinct c) from unnest(v_codes) c) = 1, 'ทุกสายต้องได้ code เดียวกัน';
    else
      assert v_dup = 0, 'id ต่างกันต้องไม่มี duplicate';
      assert (select count(distinct c) from unnest(v_codes) c) = n_conn, 'id ต่างกัน code ต้องไม่ซ้ำ: ' || v_codes::text;
      assert (select count(*) from public.pos_bills where customer_phone = 'test-conc') = n_conn + 1, 'จำนวนแถวรวมผิด';
    end if;
  end loop;
  for i in 1..n_conn loop perform dblink_disconnect('c' || i); end loop;
end $$;

-- บิลทดสอบตัดสต็อกจริงด้วย (commit แล้ว) จึงคืนสต็อกและลบประวัติของบิลเหล่านี้ก่อนลบบิล
update public.ingredients g set stock = g.stock - s.d
  from (select h.ingredient_id, sum(h.delta) as d from public.stock_history h
          join public.pos_bills b on b.id = h.source_id
         where h.source = 'pos_bill' and b.customer_phone = 'test-conc' group by 1) s
 where g.id = s.ingredient_id;
delete from public.stock_history h using public.pos_bills b
 where h.source = 'pos_bill' and h.source_id = b.id and b.customer_phone = 'test-conc';
delete from public.pos_bills where customer_phone = 'test-conc';
delete from auth.users where email = 'pos-conc@test.local';
drop extension dblink;
