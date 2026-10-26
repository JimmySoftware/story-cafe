-- staff_notes: anon อ่าน/จด/ค้นไม่ได้ · ลูกค้า (แม้ตั้ง user_metadata.role = staff เอง) ทำไม่ได้ · พนักงานทำได้ · author = auth.uid()
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'staff@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated', 'cust@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'staff2@test.local');
insert into public.staff_notes (customer_phone, note, author) values
  ('0X-XXX-0001', 'แพ้ถั่ว (ข้อมูลทดสอบ)', '00000000-0000-0000-0000-0000000000c1');

-- anon: ไม่มีสิทธิ์อะไรเลย
set local role anon;
do $$
begin
  begin perform 1 from public.staff_notes; assert false, 'anon อ่าน staff_notes ได้';
  exception when insufficient_privilege then null; end;
  begin insert into public.staff_notes (customer_phone, note) values ('0X-XXX-0002', 'x'); assert false, 'anon จดโน้ตได้';
  exception when insufficient_privilege then null; end;
  begin perform public.search_notes('0X-XXX-0001'); assert false, 'anon เรียก search_notes ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ลูกค้า: ตั้ง user_metadata.role = staff เองก็ไม่ผ่าน
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated","user_metadata":{"role":"staff"}}', true);
do $$
declare n int;
begin
  select count(*) into n from public.staff_notes;
  assert n = 0, 'ลูกค้าต้องเห็น 0 แถว แต่เห็น ' || n;
  select count(*) into n from public.search_notes('0X-XXX-0001');
  assert n = 0, 'ลูกค้าค้นผ่าน search_notes ต้องไม่เจอ แต่เจอ ' || n;
  begin
    insert into public.staff_notes (customer_phone, note) values ('0X-XXX-0002', 'ปลอม');
    assert false, 'ลูกค้าจดโน้ตได้';
  exception when insufficient_privilege then null; end;
end $$;
-- ลูกค้าที่ไม่มี role เลยก็เหมือนกัน
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.staff_notes) = 0, 'ลูกค้าทั่วไปต้องเห็น 0 แถว';
  begin
    insert into public.staff_notes (customer_phone, note) values ('0X-XXX-0002', 'ปลอม');
    assert false, 'ลูกค้าทั่วไปจดโน้ตได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- พนักงาน (app_metadata.role = staff)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare a uuid;
begin
  assert (select count(*) from public.staff_notes) = 1, 'พนักงานต้องอ่านได้';
  assert (select count(*) from public.search_notes('0X-XXX-0001')) = 1, 'พนักงานต้องค้นด้วย search_notes ได้';
  insert into public.staff_notes (customer_phone, note) values ('0X-XXX-0003', 'ชอบลาเต้ร้อนหวานน้อย') returning author into a;
  assert a = '00000000-0000-0000-0000-0000000000c3', 'author ต้องเป็น auth.uid() ให้เอง แต่ได้ ' || coalesce(a::text, 'null');
  begin
    insert into public.staff_notes (customer_phone, note, author) values ('0X-XXX-0004', 'ปลอมผู้เขียน', '00000000-0000-0000-0000-0000000000c1');
    assert false, 'พนักงานปลอม author เป็นคนอื่นได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
