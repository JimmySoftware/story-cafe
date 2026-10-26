-- ข้อมูลร้านตั้งต้น (ย้ายมาจากไฟล์ shop.json เดิม) — หลังจากนี้แก้ที่ตาราง settings
insert into public.settings (key, value, is_public) values
  ('shop_name', '"Story Cafe"'::jsonb, true),
  ('tagline', '"กาแฟดี ๆ หนึ่งแก้ว เรื่องราวดี ๆ หนึ่งวัน"'::jsonb, true),
  ('open_time', '"07:30"'::jsonb, true),
  ('close_time', '"17:00"'::jsonb, true),
  ('phone', '"0X-XXX-XXXX"'::jsonb, true),
  ('address', '"ซอยสมมติ 9 กรุงเทพฯ (ที่อยู่สมมติ)"'::jsonb, true),
  ('line_id', '"@storycafe-demo"'::jsonb, true),
  ('instagram', '"@storycafe.demo"'::jsonb, true),
  ('workshop', '{"name":"Workshop latte art","when":"เสาร์แรกของเดือน 14:00–16:00","seats":8,"price":650}'::jsonb, true);
