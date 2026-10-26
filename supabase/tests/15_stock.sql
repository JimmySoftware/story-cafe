-- สต็อกตามสูตร: ลาเต้โอ๊ต + 2 ช็อต × 2 แก้ว · นมทางเลือกที่ไม่ติดตาม · บิลซ้ำไม่ตัดซ้ำ · สิทธิ์ · stock_low · rollback ทุกอย่าง
begin;
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'stk-staff@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'stk-cust@test.local');

-- ตัวช่วยของ test (rollback ทิ้งไปด้วย): ingredients ปิดไม่ให้ authenticated อ่านตรง ๆ จึงอ่านผ่าน security definer
create function public.t_stock(p_name text) returns numeric language sql security definer set search_path = '' as
  $$ select stock from public.ingredients where name = p_name $$;
create function public.t_hist(p_name text, p_bill uuid default null) returns numeric language sql security definer set search_path = '' as
  $$ select coalesce(sum(h.delta), 0) from public.stock_history h join public.ingredients i on i.id = h.ingredient_id
      where i.name = p_name and (p_bill is null or h.source_id = p_bill) $$;
create function public.t_hist_rows(p_name text, p_bill uuid) returns bigint language sql security definer set search_path = '' as
  $$ select count(*) from public.stock_history h join public.ingredients i on i.id = h.ingredient_id
      where i.name = p_name and h.source_id = p_bill $$;
grant execute on function public.t_stock(text), public.t_hist(text, uuid), public.t_hist_rows(text, uuid) to authenticated;

-- จดสต็อกก่อนขาย (อ่านด้วยสิทธิ์ postgres ก่อนสลับ role) · ข้อมูลตั้งต้นของตารางตัวเลือกต้องมีอย่างน้อย 3 แถว
select set_config('test.beans0', (select stock::text from public.ingredients where name = 'เมล็ดกาแฟ Story House Blend'), true),
       set_config('test.cow0', (select stock::text from public.ingredients where name = 'นมวัว'), true),
       set_config('test.oat0', (select stock::text from public.ingredients where name = 'นมโอ๊ต'), true),
       set_config('test.syrup0', (select stock::text from public.ingredients where name = 'น้ำเชื่อม'), true),
       -- ผลรวมประวัติที่มีอยู่ก่อนเริ่ม (ข้อมูลค้างจากการรันอื่นไม่ควรทำให้ test นี้ตก จึงเทียบเฉพาะส่วนต่าง)
       set_config('test.beans_h0', (select coalesce(sum(h.delta), 0)::text from public.stock_history h join public.ingredients i on i.id = h.ingredient_id where i.name = 'เมล็ดกาแฟ Story House Blend'), true),
       set_config('test.cow_h0', (select coalesce(sum(h.delta), 0)::text from public.stock_history h join public.ingredients i on i.id = h.ingredient_id where i.name = 'นมวัว'), true),
       set_config('test.oat_h0', (select coalesce(sum(h.delta), 0)::text from public.stock_history h join public.ingredients i on i.id = h.ingredient_id where i.name = 'นมโอ๊ต'), true);
do $$ begin assert (select count(*) from public.option_ingredients) >= 3, 'option_ingredients ต้องมีข้อมูลตั้งต้นอย่างน้อย 3 แถว'; end $$;

-- anon / ลูกค้า (แม้ตั้ง user_metadata.role เอง) เรียกฟังก์ชันสต็อกหรืออ่าน/เขียนประวัติไม่ได้
set local role anon;
do $$
begin
  begin perform public.apply_stock_for_bill(gen_random_uuid()); assert false, 'anon เรียก apply_stock_for_bill ได้';
  exception when insufficient_privilege then null; end;
  begin perform public.stock_low(); assert false, 'anon เรียก stock_low ได้';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.stock_history; assert false, 'anon อ่าน stock_history ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated","user_metadata":{"role":"staff"}}', true);
do $$
begin
  begin perform public.apply_stock_for_bill(gen_random_uuid()); assert false, 'ลูกค้าเรียก apply_stock_for_bill ได้';
  exception when insufficient_privilege then null; end;
  begin perform public.stock_low(); assert false, 'ลูกค้าเรียก stock_low ได้';
  exception when others then assert sqlerrm like 'forbidden:%', 'ต้องได้ forbidden แต่ได้ ' || sqlerrm; end;
  assert (select count(*) from public.stock_history) = 0, 'ลูกค้าเห็น stock_history';
  begin insert into public.stock_history (ingredient_id, delta, source, source_id)
    select id, 1, 'x', gen_random_uuid() from public.ingredients limit 1; assert false, 'ลูกค้าเขียน stock_history ได้';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- พนักงาน
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare
  v_id constant uuid := '44444444-4444-4444-8444-444444444444';
  r jsonb; r2 jsonb;
  v_beans0 numeric := current_setting('test.beans0')::numeric;
  v_cow0 numeric := current_setting('test.cow0')::numeric;
  v_oat0 numeric := current_setting('test.oat0')::numeric;
  v_syrup0 numeric := current_setting('test.syrup0')::numeric;
  v_beans_h0 numeric := current_setting('test.beans_h0')::numeric;
  v_cow_h0 numeric := current_setting('test.cow_h0')::numeric;
  v_oat_h0 numeric := current_setting('test.oat_h0')::numeric;
  v_bill uuid;
