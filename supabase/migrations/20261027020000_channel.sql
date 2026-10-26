-- ช่องทางขาย channel (briefs/channel.md ข้อ 1): store · line · web · delivery
-- ข้อมูลเก่าได้ค่าเริ่มต้น (pos_bills = store, orders/shop_orders = web)

alter table public.pos_bills add column channel text not null default 'store'
  check (channel in ('store', 'line', 'web', 'delivery'));
alter table public.orders add column channel text not null default 'web'
  check (channel in ('store', 'line', 'web', 'delivery'));
alter table public.shop_orders add column channel text not null default 'web'
  check (channel in ('store', 'line', 'web', 'delivery'));

-- ลบฟังก์ชันลายเซ็นเก่าก่อน กันมี overload ซ้อนจนเรียกกำกวม
drop function public.pos_record_bill(uuid, jsonb, int, int, int, timestamptz, text);
drop function public.place_preorder(text, text, timestamptz, jsonb);
drop function public.create_order(jsonb, jsonb);

create function public.pos_record_bill(
  p_client_order_id uuid,
  p_lines jsonb,
  p_redeem_points int default 0,
  p_points_balance int default 0,
  p_cash_received int default null,
  p_at timestamptz default now(),
  p_customer_phone text default null,
  p_channel text default 'store'
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
  if p_channel is null or p_channel not in ('store', 'line', 'web', 'delivery') then
    raise exception 'bad_channel: ช่องทางต้องเป็น store, line, web หรือ delivery เท่านั้น';
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
                                points_earned, points_redeemed, customer_phone, at, channel)
  values (p_client_order_id, v_code, v_subtotal, v_redeemed, v_total, p_cash_received, v_change,
          v_earned, v_redeemed, p_customer_phone, v_at, p_channel)
  returning id into v_id;

  insert into public.pos_bill_items (bill_id, item_name, qty, unit_price, line_total, label, options)
  select v_id, x.item_name, x.qty, x.unit_price, x.line_total, x.label, x.options
    from jsonb_to_recordset(v_items) as x(item_name text, qty int, unit_price int, line_total int, label text, options jsonb);

  -- ตัดสต็อกตามสูตร (บิลซ้ำคืนผลไปก่อนถึงตรงนี้ จึงไม่ตัดซ้ำ)
  perform public.apply_stock_for_bill(v_id);

  return jsonb_build_object('id', v_id, 'code', v_code, 'subtotal', v_subtotal, 'discount', v_redeemed,
    'total', v_total, 'change', v_change, 'points_earned', v_earned, 'points_redeemed', v_redeemed, 'duplicate', false);
end $$;

