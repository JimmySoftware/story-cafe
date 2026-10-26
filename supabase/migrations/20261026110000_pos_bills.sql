-- บิลหน้าร้าน (POS) ที่ส่งเข้ามาทีหลังตอนเน็ตหลุด (briefs/offline.md ข้อ 2)
-- ไม่มีใครเขียนตารางตรง ๆ ได้ — เขียนผ่าน pos_record_bill() เท่านั้น ซึ่งคิดราคา ส่วนลด แต้ม เงินทอนเองจาก menu_items/options
-- พนักงาน = JWT app_metadata.role = 'staff' (ไม่เชื่อ user_metadata ที่ผู้ใช้แก้เองได้)

create table public.pos_bills (
  id uuid primary key default gen_random_uuid(),
  client_order_id uuid not null unique,
  code text unique,
  subtotal int not null check (subtotal >= 0),
  discount int not null check (discount >= 0),
  total int not null check (total >= 0),
  cash_received int check (cash_received >= 0),
  change int check (change >= 0),
  points_earned int not null check (points_earned >= 0),
  points_redeemed int not null check (points_redeemed >= 0),
  customer_phone text,
  at timestamptz not null,
  created_at timestamptz not null default now(),
  staff uuid default auth.uid() references auth.users (id) on delete set null
);

create table public.pos_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.pos_bills (id) on delete cascade,
  item_name text not null,
  qty int not null check (qty > 0),
  unit_price int not null check (unit_price >= 0),
  line_total int not null check (line_total >= 0),
  label text not null,
  options jsonb not null default '{}'::jsonb
);
create index pos_bill_items_bill_id_idx on public.pos_bill_items (bill_id);

alter table public.pos_bills enable row level security;
alter table public.pos_bill_items enable row level security;

-- ตัดสิทธิ์ทั้งหมด แล้วให้อ่านได้อย่างเดียว (และผ่าน policy เฉพาะพนักงาน) · ไม่มี insert/update/delete ให้ใครเลย
revoke all on public.pos_bills, public.pos_bill_items from public, anon, authenticated;
grant select on public.pos_bills, public.pos_bill_items to authenticated;

create policy pos_bills_select on public.pos_bills
  for select to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff');

create policy pos_bill_items_select on public.pos_bill_items
  for select to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff');