begin
  -- พนักงานเขียน stock_history ตรง ๆ ไม่ได้
  begin insert into public.stock_history (ingredient_id, delta, source, source_id)
    select id, 1, 'x', gen_random_uuid() from public.ingredients limit 1; assert false, 'พนักงานเขียน stock_history ได้';
  exception when insufficient_privilege then null; end;
  begin perform public.apply_stock_for_bill(gen_random_uuid()); assert false, 'พนักงานเรียก apply_stock_for_bill ตรง ๆ ได้';
  exception when insufficient_privilege then null; end;

  -- 1) ลาเต้โอ๊ต + 2 ช็อต × 2 แก้ว: เมล็ด 2×(18+2×18) = 108 g · นมโอ๊ต 2×180 = 360 ml · นมวัว 0
  r := public.pos_record_bill(v_id, '[{"item":"ลาเต้","qty":2,"options":{"milk":"โอ๊ต","extra_shots":2,"size":"L"}}]');
  assert (r ->> 'duplicate')::boolean = false, 'บิลแรกต้องไม่ duplicate';
  v_bill := (r ->> 'id')::uuid;
  assert public.t_stock('เมล็ดกาแฟ Story House Blend') = v_beans0 - 108, 'เมล็ดต้อง -108';
  assert public.t_stock('นมโอ๊ต') = v_oat0 - 360, 'นมโอ๊ตต้อง -360';
  assert public.t_stock('นมวัว') = v_cow0, 'นมวัวต้องไม่ถูกตัด';
  assert (select count(*) from public.stock_history where source = 'pos_bill' and source_id = v_bill) = 2, 'ประวัติต้องมี 2 แถว (เมล็ด, นมโอ๊ต)';
  assert public.t_hist('เมล็ดกาแฟ Story House Blend', v_bill) = -108, 'ประวัติเมล็ดต้อง -108';
  assert public.t_hist('นมโอ๊ต', v_bill) = -360, 'ประวัตินมโอ๊ตต้อง -360';
  assert public.t_hist_rows('นมวัว', v_bill) = 0, 'ต้องไม่มีประวัตินมวัว';

  -- 2) ส่งบิลเดิม (client_order_id เดิม) ซ้ำ: duplicate และไม่ตัดซ้ำ
  r2 := public.pos_record_bill(v_id, '[{"item":"ลาเต้","qty":2,"options":{"milk":"โอ๊ต","extra_shots":2,"size":"L"}}]');
  assert (r2 ->> 'duplicate')::boolean = true, 'ส่งซ้ำต้อง duplicate';
  assert public.t_stock('เมล็ดกาแฟ Story House Blend') = v_beans0 - 108, 'ส่งซ้ำแล้วเมล็ดถูกตัดซ้ำ';
  assert public.t_stock('นมโอ๊ต') = v_oat0 - 360, 'ส่งซ้ำแล้วนมโอ๊ตถูกตัดซ้ำ';
  assert (select count(*) from public.stock_history where source_id = v_bill) = 2, 'ส่งซ้ำแล้วประวัติเพิ่ม';

  -- 3) ลาเต้นมถั่วเหลือง 1 แก้ว: ไม่ตัดนมวัว ไม่ตัดอะไรแทน (เมล็ด -18 อย่างเดียว) · อัลมอนด์เหมือนกัน
  perform public.pos_record_bill('55555555-5555-4555-8555-555555555551', '[{"item":"ลาเต้","qty":1,"options":{"milk":"ถั่วเหลือง"}}]');
  perform public.pos_record_bill('55555555-5555-4555-8555-555555555552', '[{"item":"ลาเต้","qty":1,"options":{"milk":"อัลมอนด์"}}]');
  assert public.t_stock('เมล็ดกาแฟ Story House Blend') = v_beans0 - 108 - 36, 'เมล็ดหลังนมถั่วเหลือง/อัลมอนด์';
  assert public.t_stock('นมวัว') = v_cow0, 'นมถั่วเหลือง/อัลมอนด์ต้องไม่ตัดนมวัว';
  assert public.t_stock('นมโอ๊ต') = v_oat0 - 360, 'นมถั่วเหลือง/อัลมอนด์ต้องไม่ตัดนมโอ๊ต';

  -- 4) ลาเต้ปกติ (ไม่ระบุนม) ×1 และนมวัวระบุชัด ×1 ไซซ์ M: ตามสูตร (เมล็ด 18 + นมวัว 180 ต่อแก้ว) ไซซ์ไม่เปลี่ยนปริมาณ
  perform public.pos_record_bill('55555555-5555-4555-8555-555555555553', '[{"item":"ลาเต้","qty":1}]');
  perform public.pos_record_bill('55555555-5555-4555-8555-555555555554', '[{"item":"ลาเต้","qty":1,"options":{"milk":"นมวัว","size":"M"}}]');
  assert public.t_stock('นมวัว') = v_cow0 - 360, 'นมวัวหลังลาเต้ปกติ 2 แก้วต้อง -360';
  assert public.t_stock('เมล็ดกาแฟ Story House Blend') = v_beans0 - 108 - 36 - 36, 'เมล็ดหลังลาเต้ปกติ 2 แก้ว';

  -- 5) เบเกอรี่ไม่มีสูตร: ไม่ตัดอะไร และไม่เพิ่มประวัติ
  r := public.pos_record_bill('55555555-5555-4555-8555-555555555555', '[{"item":"ครัวซองต์เนย","qty":3}]');
  assert (select count(*) from public.stock_history where source_id = (r ->> 'id')::uuid) = 0, 'เบเกอรี่ไม่ควรมีประวัติสต็อก';
  assert public.t_stock('นมวัว') = v_cow0 - 360, 'เบเกอรี่ทำนมวัวเปลี่ยน';

  -- 6) สอดคล้อง: สต็อกปัจจุบัน = สต็อกตั้งต้น + ผลรวมประวัติ ของทุกวัตถุดิบที่ถูกตัด
  assert public.t_stock('น้ำเชื่อม') = v_syrup0, 'น้ำเชื่อมไม่เกี่ยวข้อง ต้องไม่เปลี่ยน';
  assert public.t_hist('เมล็ดกาแฟ Story House Blend') - v_beans_h0
         = public.t_stock('เมล็ดกาแฟ Story House Blend') - v_beans0, 'เมล็ด: ประวัติไม่ตรงสต็อก ' || (public.t_hist('เมล็ดกาแฟ Story House Blend') - v_beans_h0) || ' vs ' || (public.t_stock('เมล็ดกาแฟ Story House Blend') - v_beans0);
  assert public.t_hist('นมวัว') - v_cow_h0
         = public.t_stock('นมวัว') - v_cow0, 'นมวัว: ประวัติไม่ตรงสต็อก';
  assert public.t_hist('นมโอ๊ต') - v_oat_h0
         = public.t_stock('นมโอ๊ต') - v_oat0, 'นมโอ๊ต: ประวัติไม่ตรงสต็อก';
