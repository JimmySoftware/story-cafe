-- ตารางข้อมูลร้าน (ตาม briefs/database.md)
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null unique,
  price int not null check (price >= 0),
  is_drink boolean not null,
  active boolean not null default true,
  sort int not null
);

create table public.options (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  label text not null,
  price_delta int not null,
  sort int not null,
  unique (kind, label)
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null check (unit in ('g', 'ml', 'pcs')),
  stock numeric not null,
  reorder_level numeric not null
);

create table public.recipes (
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  amount numeric not null check (amount > 0),
  primary key (menu_item_id, ingredient_id)
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false
);

alter table public.menu_items enable row level security;
alter table public.options enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.settings enable row level security;

-- anon อ่านได้อย่างเดียว; ingredients/recipes ไม่มี policy = anon มองไม่เห็น
create policy "anon อ่านเมนูที่เปิดขาย" on public.menu_items
  for select to anon using (active);
create policy "anon อ่านตัวเลือก" on public.options
  for select to anon using (true);
create policy "anon อ่าน settings ที่เป็น public" on public.settings
  for select to anon using (is_public);

revoke all on public.menu_items, public.options, public.ingredients, public.recipes, public.settings from anon;
grant select on public.menu_items, public.options, public.settings to anon;
