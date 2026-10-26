-- ระบบสั่งกาแฟล่วงหน้า (briefs/preorder.md + briefs/preorder-build.md)
-- กฎของร้านบังคับที่ฐานข้อมูล ตัวเลขทุกตัวอ่านจาก settings

-- 1) จำนวนแก้วที่เมนูกินโควตา: เบเกอรี่ = 0, ดริปกาแฟ เอธิโอเปีย = 2, อื่น ๆ = 1
alter table public.menu_items add column cup_units int not null default 1 check (cup_units >= 0);
update public.menu_items set cup_units = 0 where not is_drink;
update public.menu_items set cup_units = 2 where name = 'ดริปกาแฟ เอธิโอเปีย';

-- 2) ค่ากฎใน settings
insert into public.settings (key, value, is_public) values
  ('cups_per_slot', '6'::jsonb, true),
  ('slot_minutes', '10'::jsonb, true),
  ('min_lead_minutes', '15'::jsonb, true),
  ('cancel_cutoff_minutes', '30'::jsonb, true),
  ('expire_after_minutes', '30'::jsonb, true),
  ('preorder_days', '1'::jsonb, true)
on conflict (key) do nothing;

-- 3) ตาราง
create table public.pickup_slots (
  slot_start timestamptz primary key,
  cups_used int not null default 0 check (cups_used >= 0)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text not null,
  phone text not null,
  pickup_at timestamptz not null,
  status text not null default 'placed' check (status in ('placed', 'cancelled', 'picked_up', 'expired')),
  total int not null check (total >= 0),
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id),
  qty int not null check (qty > 0),
  options jsonb not null default '[]'::jsonb,
  unit_price int not null check (unit_price >= 0),
  cups int not null check (cups >= 0)
);
create index order_items_order_id_idx on public.order_items (order_id);

alter table public.pickup_slots enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- anon อ่านได้อย่างเดียว; เขียนผ่านฟังก์ชันเท่านั้น
-- ชั่วคราว: anon อ่าน orders/order_items ได้เพื่อหน้ายืนยันออเดอร์ (บท 11 จะปิดช่องนี้)
create policy "anon อ่านช่องรับ" on public.pickup_slots for select to anon using (true);
create policy "anon อ่านออเดอร์ (ชั่วคราว)" on public.orders for select to anon using (true);
create policy "anon อ่านรายการในออเดอร์ (ชั่วคราว)" on public.order_items for select to anon using (true);

revoke all on public.pickup_slots, public.orders, public.order_items from anon, authenticated;
grant select on public.pickup_slots, public.orders, public.order_items to anon;

-- 4) ตัวช่วยอ่านค่ากฎจาก settings (ภายในเท่านั้น)
create function public.preorder_setting(p_key text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  select (value #>> '{}')::numeric into v from public.settings where key = p_key;
  if v is null then
    raise exception 'missing_setting: ไม่พบค่า % ในตาราง settings', p_key;
  end if;
  return v;
end $$;
revoke all on function public.preorder_setting(text) from public, anon, authenticated;

-- 5) available_slots: ทุกช่องของวัน + เหลือกี่แก้ว + กดเลือกได้ไหม
create function public.available_slots(p_day date)
returns table (slot_start timestamptz, cups_left int, bookable boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_open time := (select (value #>> '{}')::time from public.settings where key = 'open_time');
  v_close time := (select (value #>> '{}')::time from public.settings where key = 'close_time');
  v_step int := public.preorder_setting('slot_minutes')::int;
  v_cups int := public.preorder_setting('cups_per_slot')::int;
  v_lead int := public.preorder_setting('min_lead_minutes')::int;
  v_days int := public.preorder_setting('preorder_days')::int;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_in_range boolean := p_day between v_today and v_today + v_days;
begin
  return query
  select s.t,
         greatest(v_cups - coalesce(ps.cups_used, 0), 0),
         v_in_range
           and v_cups - coalesce(ps.cups_used, 0) > 0
           and s.t - now() >= make_interval(mins => v_lead)
  from (
    select ((p_day + v_open) + make_interval(mins => i * v_step)) at time zone 'Asia/Bangkok' as t
    from generate_series(0, (extract(epoch from (v_close - v_open)) / 60 / v_step)::int - 1) as i
  ) s
  left join public.pickup_slots ps on ps.slot_start = s.t
  order by s.t;
end $$;

-- 6) place_preorder
create function public.place_preorder(p_name text, p_phone text, p_pickup timestamptz, p_items jsonb)
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
      insert into public.orders (code, customer_name, phone, pickup_at, total)
        values (v_code, btrim(p_name), btrim(p_phone), p_pickup, v_total) returning id into v_order_id;
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

-- 7) cancel_preorder
create function public.cancel_preorder(p_code text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cutoff int := public.preorder_setting('cancel_cutoff_minutes')::int;
  v_order public.orders;
  v_cups int;
begin
  select * into v_order from public.orders
   where code = upper(btrim(p_code))
     and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
   for update;
  if not found or regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') = '' then
    raise exception 'not_found: ไม่พบออเดอร์ หรือเบอร์โทรไม่ตรง';
  end if;
  if v_order.status <> 'placed' then
    raise exception 'not_cancellable: ออเดอร์นี้ยกเลิกไม่ได้แล้ว (สถานะ %)', v_order.status;
  end if;
  if v_order.pickup_at - now() < make_interval(mins => v_cutoff) then
    raise exception 'too_late_to_cancel: ยกเลิกได้ถึง % นาทีก่อนเวลารับเท่านั้น', v_cutoff;
  end if;

  select coalesce(sum(cups), 0) into v_cups from public.order_items where order_id = v_order.id;
  update public.orders set status = 'cancelled' where id = v_order.id;
  if v_cups > 0 then
    update public.pickup_slots set cups_used = greatest(cups_used - v_cups, 0) where slot_start = v_order.pickup_at;
  end if;
  return jsonb_build_object('code', v_order.code, 'status', 'cancelled', 'cups_returned', v_cups);
end $$;

-- 8) กฎข้อ 6: ออเดอร์ที่เลยเวลารับ expire_after_minutes แล้วไม่มาเอา ร้านทิ้งได้ (ให้ร้าน/ระบบหลังบ้านเรียก ไม่ใช่ลูกค้า)
create function public.expire_stale_preorders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.orders set status = 'expired'
   where status = 'placed'
     and pickup_at < now() - make_interval(mins => public.preorder_setting('expire_after_minutes')::int);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.available_slots(date), public.place_preorder(text, text, timestamptz, jsonb),
  public.cancel_preorder(text, text), public.expire_stale_preorders() from public, anon, authenticated;
grant execute on function public.available_slots(date), public.place_preorder(text, text, timestamptz, jsonb),
  public.cancel_preorder(text, text) to anon;
grant execute on function public.expire_stale_preorders() to service_role;
