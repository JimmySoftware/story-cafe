-- รับเงิน PromptPay ส่วนที่สาม: ทางสำรองสลิป (briefs/payment.md)
-- ลูกค้าส่งสลิปของออเดอร์ตัวเอง → พนักงานตรวจแล้วอนุมัติ/ปฏิเสธ · เขียนตารางผ่านฟังก์ชันเท่านั้น

create table public.payment_slips (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders (id),
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index payment_slips_order_id_idx on public.payment_slips (order_id);

alter table public.payment_slips enable row level security;
revoke all on public.payment_slips from anon, authenticated;
grant select on public.payment_slips to authenticated;

create policy "ผู้ใช้อ่านสลิปของออเดอร์ตัวเอง" on public.payment_slips for select to authenticated
  using (exists (select 1 from public.shop_orders o where o.id = order_id and o.user_id = auth.uid()));

-- ลูกค้าส่งสลิปของออเดอร์ตัวเอง (ออเดอร์คนอื่น/ไม่มี → not_found เหมือนกัน)
create function public.submit_slip(p_code text, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_order public.shop_orders;
  v_slip uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if btrim(coalesce(p_path, '')) = '' then
    raise exception 'bad_path';
  end if;
  select * into v_order from public.shop_orders where code = p_code and user_id = v_uid for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'not_pending';
  end if;
  if exists (select 1 from public.payment_slips where order_id = v_order.id and status = 'pending') then
    raise exception 'slip_pending';
  end if;
  insert into public.payment_slips (order_id, storage_path) values (v_order.id, btrim(p_path))
  returning id into v_slip;
  return jsonb_build_object('slip_id', v_slip, 'status', 'pending');
end $$;

-- พนักงานเท่านั้น (JWT app_metadata.role = 'staff' · ไม่เชื่อ user_metadata ที่ผู้ใช้แก้เองได้)
-- อนุมัติ → สลิป approved + ออเดอร์ paid (ยอดตามออเดอร์) · ปฏิเสธ → rejected + เหตุผล ออเดอร์ยัง pending
create function public.review_slip(p_slip uuid, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_slip public.payment_slips;
  v_order public.shop_orders;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'staff' then
    raise exception 'forbidden';
  end if;
  if p_approve is null then
    raise exception 'bad_request';
  end if;
  select * into v_slip from public.payment_slips where id = p_slip for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_slip.status <> 'pending' then
    raise exception 'already_reviewed';
  end if;

  if p_approve then
    select * into v_order from public.shop_orders where id = v_slip.order_id for update;
    if v_order.status = 'pending' then
      update public.shop_orders set status = 'paid' where id = v_order.id;
    elsif v_order.status <> 'paid' then
      raise exception 'not_pending';
    end if;
    update public.payment_slips set status = 'approved', reviewed_at = now() where id = v_slip.id;
    return jsonb_build_object('slip_id', v_slip.id, 'status', 'approved', 'order_status', 'paid');
  end if;

  update public.payment_slips set status = 'rejected', reason = p_reason, reviewed_at = now() where id = v_slip.id;
  return jsonb_build_object('slip_id', v_slip.id, 'status', 'rejected', 'order_status', 'pending');
end $$;

revoke all on function public.submit_slip(text, text) from public, anon, authenticated;
revoke all on function public.review_slip(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_slip(text, text) to authenticated;
grant execute on function public.review_slip(uuid, boolean, text) to authenticated;
