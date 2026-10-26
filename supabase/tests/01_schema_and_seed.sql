-- โครงตาราง + จำนวนแถวตรงกับ data/*.csv (menu 14, options 12, ingredients 9, recipes 17) และ settings ครบ
begin;
do $$
begin
  assert (select count(*) from public.menu_items) = 14, 'menu_items ต้อง 14 แถว (12 เดิม + 2 เมนูใหม่)';
  assert (select count(*) from public.options) = 12, 'options ต้อง 12 แถว';
  assert (select count(*) from public.ingredients) = 9, 'ingredients ต้อง 9 แถว';
  assert (select count(*) from public.recipes) = 17, 'recipes ต้อง 17 แถว';
  assert (select count(*) from public.menu_items where sort is null) = 0, 'sort ต้องไม่ว่าง';
  assert (select count(*) from public.recipes r join public.menu_items m on m.id = r.menu_item_id where not m.is_drink) = 0, 'เบเกอรี่ต้องไม่มีสูตร';
  assert (select count(*) from public.settings where is_public) = 15, 'settings ต้องมี 15 key (9 ข้อมูลร้าน + 6 กฎสั่งล่วงหน้า) และ public ทั้งหมด';
  assert (select count(*) from public.settings where key in ('shop_name','tagline','open_time','close_time','phone','address','line_id','instagram','workshop')) = 9, 'key ใน settings ไม่ครบ';
  assert (select value from public.settings where key = 'open_time') = '"07:30"'::jsonb, 'open_time ต้องเป็น 07:30';
  assert (select value from public.settings where key = 'close_time') = '"17:00"'::jsonb, 'close_time ต้องเป็น 17:00';
  assert not exists (select 1 from public.settings where key = 'products'), 'key products ต้องถูกย้ายออกจาก settings';
  assert (select count(*) from public.products) = 2, 'products ต้อง 2 แถวตาม data/products.csv';
end $$;

-- constraint
do $$
begin
  begin insert into public.menu_items (category, name, price, is_drink, sort) values ('x','t',-1,true,1); assert false, 'ราคาติดลบต้องถูกปฏิเสธ';
  exception when check_violation then null; end;
  begin insert into public.menu_items (category, name, price, is_drink, sort) select 'x', name, 1, true, 1 from public.menu_items limit 1; assert false, 'ชื่อซ้ำต้องถูกปฏิเสธ';
  exception when unique_violation then null; end;
  begin insert into public.recipes select menu_item_id, ingredient_id, 0 from public.recipes limit 1; assert false, 'amount = 0 ต้องถูกปฏิเสธ';
  exception when check_violation then null; end;
end $$;
rollback;
