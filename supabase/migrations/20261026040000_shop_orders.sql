-- ร้านเมล็ดกาแฟและ drip bag (briefs/shop.md)
-- สต็อกและราคาจัดการที่ฐานข้อมูลเท่านั้น · สั่งผ่าน create_order ต้องล็อกอิน

-- 1) สินค้าอยู่ในตาราง products แล้ว ย้าย key products ออกจาก settings
delete from public.settings where key = 'products';

-- 2) ตาราง
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  price int not null check (price >= 0),
  stock int not null check (stock >= 0),
  active boolean not null default true,
  sort int
);

create table public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references auth.users (id),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled', 'shipped')),
  total int not null check (total >= 0),
  ship_name text not null,
  ship_phone text not null,
  ship_address text not null,
  created_at timestamptz not null default now()
);
create index shop_orders_user_id_idx on public.shop_orders (user_id);

create table public.shop_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty int not null check (qty > 0),
  unit_price int not null check (unit_price >= 0)
);
create index shop_order_items_order_id_idx on public.shop_order_items (order_id);

-- 3) RLS: เขียนตารางตรง ๆ ไม่ได้เลย (ฟังก์ชัน security definer เขียนแทน)
alter table public.products enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_items enable row level security;

revoke all on public.products, public.shop_orders, public.shop_order_items from anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.shop_orders, public.shop_order_items to authenticated;

create policy "ทุกคนอ่านสินค้าที่ขายอยู่" on public.products for select to anon, authenticated using (active);
create policy "ผู้ใช้อ่านออเดอร์ตัวเอง" on public.shop_orders for select to authenticated using (user_id = auth.uid());
create policy "ผู้ใช้อ่านรายการในออเดอร์ตัวเอง" on public.shop_order_items for select to authenticated
  using (exists (select 1 from public.shop_orders o where o.id = order_id and o.user_id = auth.uid()));

-- 4) สั่งซื้อ: ตรวจ + ตัดสต็อก + สร้างออเดอร์ใน transaction เดียว (exception = ยกเลิกทั้งหมด)
create function public.create_order(p_items jsonb, p_ship jsonb) returns jsonb
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
  insert into public.shop_orders (code, user_id, total, ship_name, ship_phone, ship_address)
  values (v_code, v_uid, 0, v_name, v_phone, v_address)
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

revoke all on function public.create_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb, jsonb) to anon, authenticated;
