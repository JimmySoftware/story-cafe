-- สร้างโดย tools/db/gen-seed.mjs จาก data/*.csv — อย่าแก้มือ

-- migration (เมนูใหม่) รันก่อน seed: ดันแถวที่มีอยู่แล้วไปต่อท้ายเมนูในไฟล์ เพื่อให้ sort ไม่ซ้ำ
update public.menu_items set sort = sort + 12;

insert into public.menu_items (category, name, price, is_drink, sort) values
  ('กาแฟ', 'เอสเปรสโซ', 55, true, 1),
  ('กาแฟ', 'อเมริกาโน่', 65, true, 2),
  ('กาแฟ', 'ลาเต้', 75, true, 3),
  ('กาแฟ', 'คาปูชิโน่', 75, true, 4),
  ('กาแฟ', 'ม็อคค่า', 85, true, 5),
  ('กาแฟ', 'ดริปกาแฟ เอธิโอเปีย', 95, true, 6),
  ('กาแฟ', 'โคลด์บรูว์', 85, true, 7),
  ('เครื่องดื่มอื่น ๆ', 'มัทฉะลาเต้', 90, true, 8),
  ('เครื่องดื่มอื่น ๆ', 'ชามะนาว', 65, true, 9),
  ('เบเกอรี่', 'ครัวซองต์เนย', 69, false, 10),
  ('เบเกอรี่', 'บราวนี่ช็อกโกแลต', 79, false, 11),
  ('เบเกอรี่', 'ชีสเค้กบาสก์', 120, false, 12);

insert into public.options (kind, label, price_delta, sort) values
  ('size', 'S', 0, 1),
  ('size', 'M', 10, 2),
  ('size', 'L', 20, 3),
  ('sweetness', '0%', 0, 1),
  ('sweetness', '25%', 0, 2),
  ('sweetness', '50%', 0, 3),
  ('sweetness', '100%', 0, 4),
  ('milk', 'นมวัว', 0, 1),
  ('milk', 'โอ๊ต', 15, 2),
  ('milk', 'อัลมอนด์', 15, 3),
  ('milk', 'ถั่วเหลือง', 10, 4),
  ('extra', 'เพิ่ม shot เอสเปรสโซ', 20, 1);

insert into public.ingredients (name, unit, stock, reorder_level) values
  ('เมล็ดกาแฟ Story House Blend', 'g', 5000, 1000),
  ('เมล็ดดริป เอธิโอเปีย', 'g', 1500, 300),
  ('นมวัว', 'ml', 12000, 3000),
  ('นมโอ๊ต', 'ml', 4000, 1000),
  ('ผงมัทฉะ', 'g', 600, 150),
  ('ซอสช็อกโกแลต', 'ml', 1500, 300),
  ('น้ำเชื่อม', 'ml', 3000, 500),
  ('ชาซีลอน', 'g', 400, 100),
  ('มะนาว', 'pcs', 60, 15);

insert into public.recipes (menu_item_id, ingredient_id, amount)
select m.id, g.id, v.amount from (values
  ('เอสเปรสโซ', 'เมล็ดกาแฟ Story House Blend', 18::numeric),
  ('อเมริกาโน่', 'เมล็ดกาแฟ Story House Blend', 18::numeric),
  ('ลาเต้', 'เมล็ดกาแฟ Story House Blend', 18::numeric),
  ('ลาเต้', 'นมวัว', 180::numeric),
  ('คาปูชิโน่', 'เมล็ดกาแฟ Story House Blend', 18::numeric),
  ('คาปูชิโน่', 'นมวัว', 120::numeric),
  ('ม็อคค่า', 'เมล็ดกาแฟ Story House Blend', 18::numeric),
  ('ม็อคค่า', 'นมวัว', 150::numeric),
  ('ม็อคค่า', 'ซอสช็อกโกแลต', 30::numeric),
  ('ดริปกาแฟ เอธิโอเปีย', 'เมล็ดดริป เอธิโอเปีย', 15::numeric),
  ('โคลด์บรูว์', 'เมล็ดกาแฟ Story House Blend', 30::numeric),
  ('มัทฉะลาเต้', 'ผงมัทฉะ', 4::numeric),
  ('มัทฉะลาเต้', 'นมวัว', 180::numeric),
  ('มัทฉะลาเต้', 'น้ำเชื่อม', 10::numeric),
  ('ชามะนาว', 'ชาซีลอน', 3::numeric),
  ('ชามะนาว', 'มะนาว', 1::numeric),
  ('ชามะนาว', 'น้ำเชื่อม', 20::numeric)
) as v(menu, ingredient, amount)
join public.menu_items m on m.name = v.menu
join public.ingredients g on g.name = v.ingredient;

-- โควตาแก้ว: เบเกอรี่ = 0, ดริปกาแฟ เอธิโอเปีย = 2 (กฎใน briefs/preorder-build.md) · seed รันหลัง migration จึงตั้งตรงนี้อีกครั้ง
update public.menu_items set cup_units = 0 where not is_drink;
update public.menu_items set cup_units = 2 where name = 'ดริปกาแฟ เอธิโอเปีย';

insert into public.products (sku, name, price, stock, sort) values
  ('beans-250', 'เมล็ดคั่วกลาง Story House Blend ถุง 250 g', 380, 20, 1),
  ('drip-5', 'Drip bag กล่อง 5 ซอง', 175, 30, 2);
