-- โน้ตลูกค้าของพนักงาน (เบอร์โทร + ข้อมูลสุขภาพ) — เฉพาะพนักงานเท่านั้น
-- พนักงาน = JWT app_metadata.role = 'staff' (ตั้งได้ฝั่งเซิร์ฟเวอร์ · ไม่เชื่อ user_metadata ที่ผู้ใช้แก้เองได้)
create table public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null,
  note text not null,
  author uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.staff_notes enable row level security;

-- ตัดสิทธิ์ที่ Supabase ให้เป็นค่าเริ่มต้นออกก่อน แล้วให้เฉพาะที่จำเป็น
revoke all on public.staff_notes from public, anon, authenticated;
grant select, insert on public.staff_notes to authenticated;

create policy staff_notes_select on public.staff_notes
  for select to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff');

-- author ต้องเป็นตัวผู้จดเอง
create policy staff_notes_insert on public.staff_notes
  for insert to authenticated
  with check (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff'
    and author = auth.uid()
  );

-- ค้นโน้ตตามเบอร์ (หน้าจอ POS) — security invoker: RLS ของผู้เรียกทำงานตามปกติ
create function public.search_notes(p_phone text)
returns setof public.staff_notes
language sql
security invoker
set search_path = ''
as $$
  select * from public.staff_notes where customer_phone = p_phone order by created_at desc
$$;

revoke all on function public.search_notes(text) from public, anon;
grant execute on function public.search_notes(text) to authenticated;
