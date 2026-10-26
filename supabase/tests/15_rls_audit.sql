-- rls_audit: เรียกได้เฉพาะ service_role · ระบบจริงของร้านต้องได้ [] · จับ rls_off / anon_write / open_write_policy / definer_no_search_path ได้ครบ
-- และไม่แจ้งผิดกับ policy อ่าน, policy ของ service_role, ฟังก์ชันที่ตั้ง search_path · rollback ทุกอย่าง
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'audit-staff@test.local');

-- anon / ลูกค้า / พนักงาน เรียกไม่ได้
set local role anon;
do $$ begin
  begin perform public.rls_audit(); assert false, 'anon เรียก rls_audit ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$ begin
  begin perform public.rls_audit(); assert false, 'พนักงานเรียก rls_audit ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- service_role เรียกได้ และระบบจริงต้องว่าง
set local role service_role;
do $$ begin
  assert public.rls_audit() = '[]'::jsonb, 'ระบบจริงต้องได้ [] แต่ได้ ' || public.rls_audit()::text;
end $$;
reset role;

-- ปล่อยของไม่ปลอดภัยเข้าไปให้ครบทุกแบบ
create table public.audit_t_off (id int);                        -- ไม่เปิด RLS (+ anon เขียนได้จากสิทธิ์เริ่มต้น)
create table public.audit_t_open (id int);                       -- เปิด RLS แต่ policy เปิดโล่ง
alter table public.audit_t_open enable row level security;
revoke all on public.audit_t_open from anon;
create policy audit_open_all on public.audit_t_open for all to authenticated using (true);
create policy audit_open_ins on public.audit_t_open for insert to authenticated with check (true);
create table public.audit_t_ok (id int);                         -- policy ที่ไม่ผิด ต้องไม่ถูกแจ้ง
alter table public.audit_t_ok enable row level security;
revoke all on public.audit_t_ok from anon;
create policy audit_ok_read on public.audit_t_ok for select to authenticated using (true);
create policy audit_ok_svc on public.audit_t_ok for all to service_role using (true) with check (true);
create policy audit_ok_cond on public.audit_t_ok for update to authenticated using (id = 1) with check (id = 1);
create function public.audit_f_bad() returns int language sql security definer as $f$ select 1 $f$;
create function public.audit_f_ok() returns int language sql security definer set search_path = '' as $f$ select 1 $f$;
create function public.audit_f_invoker() returns int language sql as $f$ select 1 $f$;

set local role service_role;
do $$
declare r jsonb := public.rls_audit();
begin
  assert exists (select 1 from jsonb_array_elements(r) e where e ->> 'table' = 'audit_t_off' and e ->> 'problem' = 'rls_off'), 'ไม่เจอ rls_off';
  assert exists (select 1 from jsonb_array_elements(r) e where e ->> 'table' = 'audit_t_off' and e ->> 'problem' = 'anon_write'), 'ไม่เจอ anon_write';
  assert (select count(*) from jsonb_array_elements(r) e where e ->> 'table' = 'audit_t_open' and e ->> 'problem' = 'open_write_policy') = 2, 'ต้องเจอ open_write_policy 2 policy (all + insert)';
  assert not exists (select 1 from jsonb_array_elements(r) e where e ->> 'table' = 'audit_t_open' and e ->> 'problem' <> 'open_write_policy'), 'audit_t_open ต้องมีแต่ open_write_policy';
  assert not exists (select 1 from jsonb_array_elements(r) e where e ->> 'table' = 'audit_t_ok'), 'audit_t_ok ต้องไม่ถูกแจ้ง: ' || r::text;
  assert exists (select 1 from jsonb_array_elements(r) e where e ->> 'table' = 'audit_f_bad' and e ->> 'problem' = 'definer_no_search_path'), 'ไม่เจอ definer_no_search_path';
  assert not exists (select 1 from jsonb_array_elements(r) e where e ->> 'table' in ('audit_f_ok', 'audit_f_invoker')), 'ฟังก์ชันที่ไม่ผิดต้องไม่ถูกแจ้ง';
  assert (select bool_and(e ?& array['table', 'problem', 'detail'] and e ->> 'detail' <> '') from jsonb_array_elements(r) e), 'ทุกจุดต้องมี table/problem/detail';
  assert (select count(*) from jsonb_array_elements(r)) = 5, 'ต้องเจอพอดี 5 จุด แต่ได้ ' || r::text;
end $$;
reset role;
rollback;
