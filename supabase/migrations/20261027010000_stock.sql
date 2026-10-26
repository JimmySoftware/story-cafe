-- สต็อกตามสูตร (briefs/owner.md ส่วน B): ตัดวัตถุดิบทุกครั้งที่ขายที่ POS + ประวัติ stock_history + stock_low()
-- พนักงาน = JWT app_metadata.role = 'staff' (ไม่เชื่อ user_metadata ที่ผู้ใช้แก้เองได้)

create table public.stock_history (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id),
  delta numeric not null,
  reason text,
  source text not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source, source_id, ingredient_id)
);
alter table public.stock_history enable row level security;
revoke all on public.stock_history from public, anon, authenticated;
grant select on public.stock_history to authenticated;
create policy stock_history_select on public.stock_history
  for select to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff');

-- กติกาตัวเลือกที่กระทบสต็อก เก็บเป็นข้อมูล (ไม่ใช่ if ในโค้ด) · อ้างวัตถุดิบด้วย "ชื่อ" เพราะ ingredients ถูกใส่โดย seed.sql หลัง migration
--   mode 'add'     = ตัด ingredient_name เพิ่ม amount ต่อ 1 หน่วยตัวเลือก (ช็อตเพิ่มคูณจำนวนช็อต)
--   mode 'replace' = ไม่ตัด replaces_ingredient_name ของสูตร แล้วตัด ingredient_name แทนเท่าปริมาณเดิมในสูตร (amount ว่าง)
--                    ingredient_name ว่าง = ไม่ตัดอะไรแทน (ร้านไม่ได้ติดตามสต็อกวัตถุดิบนั้น)
create table public.option_ingredients (
  id uuid primary key default gen_random_uuid(),
  option_kind text not null,
  option_label text not null,
  ingredient_name text,
  amount numeric check (amount is null or amount > 0),
  mode text not null check (mode in ('add', 'replace')),
  replaces_ingredient_name text,
  note text,
  check (mode <> 'add' or (ingredient_name is not null and amount is not null)),
  check (mode <> 'replace' or replaces_ingredient_name is not null)
);
alter table public.option_ingredients enable row level security;
revoke all on public.option_ingredients from public, anon, authenticated;
grant select on public.option_ingredients to authenticated;
create policy option_ingredients_select on public.option_ingredients
  for select to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff');

insert into public.option_ingredients (option_kind, option_label, ingredient_name, amount, mode, replaces_ingredient_name, note) values
  ('extra', 'เพิ่ม shot เอสเปรสโซ', 'เมล็ดกาแฟ Story House Blend', 18, 'add', null, 'ช็อตเพิ่มละ 18 g ต่อแก้ว คูณจำนวนช็อต'),
  ('milk', 'โอ๊ต', 'นมโอ๊ต', null, 'replace', 'นมวัว', 'ใช้นมโอ๊ตแทนนมวัวในปริมาณเท่าสูตร'),
  ('milk', 'อัลมอนด์', null, null, 'replace', 'นมวัว', 'ร้านไม่ได้ติดตามสต็อกนมอัลมอนด์ จึงไม่ตัดนมวัวและไม่ตัดอะไรแทน'),
  ('milk', 'ถั่วเหลือง', null, null, 'replace', 'นมวัว', 'ร้านไม่ได้ติดตามสต็อกนมถั่วเหลือง จึงไม่ตัดนมวัวและไม่ตัดอะไรแทน');

