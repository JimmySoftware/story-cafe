-- รับเงิน PromptPay ส่วนที่สอง: ฝั่งรับ webhook (briefs/payment.md)
-- stripe_events กันรับ event ซ้ำ · mark_order_paid / record_stripe_event เรียกได้เฉพาะ service_role

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ปิดทั้งหมดสำหรับลูกค้า (ไม่มี policy) · service_role ข้าม RLS
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- ใหม่ → true · เคยรับแล้ว → false
create function public.record_stripe_event(p_id text, p_type text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.stripe_events (id, type) values (p_id, p_type) on conflict (id) do nothing;
  return found;
end $$;

-- pending → paid เมื่อยอด (บาท) ตรงกับยอดออเดอร์เท่านั้น · เรียกซ้ำกับออเดอร์ที่ paid แล้วไม่ทำซ้ำ
create function public.mark_order_paid(p_code text, p_ref text, p_amount int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.shop_orders;
begin
  select * into v_order from public.shop_orders where code = p_code for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_order.status = 'paid' then
    return jsonb_build_object('already', true);
  end if;
  if v_order.status <> 'pending' then
    raise exception 'not_pending';
  end if;
  if p_amount is distinct from v_order.total then
    raise exception 'amount_mismatch';
  end if;
  update public.shop_orders set status = 'paid' where id = v_order.id;
  update public.payments set status = 'succeeded' where order_id = v_order.id;
  return jsonb_build_object('code', p_code, 'status', 'paid');
end $$;

revoke all on function public.record_stripe_event(text, text) from public, anon, authenticated;
revoke all on function public.mark_order_paid(text, text, int) from public, anon, authenticated;
grant execute on function public.record_stripe_event(text, text) to service_role;
grant execute on function public.mark_order_paid(text, text, int) to service_role;
