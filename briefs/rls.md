# Brief: ปิดช่องให้ลูกค้าเห็นข้อมูลกันเอง (RLS)
> ข้อมูลสมมติเพื่อการเรียน · บท 10 เปิด `orders`/`order_items` ให้ anon อ่านได้ชั่วคราว เพื่อให้หน้ายืนยันออเดอร์ทำงาน ตอนนี้ปิด

## กฎ
1. ลูกค้า (anon) **อ่านตาราง `orders`, `order_items`, `pickup_slots` ตรง ๆ ไม่ได้เลย** (เห็น 0 แถวหรือถูกปฏิเสธ) ทั้ง select ผ่าน API และผ่าน role anon — ปิดที่ฐานข้อมูล (ถอน policy ที่เปิดไว้ + ถอนสิทธิ์ตารางจาก anon/authenticated) ไม่ใช่ซ่อนที่หน้าเว็บ
2. ลูกค้าดูออเดอร์ของตัวเองได้ผ่านฟังก์ชัน **`lookup_order(p_code text, p_phone text) returns jsonb`** (security definer, `set search_path = public`) เท่านั้น:
   - รหัสออเดอร์ + เบอร์ตรงกัน → `{"code","status","pickup_at","total","customer_name","items":[{"name","qty","options","unit_price"}]}`
   - ไม่ตรง (รหัสผิด หรือเบอร์ผิด) → `raise exception 'not_found'` ข้อความเดียวกันทั้งสองกรณี (ไม่บอกว่ารหัสมีอยู่จริง)
   - ไม่คืนข้อมูลของออเดอร์อื่นเด็ดขาด
3. `place_preorder`, `cancel_preorder`, `available_slots` ยังใช้ได้เหมือนเดิม (ผ่าน security definer)
4. หน้าเว็บ (`web/src/`) ห้ามอ่านตาราง `orders` / `order_items` ตรง ๆ อีก — หน้ายืนยันออเดอร์เรียก `lookup_order`
5. ตารางอื่นที่ anon เห็นได้เหมือนบท 9: `menu_items` (เฉพาะ active), `options`, `settings` (เฉพาะ is_public) · `ingredients`, `recipes` ปิด
6. เขียนเป็น migration ใหม่ + test SQL ใน `supabase/tests/` (ลองในฐานะ anon จริง ๆ ด้วย `set local role anon`)

## ตัวช่วย
`node tools/rls-probe.mjs` — ยิง API จริงในฐานะลูกค้า A และ B แล้วรายงานว่า B เห็นออเดอร์ของ A หรือไม่ (exit 0 = ปลอดภัย, 1 = รั่ว) ใช้ตัวแปร SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY (ค่าจาก `npx supabase status -o env`)

## เสร็จเมื่อ
`node tools/rls-probe.mjs` ผ่าน · `npm run test:db` ผ่าน · web build ผ่าน
