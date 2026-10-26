-- ปิดช่องให้ลูกค้าอ่านออเดอร์กันเอง (briefs/rls.md)
-- ถอน policy ชั่วคราวของบท 10 + ถอนสิทธิ์ตารางจาก anon/authenticated
-- ลูกค้าดูออเดอร์ตัวเองผ่าน lookup_order (รหัส + เบอร์ตรงกัน) เท่านั้น

drop policy "anon อ่านช่องรับ" on public.pickup_slots;
drop policy "anon อ่านออเดอร์ (ชั่วคราว)" on public.orders;
drop policy "anon อ่านรายการในออเดอร์ (ชั่วคราว)" on public.order_items;

revoke all on public.pickup_slots, public.orders, public.order_items from anon, authenticated;

create function public.lookup_order(p_code text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_order public.orders;
begin
  if v_phone <> '' then
    select * into v_order from public.orders
     where code = upper(btrim(coalesce(p_code, '')))
       and regexp_replace(phone, '[^0-9]', '', 'g') = v_phone;
  end if;
  if v_order.id is null then
    raise exception 'not_found';
  end if;
  return jsonb_build_object(
    'code', v_order.code,
    'status', v_order.status,
    'pickup_at', v_order.pickup_at,
    'total', v_order.total,
    'customer_name', v_order.customer_name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'qty', oi.qty, 'options', oi.options, 'unit_price', oi.unit_price)
                       order by oi.id)
        from public.order_items oi
        join public.menu_items m on m.id = oi.menu_item_id
       where oi.order_id = v_order.id
    ), '[]'::jsonb));
end $$;

revoke all on function public.lookup_order(text, text) from public, anon, authenticated;
grant execute on function public.lookup_order(text, text) to anon;