-- ตัดสต็อกของบิล POS หนึ่งใบ · เรียกจาก pos_record_bill เท่านั้น (ไม่ให้ anon/ลูกค้า/พนักงานเรียกตรง)
-- ต่อรายการ × qty: สูตร + ตัวเลือก (ตาม option_ingredients) · เบเกอรี่ไม่มีสูตรจึงไม่ตัด · ไซซ์ไม่เปลี่ยนปริมาณ
-- stock_history กับ ingredients.stock เปลี่ยนใน statement เดียวกัน · unique (source, source_id, ingredient_id) กันตัดซ้ำ
create function public.apply_stock_for_bill(p_bill uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_extra_label text;
begin
  select code into v_code from public.pos_bills where id = p_bill;
  select label into v_extra_label from public.options where kind = 'extra' order by sort limit 1;

  with lines as (
    select bi.id as line_id, bi.qty, m.id as menu_item_id, bi.options as opts
      from public.pos_bill_items bi
      join public.menu_items m on m.name = bi.item_name
     where bi.bill_id = p_bill
  ), chosen as (  -- ตัวเลือกที่เลือกในแต่ละรายการ (kind, label, จำนวนครั้ง)
    select l.line_id, 'milk' as kind, l.opts ->> 'milk' as label, 1 as times from lines l where l.opts ->> 'milk' is not null
    union all
    select l.line_id, 'size', l.opts ->> 'size', 1 from lines l where l.opts ->> 'size' is not null
    union all
    select l.line_id, 'extra', v_extra_label, (l.opts ->> 'extra_shots')::int
      from lines l where coalesce((l.opts ->> 'extra_shots')::int, 0) > 0
  ), deltas as (
    -- สูตรเดิม
    select i.name as ingredient_name, r.amount * l.qty as amount
      from lines l
      join public.recipes r on r.menu_item_id = l.menu_item_id
      join public.ingredients i on i.id = r.ingredient_id
    union all
    -- ตัวเลือกแบบ add
    select oi.ingredient_name, oi.amount * c.times * l.qty
      from chosen c
      join lines l on l.line_id = c.line_id
      join public.option_ingredients oi on oi.option_kind = c.kind and oi.option_label = c.label and oi.mode = 'add'
    union all
    -- ตัวเลือกแบบ replace: หักของที่แทนออกจากสูตร (เฉพาะรายการที่มีวัตถุดิบนั้นในสูตร) แล้วเติมตัวแทนเท่ากัน
    select x.name, x.amount
      from chosen c
      join lines l on l.line_id = c.line_id
      join public.option_ingredients oi on oi.option_kind = c.kind and oi.option_label = c.label and oi.mode = 'replace'
      join public.ingredients ri on ri.name = oi.replaces_ingredient_name
      join public.recipes r on r.menu_item_id = l.menu_item_id and r.ingredient_id = ri.id
      cross join lateral (values (oi.replaces_ingredient_name, -r.amount * l.qty),
                                 (oi.ingredient_name, coalesce(oi.amount * c.times, r.amount) * l.qty)) as x(name, amount)
     where x.name is not null
  ), used as (
    select ingredient_name, sum(amount) as amount from deltas group by ingredient_name having sum(amount) <> 0
  ), ins as (
    insert into public.stock_history (ingredient_id, delta, reason, source, source_id)
    select i.id, -u.amount, 'ขายที่ POS บิล ' || coalesce(v_code, p_bill::text), 'pos_bill', p_bill
      from used u join public.ingredients i on i.name = u.ingredient_name
    on conflict (source, source_id, ingredient_id) do nothing
    returning ingredient_id, delta
  )
  update public.ingredients g set stock = g.stock + ins.delta from ins where g.id = ins.ingredient_id;
end $$;
revoke all on function public.apply_stock_for_bill(uuid) from public, anon, authenticated;

create or replace function public.pos_record_bill(
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

  -- ตัดสต็อกตามสูตร (บิลซ้ำคืนผลไปก่อนถึงตรงนี้ จึงไม่ตัดซ้ำ)
  perform public.apply_stock_for_bill(v_id);

  return jsonb_build_object('id', v_id, 'code', v_code, 'subtotal', v_subtotal, 'discount', v_redeemed,
    'total', v_total, 'change', v_change, 'points_earned', v_earned, 'points_redeemed', v_redeemed, 'duplicate', false);
end $$;

revoke all on function public.pos_record_bill(uuid, jsonb, int, int, int, timestamptz, text) from public, anon, authenticated;
grant execute on function public.pos_record_bill(uuid, jsonb, int, int, int, timestamptz, text) to authenticated;

-- วัตถุดิบที่ใกล้หมด (stock <= reorder_level) เรียงตามชื่อ · เฉพาะพนักงาน
create function public.stock_low()
returns table (name text, unit text, stock numeric, reorder_level numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'staff' then
    raise exception 'forbidden: เฉพาะพนักงานหรือเจ้าของร้านเท่านั้นที่ดูสต็อกได้';
  end if;
  return query
    select i.name, i.unit, i.stock, i.reorder_level
      from public.ingredients i
     where i.stock <= i.reorder_level
     order by i.name;
end $$;
revoke all on function public.stock_low() from public, anon, authenticated;
grant execute on function public.stock_low() to authenticated;
