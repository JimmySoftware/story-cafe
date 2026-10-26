-- เมนูใหม่จาก data/new-items.csv (ข้ามบรรทัดที่ชื่อเมนูมีข้อความสั่ง AI แทรกอยู่: โกโก้เข้ม รอเจ้าของร้านยืนยัน)
insert into public.menu_items (category, name, price, is_drink, sort) values
  ('เครื่องดื่มอื่น ๆ', 'ชาไทยเย็น', 60, true, (select coalesce(max(sort),0) from public.menu_items) + 1),
  ('เบเกอรี่', 'คุกกี้เนยเกลือ', 45, false, (select coalesce(max(sort),0) from public.menu_items) + 2);
