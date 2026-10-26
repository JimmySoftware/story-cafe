-- rls_audit(): ตรวจความปลอดภัยของฐานข้อมูลร้าน (briefs/open-shop.md ข้อ 1)
-- คืนอาร์เรย์ของจุดที่ไม่ปลอดภัย [{"table","problem","detail"}] — ว่าง [] = ไม่พบ
-- รหัส: rls_off · anon_write · open_write_policy · definer_no_search_path
-- เรียกได้เฉพาะ service_role

create function public.rls_audit() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(f order by f ->> 'problem', f ->> 'table', f ->> 'detail'), '[]'::jsonb)
  from (
    -- ตารางใน public ที่ยังไม่เปิด RLS
    select jsonb_build_object('table', c.relname, 'problem', 'rls_off',
             'detail', 'ตารางนี้ยังไม่เปิด RLS ใครที่มีสิทธิ์ก็อ่านเขียนได้ทุกแถว') as f
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
    union all
    -- anon มีสิทธิ์เขียน (ระดับตารางหรือระดับคอลัมน์)
    select jsonb_build_object('table', c.relname, 'problem', 'anon_write',
             'detail', 'anon เขียนได้: ' || array_to_string(array_remove(array[
               case when has_any_column_privilege('anon', c.oid, 'insert') then 'insert' end,
               case when has_any_column_privilege('anon', c.oid, 'update') then 'update' end,
               case when has_table_privilege('anon', c.oid, 'delete') then 'delete' end], null), ', '))
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
       and (has_any_column_privilege('anon', c.oid, 'insert')
            or has_any_column_privilege('anon', c.oid, 'update')
            or has_table_privilege('anon', c.oid, 'delete'))
    union all
    -- policy เขียน/all ที่เงื่อนไขเป็น true ล้วน (ไม่นับ policy ที่ให้ service_role เท่านั้น)
    select jsonb_build_object('table', p.tablename, 'problem', 'open_write_policy',
             'detail', 'policy "' || p.policyname || '" (' || lower(p.cmd) || ') เปิดให้เขียนได้ทุกแถวโดยไม่มีเงื่อนไข')
      from pg_policies p
     where p.schemaname = 'public' and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and (lower(btrim(coalesce(p.qual, ''))) in ('true', '(true)')
            or lower(btrim(coalesce(p.with_check, ''))) in ('true', '(true)'))
       and p.roles <> array['service_role']::name[]
    union all
    -- ฟังก์ชัน security definer ใน public ที่ไม่ตั้ง search_path (ไม่นับฟังก์ชันของ extension)
    select jsonb_build_object('table', pr.proname, 'problem', 'definer_no_search_path',
             'detail', 'ฟังก์ชัน security definer ไม่ได้ตั้ง search_path: ' || pr.oid::regprocedure::text)
      from pg_proc pr
     where pr.pronamespace = 'public'::regnamespace and pr.prosecdef
       and not exists (select 1 from unnest(coalesce(pr.proconfig, '{}')) cfg where cfg like 'search_path=%')
       and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = pr.oid and d.deptype = 'e')
  ) t
$$;

revoke all on function public.rls_audit() from public, anon, authenticated;
grant execute on function public.rls_audit() to service_role;