end $$;
reset role;

-- stock_low: stock <= reorder_level เรียงตามชื่อ (ตั้งสต็อกให้ต่ำ 3 รายการ รวมกรณีเท่ากับจุดสั่งซื้อพอดี)
update public.ingredients set stock = reorder_level where name = 'นมวัว';
update public.ingredients set stock = reorder_level - 1 where name = 'น้ำเชื่อม';
update public.ingredients set stock = reorder_level + 1 where name = 'มะนาว';
update public.ingredients set stock = reorder_level + 1000 where name not in ('นมวัว', 'น้ำเชื่อม');
select set_config('test.low', (select string_agg(name, ',' order by name) from public.ingredients where stock <= reorder_level), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated","app_metadata":{"role":"staff"}}', true);
do $$
declare v_names text[]; v_row record;
begin
  select array_agg(name) into v_names from public.stock_low();
  assert array_to_string(v_names, ',') = current_setting('test.low'), 'stock_low ผิดรายการ/ลำดับ: ' || v_names::text;
  assert v_names @> array['นมวัว', 'น้ำเชื่อม'] and cardinality(v_names) = 2, 'stock_low ต้องมี นมวัว (เท่าพอดี) และ น้ำเชื่อม: ' || v_names::text;
  select * into v_row from public.stock_low() where name = 'นมวัว';
  assert v_row.unit = 'ml' and v_row.stock = v_row.reorder_level, 'คอลัมน์ stock_low ผิด';
end $$;
reset role;
rollback;
