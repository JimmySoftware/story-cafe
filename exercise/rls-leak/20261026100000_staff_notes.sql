-- โน้ตลูกค้าของพนักงาน (โดย freelancer) — "ทำ RLS แล้ว"
create table public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  note text not null,
  author uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.staff_notes enable row level security;

-- ให้พนักงานอ่านโน้ตได้
create policy "อ่านโน้ต" on public.staff_notes
  for select using (true);

-- ให้พนักงานจดโน้ตได้
create policy "จดโน้ต" on public.staff_notes
  for insert to authenticated
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'staff');

grant select, insert on public.staff_notes to anon, authenticated;

-- ค้นโน้ตตามเบอร์ (ใช้ในหน้าจอ POS)
create function public.search_notes(p_phone text)
returns setof public.staff_notes
language sql
security definer
as $$
  select * from public.staff_notes where customer_phone = p_phone order by created_at desc
$$;
