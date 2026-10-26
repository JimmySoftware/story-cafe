-- payments: ลูกค้าอ่านได้เฉพาะของออเดอร์ตัวเอง · เขียนเองไม่ได้ · anon อ่านไม่ได้
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'b@test.local');
insert into public.shop_orders (id, code, user_id, total, ship_name, ship_phone, ship_address) values
  ('00000000-0000-0000-0000-00000000f001', 'SH-9001', '00000000-0000-0000-0000-0000000000a1', 380, 'ก', '0X-XXX-XXXX', 'สมมติ');
insert into public.payments (order_id, provider_ref, amount) values ('00000000-0000-0000-0000-00000000f001', 'pi_test_1', 380);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare ok boolean;
begin
  assert (select count(*) from public.payments) = 1, 'เจ้าของออเดอร์ต้องเห็น payments ของตัวเอง';
  assert (select status from public.payments) = 'created', 'status เริ่มต้นต้องเป็น created';
  begin insert into public.payments (order_id, provider_ref, amount) values ('00000000-0000-0000-0000-00000000f001', 'pi_x', 1); ok := false;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้องเขียน payments เองไม่ได้';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
do $$ begin assert (select count(*) from public.payments) = 0, 'คนอื่นต้องไม่เห็น payments'; end $$;

set local role anon;
do $$
declare ok boolean;
begin
  begin perform 1 from public.payments; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน payments ไม่ได้';
end $$;
rollback;