-- บันทึกบิลหนึ่งใบ: กติกาคิดเงินเดียวกับ pos/src/bill.ts (computeBill) ทุกข้อ
-- idempotent: client_order_id เดิม → คืนบิลเดิม duplicate = true (ล็อกด้วย advisory lock ต่อ id กันสายพร้อมกันชน unique)
create function public.pos_record_bill(
  p_client_order_id uuid,
  p_lines jsonb,
  p_redeem_points int default 0,
  p_points_balance int default 0,
  p_cash_received int default null,
  p_at timestamptz default now(),
  p_customer_phone text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_redeem int := coalesce(p_redeem_points, 0);
  v_balance int := coalesce(p_points_balance, 0);
  v_bill public.pos_bills;
  v_line jsonb;
  v_opt jsonb;
  v_item record;
  v_extra record;
  v_qty numeric;
  v_shots numeric;
  v_unit int;
  v_parts text[];
  v_has_option boolean;
  v_items jsonb := '[]'::jsonb;
  v_subtotal int := 0;
  v_redeemed int;
  v_total int;
  v_change int;
  v_earned int;
  v_day text;
  v_seq int;
  v_code text;
  v_id uuid;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'staff' then
    raise exception 'forbidden: เฉพาะพนักงานเท่านั้นที่บันทึกบิลได้';
  end if;
  if p_client_order_id is null then
    raise exception 'bad_request: ต้องมี client_order_id';
  end if;

  -- สายที่ id เดียวกันเข้าทีละสาย: สายหลังเห็นบิลที่สายแรก commit แล้วและคืน duplicate
  perform pg_advisory_xact_lock(hashtextextended('pos_bill:' || p_client_order_id::text, 0));
  select * into v_bill from public.pos_bills where client_order_id = p_client_order_id;
  if found then
    return jsonb_build_object('id', v_bill.id, 'code', v_bill.code, 'subtotal', v_bill.subtotal, 'discount', v_bill.discount,
      'total', v_bill.total, 'change', v_bill.change, 'points_earned', v_bill.points_earned,
      'points_redeemed', v_bill.points_redeemed, 'duplicate', true);
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'empty_bill: ยังไม่มีรายการในบิล';
  end if;
  if v_redeem < 0 or v_balance < 0 then
    raise exception 'bad_points: แต้มต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select name, price, is_drink into v_item
      from public.menu_items where name = v_line ->> 'item' and active;
    if not found then
      raise exception 'unknown_item: ไม่มีเมนู "%"', coalesce(v_line ->> 'item', '');
    end if;

    if jsonb_typeof(v_line -> 'qty') is distinct from 'number' then
      raise exception 'bad_qty: จำนวนของ "%" ต้องเป็นจำนวนเต็ม 1–99', v_item.name;
    end if;
    v_qty := (v_line ->> 'qty')::numeric;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 99 then
      raise exception 'bad_qty: จำนวนของ "%" ต้องเป็นจำนวนเต็ม 1–99', v_item.name;
    end if;

    v_opt := coalesce(nullif(v_line -> 'options', 'null'::jsonb), '{}'::jsonb);
    if jsonb_typeof(v_opt) <> 'object' then
      raise exception 'bad_option: ตัวเลือกของ "%" ผิดรูปแบบ', v_item.name;
    end if;
    v_shots := 0;
    if v_opt ->> 'extra_shots' is not null then
      if jsonb_typeof(v_opt -> 'extra_shots') <> 'number' then
        raise exception 'bad_option: จำนวนช็อตเพิ่มต้องเป็นจำนวนเต็ม 0–4';
      end if;
      v_shots := (v_opt ->> 'extra_shots')::numeric;
    end if;
    if v_shots <> trunc(v_shots) or v_shots < 0 or v_shots > 4 then
      raise exception 'bad_option: จำนวนช็อตเพิ่มต้องเป็นจำนวนเต็ม 0–4';
    end if;
    v_has_option := (v_opt ->> 'size') is not null or (v_opt ->> 'sweetness') is not null
                    or (v_opt ->> 'milk') is not null or v_shots > 0;
    if v_has_option and not v_item.is_drink then
      raise exception 'bad_option: "%" ไม่ใช่เครื่องดื่ม เลือกตัวเลือกไม่ได้', v_item.name;
    end if;

    v_unit := v_item.price;
    v_parts := array[v_item.name];
    if (v_opt ->> 'size') is not null then
      select * into v_extra from public.options where kind = 'size' and label = v_opt ->> 'size';
      if not found then raise exception 'bad_option: ไม่มีตัวเลือก "%" ในหมวด size', v_opt ->> 'size'; end if;
      v_unit := v_unit + v_extra.price_delta;
      v_parts := v_parts || (v_opt ->> 'size');
    end if;
    if (v_opt ->> 'milk') is not null then
      select * into v_extra from public.options where kind = 'milk' and label = v_opt ->> 'milk';
      if not found then raise exception 'bad_option: ไม่มีตัวเลือก "%" ในหมวด milk', v_opt ->> 'milk'; end if;
      v_unit := v_unit + v_extra.price_delta;
      v_parts := v_parts || (v_opt ->> 'milk');
    end if;
    if (v_opt ->> 'sweetness') is not null then
      perform 1 from public.options where kind = 'sweetness' and label = v_opt ->> 'sweetness';
      if not found then raise exception 'bad_option: ไม่มีตัวเลือก "%" ในหมวด sweetness', v_opt ->> 'sweetness'; end if;
      v_parts := v_parts || ('หวาน ' || (v_opt ->> 'sweetness'));
    end if;
    if v_shots > 0 then
      select * into v_extra from public.options where kind = 'extra' order by sort limit 1;
      if not found then raise exception 'bad_option: ไม่มีตัวเลือกช็อตเพิ่มในแคตตาล็อก'; end if;
      v_unit := v_unit + v_shots::int * v_extra.price_delta;
      v_parts := v_parts || ('+shot ×' || v_shots::int);
    end if;

    v_items := v_items || jsonb_build_object('item_name', v_item.name, 'qty', v_qty::int, 'unit_price', v_unit,
      'line_total', v_unit * v_qty::int, 'label', array_to_string(v_parts, ' '), 'options', v_opt);
    v_subtotal := v_subtotal + v_unit * v_qty::int;
  end loop;

  v_redeemed := least(v_redeem, v_balance, v_subtotal);
  v_total := v_subtotal - v_redeemed;
  if p_cash_received is not null then
    if p_cash_received < v_total then
      raise exception 'cash_short: เงินที่รับ % บาท ไม่พอ ต้องจ่าย % บาท', p_cash_received, v_total;
    end if;
    v_change := p_cash_received - v_total;
  end if;
  v_earned := (v_total / 25) * case when extract(dow from v_at at time zone 'Asia/Bangkok') = 6 then 2 else 1 end;

  -- เลขบิล PB-YYYYMMDD-NNNN: ล็อกต่อวัน (วันไทยของ p_at) แล้วเอาเลขถัดจากที่มากสุดของวันนั้น
  v_day := to_char(v_at at time zone 'Asia/Bangkok', 'YYYYMMDD');
  perform pg_advisory_xact_lock(hashtextextended('pos_bill_code:' || v_day, 0));
  select coalesce(max(substring(code from 13)::int), 0) + 1 into v_seq
    from public.pos_bills where code like 'PB-' || v_day || '-%';
  v_code := 'PB-' || v_day || '-' || lpad(v_seq::text, 4, '0');

  insert into public.pos_bills (client_order_id, code, subtotal, discount, total, cash_received, change,
                                points_earned, points_redeemed, customer_phone, at)
  values (p_client_order_id, v_code, v_subtotal, v_redeemed, v_total, p_cash_received, v_change,
          v_earned, v_redeemed, p_customer_phone, v_at)
  returning id into v_id;

  insert into public.pos_bill_items (bill_id, item_name, qty, unit_price, line_total, label, options)
  select v_id, x.item_name, x.qty, x.unit_price, x.line_total, x.label, x.options
    from jsonb_to_recordset(v_items) as x(item_name text, qty int, unit_price int, line_total int, label text, options jsonb);

  return jsonb_build_object('id', v_id, 'code', v_code, 'subtotal', v_subtotal, 'discount', v_redeemed,
    'total', v_total, 'change', v_change, 'points_earned', v_earned, 'points_redeemed', v_redeemed, 'duplicate', false);
end $$;

revoke all on function public.pos_record_bill(uuid, jsonb, int, int, int, timestamptz, text) from public, anon, authenticated;
grant execute on function public.pos_record_bill(uuid, jsonb, int, int, int, timestamptz, text) to authenticated;
