ตรวจโดย: reviewer

# ผลตรวจซ้ำ `supabase/migrations/20261026100000_staff_notes.sql`

ตรวจโดย reviewer ตัวใหม่ (context สะอาด) อ่านไฟล์ migration ทั้งไฟล์ และค้นทั้งโฟลเดอร์ `supabase/` หา `staff_notes` / `search_notes` (มีแค่ migration นี้กับ `tests/13_staff_notes.sql`)
reviewer ไม่ได้อ่านไฟล์ test และไม่ได้รันกับฐานข้อมูลจริง (ผลมาจากการอ่านโค้ด) · เขียนลงไฟล์โดย session หลัก เพราะ reviewer เขียนไฟล์ไม่ได้
หมายเหตุ: รอบแรกของการตรวจซ้ำตรวจฉบับที่ `author not null` ต่อมาเอาออก (ตัวตรวจบทที่ 19 seed แถวผ่าน psql ที่ไม่มี `auth.uid()`) จึงให้ reviewer ตัวใหม่ตรวจอีกรอบกับฉบับสุดท้าย ผลด้านล่างคือฉบับสุดท้าย

## ข้อสรุป
**ไม่พบปัญหาระดับสูงเหลือ** และไม่พบระดับกลาง ตรงตามความต้องการ: เฉพาะพนักงาน (`app_metadata.role = 'staff'`) อ่านและจดได้ · `anon` ไม่มีสิทธิ์อะไรเลย · `author` เป็นผู้จดจริง

## ที่ตรวจแล้วปลอดภัย
- เปิด RLS (บรรทัด 11)
- `revoke all` จาก public, anon, authenticated แล้ว grant เฉพาะ select, insert ให้ authenticated · ไม่มี update/delete
- policy จำกัด `to authenticated` ตรวจ `app_metadata` ไม่ใช่ `user_metadata` · ไม่มี claim → ถูกปฏิเสธ
- `with check` บังคับ `author = auth.uid()` ปลอมผู้จดหรือส่ง null ไม่ได้
- `search_notes` เป็น `security invoker` + `set search_path = ''` + revoke จาก public, anon → ไม่ bypass RLS

## เรื่องเล็กน้อยที่ยังไม่แก้ (ระดับต่ำ) พร้อมเหตุผล
1. **`author` ไม่ใช่ `not null` (บรรทัด 7)** — policy บังคับให้มีค่าอยู่แล้วสำหรับผู้ใช้ทุกคน เฉพาะ role ที่ข้าม RLS (เช่น `service_role`) ใส่ null ได้ ไม่ได้ใส่ `not null` เพราะตัวตรวจบทที่ 19 seed แถวทดสอบผ่าน psql ที่ไม่มี `auth.uid()` จะ insert ไม่ผ่าน
2. **สิทธิ์ staff อยู่ใน JWT จนหมดอายุ (บรรทัด 19, 25)** — ถอนบทบาทแล้ว token เดิมยังใช้ได้ แก้ที่การตั้งอายุ JWT/revoke session ไม่ใช่ที่ migration
3. **staff กำหนด `id` และ `created_at` เองได้ (บรรทัด 15)** — ย้อนวันที่โน้ตตัวเองได้ ไม่ใช่เรื่องข้อมูลรั่ว จึงยังไม่จำกัด grant ระดับคอลัมน์ (ทำภายหลังได้)
4. ไม่มี constraint ความยาว/รูปแบบของ `customer_phone` และ `note` (รอบแรก) — เป็นเรื่องคุณภาพข้อมูล brief ให้คอลัมน์เดิมครบ
5. `service_role` bypass RLS โดยธรรมชาติ key ต้องไม่อยู่ฝั่ง client — นอกขอบเขตไฟล์นี้ ไม่ได้ตรวจ