revoke all on function public.pos_record_bill(uuid, jsonb, int, int, int, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.pos_record_bill(uuid, jsonb, int, int, int, timestamptz, text, text) to authenticated;

create function public.place_preorder(p_name text, p_phone text, p_pickup timestamptz, p_items jsonb, p_channel text default 'web')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open time := (select (value #>> '{}')::time from public.settings where key = 'open_time');
  v_close time := (select (value #>> '{}')::time from public.settings where key = 'close_time');
  v_step int := public.preorder_setting('slot_minutes')::int;
  v_cups_max int := public.preorder_setting('cups_per_slot')::int;
  v_lead int := public.preorder_setting('min_lead_minutes')::int;
  v_days int := public.preorder_setting('preorder_days')::int;
  v_local timestamp := p_pickup at time zone 'Asia/Bangkok';
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_minutes numeric;
  v_item jsonb;
  v_menu public.menu_items;
  v_qty int;
  v_labels text[];
  v_found int;
  v_delta int;
  v_unit int;
  v_cups int;
  v_total_cups int := 0;
  v_total int := 0;
  v_lines jsonb := '[]'::jsonb;
  v_used int;
  v_order_id uuid;
  v_code text;
  v_try int := 0;
begin
  if p_channel is null or p_channel not in ('store', 'line', 'web', 'delivery') then
    raise exception 'bad_channel: ช่องทางต้องเป็น store, line, web หรือ delivery เท่านั้น';
  end if;
  if p_name is null or btrim(p_name) = '' or p_phone is null or btrim(p_phone) = '' then
    raise exception 'bad_customer: กรุณาใส่ชื่อและเบอร์โทร';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order: ยังไม่ได้เลือกเมนู';
  end if;
  if p_pickup is null then
    raise exception 'bad_slot: ไม่ได้ระบุเวลารับ';
  end if;

  -- เวลาต้องตรงช่อง (ต้นช่องพอดี ไม่มีวินาที)
  v_minutes := extract(epoch from v_local::time) / 60;
  if v_minutes <> floor(v_minutes) or (v_minutes::int % v_step) <> 0 then
    raise exception 'bad_slot: เวลารับต้องตรงช่อง % นาที', v_step;
  end if;
  if v_local::date > v_today + v_days then
    raise exception 'too_far: สั่งล่วงหน้าได้ไม่เกินพรุ่งนี้';
  end if;
  if v_local::time < v_open or v_local::time > v_close - make_interval(mins => v_step) then
    raise exception 'outside_hours: เวลารับอยู่นอกเวลาเปิดร้าน';
  end if;
  if p_pickup - now() < make_interval(mins => v_lead) then
    raise exception 'too_late: ต้องสั่งล่วงหน้าอย่างน้อย % นาที', v_lead;
  end if;

  -- ตรวจรายการ + คิดราคาที่ฐานข้อมูล (ไม่เชื่อราคาจากหน้าเว็บ)
  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item ->> 'qty', '') !~ '^[0-9]+$'
       or (v_item ->> 'qty')::int < 1 or coalesce(v_item ->> 'menu_item_id', '') !~* '^[0-9a-f-]{36}$' then
      raise exception 'bad_item: รายการสั่งไม่ถูกต้อง';
    end if;
    v_qty := (v_item ->> 'qty')::int;
    select * into v_menu from public.menu_items where id = (v_item ->> 'menu_item_id')::uuid and active;
    if not found then
      raise exception 'bad_item: ไม่พบเมนูที่เลือก';
    end if;

    if jsonb_typeof(coalesce(v_item -> 'options', '[]'::jsonb)) <> 'array' then
      raise exception 'bad_option: ตัวเลือกไม่ถูกต้อง';
    end if;
    select coalesce(array_agg(x), '{}') into v_labels from jsonb_array_elements_text(coalesce(v_item -> 'options', '[]'::jsonb)) x;

    v_delta := 0;
    if coalesce(array_length(v_labels, 1), 0) > 0 then
      if not v_menu.is_drink then
        raise exception 'bad_option: % ใช้ตัวเลือกไม่ได้', v_menu.name;
      end if;
      select count(*), coalesce(sum(price_delta), 0) into v_found, v_delta
        from public.options where label = any (v_labels);
      -- ทุกตัวเลือกต้องมีจริง ไม่ซ้ำ และแต่ละหมวด (ไซซ์/นม ฯลฯ) เลือกได้อย่างเดียว
      if v_found <> array_length(v_labels, 1)
         or (select count(distinct label) from unnest(v_labels) label) <> v_found
         or exists (select 1 from public.options where label = any (v_labels) group by kind having count(*) > 1) then
        raise exception 'bad_option: ตัวเลือกไม่มีในร้านหรือเลือกซ้ำหมวด';
      end if;
    end if;

    v_unit := v_menu.price + v_delta;
    v_cups := v_menu.cup_units * v_qty;
    v_total := v_total + v_unit * v_qty;
    v_total_cups := v_total_cups + v_cups;
    v_lines := v_lines || jsonb_build_object('menu_item_id', v_menu.id, 'qty', v_qty,
      'options', to_jsonb(v_labels), 'unit_price', v_unit, 'cups', v_cups);
  end loop;

  -- จองแก้วในช่อง: ล็อกแถวช่องก่อนนับ คนที่สั่งพร้อมกันจะเข้าทีละคน
  if v_total_cups > 0 then
    insert into public.pickup_slots (slot_start) values (p_pickup) on conflict do nothing;
    select cups_used into v_used from public.pickup_slots where slot_start = p_pickup for update;
    if v_used + v_total_cups > v_cups_max then
      raise exception 'slot_full: ช่องนี้เหลือ % แก้ว (ออเดอร์นี้ใช้ % แก้ว)', greatest(v_cups_max - v_used, 0), v_total_cups;
    end if;
    update public.pickup_slots set cups_used = cups_used + v_total_cups where slot_start = p_pickup;
  end if;

  loop
    v_code := 'SC-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    begin
      insert into public.orders (code, customer_name, phone, pickup_at, total, channel)
        values (v_code, btrim(p_name), btrim(p_phone), p_pickup, v_total, p_channel) returning id into v_order_id;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 50 then raise exception 'code_exhausted: สร้างเลขออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง'; end if;
    end;
  end loop;

  insert into public.order_items (order_id, menu_item_id, qty, options, unit_price, cups)
  select v_order_id, (l ->> 'menu_item_id')::uuid, (l ->> 'qty')::int, l -> 'options', (l ->> 'unit_price')::int, (l ->> 'cups')::int
  from jsonb_array_elements(v_lines) l;

  return jsonb_build_object('code', v_code, 'total', v_total, 'pickup_at', p_pickup);
end $$;

revoke all on function public.place_preorder(text, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.place_preorder(text, text, timestamptz, jsonb, text) to anon;

create function public.create_order(p_items jsonb, p_ship jsonb, p_channel text default 'web') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_ship ->> 'name', ''));
  v_phone text := btrim(coalesce(p_ship ->> 'phone', ''));
  v_address text := btrim(coalesce(p_ship ->> 'address', ''));
  v_item jsonb;
  v_qty numeric;
  v_line record;
  v_total int := 0;
  v_order_id uuid;
  v_code text;
begin
  if p_channel is null or p_channel not in ('store', 'line', 'web', 'delivery') then
    raise exception 'bad_channel: ช่องทางต้องเป็น store, line, web หรือ delivery เท่านั้น';
  end if;
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;
  if v_name = '' or v_phone = '' or v_address = '' then
    raise exception 'bad_ship';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'qty') is distinct from 'number' then
      raise exception 'bad_qty';
    end if;
    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 10 then
      raise exception 'bad_qty';
    end if;
  end loop;

  -- ทุก sku ต้องมีและ active
  if exists (select 1 from jsonb_array_elements(p_items) i
              where not exists (select 1 from public.products where sku = i ->> 'sku' and active)) then
    raise exception 'bad_product';
  end if;

  loop
    v_code := 'SH-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.shop_orders where code = v_code);
  end loop;
  insert into public.shop_orders (code, user_id, total, ship_name, ship_phone, ship_address, channel)
  values (v_code, v_uid, 0, v_name, v_phone, v_address, p_channel)
  returning id into v_order_id;

  -- รวม sku ซ้ำ · update เรียงตาม sku ล็อกแถวและตัดสต็อกแบบมีเงื่อนไข (กันสั่งพร้อมกันแล้วติดลบ / deadlock)
  for v_line in
    select p.id, p.sku, p.price, p.active, sum((i ->> 'qty')::int)::int as qty
      from jsonb_array_elements(p_items) i
      join public.products p on p.sku = i ->> 'sku'
     group by p.id, p.sku, p.price, p.active
     order by p.sku
  loop
    update public.products set stock = stock - v_line.qty where id = v_line.id and stock >= v_line.qty;
    if not found then
      raise exception 'out_of_stock: %', v_line.sku;
    end if;
    insert into public.shop_order_items (order_id, product_id, qty, unit_price)
    values (v_order_id, v_line.id, v_line.qty, v_line.price);
    v_total := v_total + v_line.qty * v_line.price;
  end loop;

  update public.shop_orders set total = v_total where id = v_order_id;

  return jsonb_build_object('code', v_code, 'total', v_total);
end $$;

revoke all on function public.create_order(jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_order(jsonb, jsonb, text) to anon, authenticated;

-- trigger คิวแจ้งเตือน: payload เพิ่ม channel ของออเดอร์นั้น
create or replace function public.enqueue_order_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_source text := case tg_table_name when 'orders' then 'preorder' else 'shop' end;
  v_code text;
  v_total int;
  v_channel text;
begin
  if tg_table_name = 'orders' then
    select code, total, channel into v_code, v_total, v_channel from public.orders where id = new.id;
  else
    select code, total, channel into v_code, v_total, v_channel from public.shop_orders where id = new.id;
  end if;
  if v_code is null then
    return null;
  end if;
  insert into public.notify_queue (kind, payload, dedupe_key)
  values ('order_placed', jsonb_build_object('code', v_code, 'total', v_total, 'source', v_source, 'channel', v_channel), 'order_placed:' || v_code)
  on conflict do nothing;
  return null;
exception when others then
  raise warning 'enqueue_order_notification: ใส่คิวแจ้งเตือนไม่สำเร็จ (sqlstate %)', sqlstate;
  return null;
end $$;

-- สรุปยอดขาย: เพิ่ม by_channel ครบสี่ช่องแม้เป็นศูนย์
create or replace function public.sales_summary(p_day date default (now() at time zone 'Asia/Bangkok')::date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Bangkok')::date);
  v_from timestamptz := (coalesce(p_day, (now() at time zone 'Asia/Bangkok')::date))::timestamp at time zone 'Asia/Bangkok';
  v_to timestamptz := ((coalesce(p_day, (now() at time zone 'Asia/Bangkok')::date)) + 1)::timestamp at time zone 'Asia/Bangkok';
  v_result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'staff' then
    raise exception 'forbidden: เฉพาะพนักงานหรือเจ้าของร้านเท่านั้นที่ดูสรุปยอดขายได้';
  end if;

  with sales as (
    -- POS: ทุกบิล · แก้ว = Σ qty × cup_units ของเมนู (เมนูที่หาไม่เจอนับ 0)
    select 'pos'::text as source, b.channel, b.at as ts, b.total,
           coalesce((select sum(i.qty * m.cup_units)
                       from public.pos_bill_items i
                       join public.menu_items m on m.name = i.item_name
                      where i.bill_id = b.id), 0)::int as cups
      from public.pos_bills b
     where b.at >= v_from and b.at < v_to
    union all
    -- สั่งล่วงหน้า: เฉพาะ placed / picked_up
    select 'preorder', o.channel, o.created_at, o.total,
           coalesce((select sum(oi.cups) from public.order_items oi where oi.order_id = o.id), 0)::int
      from public.orders o
     where o.status in ('placed', 'picked_up')
       and o.created_at >= v_from and o.created_at < v_to
    union all
    -- ร้านออนไลน์: เฉพาะ paid / shipped · ไม่นับแก้ว
    select 'shop', s.channel, s.created_at, s.total, 0
      from public.shop_orders s
     where s.status in ('paid', 'shipped')
       and s.created_at >= v_from and s.created_at < v_to
  ),
  src as (
    select k.source,
           count(s.source) as bills,
           coalesce(sum(s.total), 0) as revenue,
           coalesce(sum(s.cups), 0) as cups
      from (values ('pos'), ('preorder'), ('shop')) as k(source)
      left join sales s on s.source = k.source
     group by k.source
  ),
  chn as (
    select k.channel,
           count(s.channel) as bills,
           coalesce(sum(s.total), 0) as revenue,
           coalesce(sum(s.cups), 0) as cups
      from (values ('store'), ('line'), ('web'), ('delivery')) as k(channel)
      left join sales s on s.channel = k.channel
     group by k.channel
  ),
  hrs as (
    select extract(hour from ts at time zone 'Asia/Bangkok')::int as hour,
           count(*) as bills, sum(cups) as cups, sum(total) as revenue
      from sales
     group by 1
  )
  select jsonb_build_object(
    'day', to_char(v_day, 'YYYY-MM-DD'),
    'bills', (select coalesce(sum(bills), 0) from src)::int,
    'revenue', (select coalesce(sum(revenue), 0) from src)::int,
    'cups', (select coalesce(sum(cups), 0) from src)::int,
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', hour, 'bills', bills, 'cups', cups, 'revenue', revenue)
                                          order by hour) from hrs), '[]'::jsonb),
    'by_source', (select jsonb_object_agg(source, jsonb_build_object('bills', bills, 'revenue', revenue, 'cups', cups)) from src),
    'by_channel', (select jsonb_object_agg(channel, jsonb_build_object('bills', bills, 'revenue', revenue, 'cups', cups)) from chn)
  ) into v_result;

  return v_result;
end $$;

-- สรุปเช้า: เพิ่ม by_channel = จำนวนออเดอร์ของวันนั้นแยกช่อง
create or replace function public.morning_summary_data(p_day date default (now() at time zone 'Asia/Bangkok')::date)
returns jsonb
language sql stable security definer set search_path = public as $$
  with day_orders as (
    select id, channel, pickup_at at time zone 'Asia/Bangkok' as local_pickup
      from public.orders
     where status in ('placed', 'confirmed')
       and (pickup_at at time zone 'Asia/Bangkok')::date = p_day
  )
  select jsonb_build_object(
    'day', to_char(p_day, 'YYYY-MM-DD'),
    'orders', (select count(*) from day_orders),
    'cups', coalesce((select sum(oi.cups) from public.order_items oi join day_orders d on d.id = oi.order_id), 0),
    'first_pickup', (select to_char(min(local_pickup), 'HH24:MI') from day_orders),
    'last_pickup', (select to_char(max(local_pickup), 'HH24:MI') from day_orders),
    'by_channel', jsonb_build_object(
      'store', (select count(*) from day_orders where channel = 'store'),
      'line', (select count(*) from day_orders where channel = 'line'),
      'web', (select count(*) from day_orders where channel = 'web'),
      'delivery', (select count(*) from day_orders where channel = 'delivery')),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'stock', stock, 'unit', unit, 'reorder_level', reorder_level) order by name)
        from public.ingredients
       where stock <= reorder_level
    ), '[]'::jsonb)
  );
$$;
