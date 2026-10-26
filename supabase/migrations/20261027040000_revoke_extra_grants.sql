-- ผลจาก security review (docs/security-review.md): ถอนสิทธิ์เขียนที่เกินจำเป็นของ authenticated
-- ตารางข้อมูลร้านห้าตัวนี้ authenticated (ลูกค้าที่สมัครสมาชิก/พนักงาน) ได้สิทธิ์ insert/update/delete/truncate/references/trigger มาจากสิทธิ์เริ่มต้นของ Supabase
-- ตอนนี้ RLS กัน insert/update/delete ไว้ (ไม่มี policy เขียน) แต่ TRUNCATE ไม่ผ่าน RLS และชั้นป้องกันเหลือชั้นเดียว
-- ไม่มีแอปไหนเขียนตารางพวกนี้ผ่านสิทธิ์ authenticated (แก้ข้อมูลร้านผ่าน migration/seed หรือ service_role) จึงถอนได้ · SELECT ยังอยู่เหมือนเดิม

revoke insert, update, delete, truncate, references, trigger
  on public.ingredients, public.menu_items, public.options, public.recipes, public.settings
  from public, anon, authenticated;
