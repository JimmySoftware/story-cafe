-- mark_order_paid / record_stripe_event: เฉพาะ service_role · ยอดไม่ตรงไม่เปลี่ยนออเดอร์ · เรียกซ้ำไม่ทำซ้ำ · stripe_events ปิดทั้งหมด
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'a@test.local');
insert into public.shop_orders (id, code, user_id, total, ship_name, ship_phone, ship_address) values
  ('00000000-0000-0000-0000-00000000f001', 'SH-9001', '00000000-0000-0000-0000-0000000000a1', 380, 'ก', '0X-XXX-XXXX', 'สมมติ'),
  ('00000000-0000-0000-0000-00000000f002', 'SH-9002', '00000000-0000-0000-0000-0000000000a1', 380, 'ก', '0X-XXX-XXXX', 'สมมติ');
insert into public.payments (order_id, provider_ref, amount) values ('00000000-0000-0000-0000-00000000f001', 'pi_test_1', 380);

-- ลูกค้าและ anon เรียกไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare ok boolean;
begin
  begin perform public.mark_order_paid('SH-9001', 'pi_x', 380); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้องเรียก mark_order_paid ไม่ได้';
  begin perform public.record_stripe_event('evt_x', 'x'); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้องเรียก record_stripe_event ไม่ได้';
  begin perform 1 from public.stripe_events; ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าต้องอ่าน stripe_events ไม่ได้';
end $$;
set local role anon;
do $$
declare ok boolean;
begin
  begin perform public.mark_order_paid('SH-9001', 'pi_x', 380); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องเรียก mark_order_paid ไม่ได้';
  begin perform public.record_stripe_event('evt_x', 'x'); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องเรียก record_stripe_event ไม่ได้';
end $$;
reset role;

-- service_role
set local role service_role;
do $$
declare ok boolean; r jsonb;
begin
  assert public.record_stripe_event('evt_1', 'payment_intent.succeeded') = true, 'event ใหม่ต้อง true';
  assert public.record_stripe_event('evt_1', 'payment_intent.succeeded') = false, 'event ซ้ำต้อง false';

  begin perform public.mark_order_paid('SH-9001', 'pi_test_1', 1); ok := false; exception when others then ok := sqlerrm = 'amount_mismatch'; end;
  assert ok, 'ยอดไม่ตรงต้อง amount_mismatch';
  assert (select status from public.shop_orders where code = 'SH-9001') = 'pending', 'ยอดไม่ตรงต้องไม่เปลี่ยนออเดอร์';
  begin perform public.mark_order_paid('SH-0000', 'pi_x', 380); ok := false; exception when others then ok := sqlerrm = 'not_found'; end;
  assert ok, 'ไม่พบออเดอร์ต้อง not_found';

  r := public.mark_order_paid('SH-9001', 'pi_test_1', 380);
  assert (select status from public.shop_orders where code = 'SH-9001') = 'paid', 'ยอดตรงต้อง paid';
  assert (select status from public.payments where provider_ref = 'pi_test_1') = 'succeeded', 'payments ต้อง succeeded';
  assert public.mark_order_paid('SH-9001', 'pi_test_1', 380) = '{"already": true}'::jsonb, 'เรียกซ้ำต้อง already';
  -- ออเดอร์ที่ paid แล้วยอดผิดก็ไม่ทำอะไร (ไม่ error ไม่เปลี่ยน)
  assert public.mark_order_paid('SH-9001', 'pi_test_1', 1) = '{"already": true}'::jsonb, 'paid แล้วต้อง already';

  update public.shop_orders set status = 'cancelled' where code = 'SH-9002';
  begin perform public.mark_order_paid('SH-9002', 'pi_x', 380); ok := false; exception when others then ok := sqlerrm = 'not_pending'; end;
  assert ok, 'ออเดอร์ที่ยกเลิกแล้วต้องจ่ายไม่ได้';
  assert (select status from public.shop_orders where code = 'SH-9002') = 'cancelled', 'ต้องยัง cancelled';
end $$;
rollback;
