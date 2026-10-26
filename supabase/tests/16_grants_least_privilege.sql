-- สิทธิ์น้อยที่สุด (security review): authenticated/anon เขียน/ล้างตารางข้อมูลร้านไม่ได้เลย แต่ยังอ่านตามเดิม · rollback ทุกอย่าง
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'grant-cust@test.local');

do $$
declare t text; p text; r text;
begin
  foreach t in array array['ingredients', 'menu_items', 'options', 'recipes', 'settings'] loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        assert not has_table_privilege(r, 'public.' || t, p), r || ' ยังมีสิทธิ์ ' || p || ' บน ' || t;
      end loop;
    end loop;
  end loop;
  -- อ่านยังได้ตามเดิม
  assert has_table_privilege('anon', 'public.menu_items', 'select'), 'anon ต้องอ่านเมนูได้';
  assert has_table_privilege('anon', 'public.settings', 'select'), 'anon ต้องอ่าน settings ได้';
  assert has_table_privilege('authenticated', 'public.recipes', 'select'), 'authenticated ต้องอ่านสูตรได้';
end $$;

-- ลูกค้าที่ล็อกอินแล้วสั่งล้างตาราง/แก้ราคาไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$
declare ok boolean;
begin
  ok := false; begin truncate public.menu_items; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้า truncate menu_items ได้';
  ok := false; begin update public.settings set value = '"x"'::jsonb where key = 'shop_name'; exception when insufficient_privilege then ok := true; end;
  assert ok, 'ลูกค้าแก้ settings ได้';
end $$;
reset role;
rollback;
