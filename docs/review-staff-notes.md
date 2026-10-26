ตรวจโดย: reviewer

# ผลตรวจ `exercise/rls-leak/` (ตาราง `staff_notes`)

ไฟล์ที่ตรวจ: `exercise/rls-leak/20261026100000_staff_notes.sql`, `exercise/rls-leak/README.md`
ตรวจจากการอ่านโค้ดอย่างเดียว ยังไม่ได้รันกับฐานข้อมูลจริง (migration ยังไม่ถูก apply)
เขียนลงไฟล์โดย session หลัก เพราะ reviewer เขียนไฟล์ไม่ได้

**ข้อสรุป: ไม่ควร merge จนกว่าจะแก้ข้อ 1, 2, 3 และ 5**

## 1. policy อ่านเปิดให้ทุกคน — ระดับ **สูง**
- **ไฟล์:บรรทัด**: `20261026100000_staff_notes.sql:13-14`
- **ปัญหา**: policy "อ่านโน้ต" ใช้ `for select using (true)` และไม่ระบุ `to` จึงใช้กับทุก role รวมถึง `anon`
- **ใครอ่านได้**: `anon` (คนที่ไม่ล็อกอิน) และลูกค้าทั่วไปที่ล็อกอินแล้ว อ่านได้เพราะ policy "อ่านโน้ต" นี้ เช่น `GET /rest/v1/staff_notes?select=*` ด้วย publishable key ได้เบอร์โทรและโน้ตสุขภาพของลูกค้าทุกคน (บรรทัด 21 ให้ `select` กับ `anon` ด้วย)
- **วิธีแก้**: ใช้ `to authenticated` และให้ `using` ตรวจ `(auth.jwt() -> 'app_metadata' ->> 'role') = 'staff'`

## 2. grant ให้ `anon` เกินจำเป็น — ระดับ **สูง**
- **ไฟล์:บรรทัด**: `20261026100000_staff_notes.sql:21`
- **ปัญหา**: `grant select, insert ... to anon, authenticated` ให้สิทธิ์คนที่ไม่ล็อกอิน แม้แก้ policy แล้วชั้นสิทธิ์ก็ยังเปิดค้าง
- **วิธีแก้**: `revoke all` จาก `anon` และ `public` แล้ว grant เฉพาะที่จำเป็นให้ `authenticated`

## 3. policy insert เชื่อ `user_metadata` — ระดับ **สูง**
- **ไฟล์:บรรทัด**: `20261026100000_staff_notes.sql:19`
- **ปัญหา**: ตัดสินสิทธิ์จาก `user_metadata.role` ซึ่งผู้ใช้แก้เองได้ (README กำหนดให้ใช้ `app_metadata`)
- **วิธีพิสูจน์**: ลูกค้าเรียก `supabase.auth.updateUser({ data: { role: 'staff' } })` แล้วจดโน้ตปลอมได้ ถ้าแก้ข้อ 1 ด้วยเงื่อนไขแบบเดียวกันจะอ่านได้หมดด้วย
- **วิธีแก้**: เปลี่ยนเป็น `app_metadata`

## 4. insert ไม่ผูก `author` กับผู้เขียน — ระดับ **กลาง**
- **ไฟล์:บรรทัด**: `20261026100000_staff_notes.sql:6`, `17-19`
- **ปัญหา**: `with check` ไม่บังคับ `author = auth.uid()` และ `author` เป็น nullable ปลอมหรือเว้นผู้เขียนได้
- **วิธีแก้**: ใส่ `author = auth.uid()` (หรือ default `auth.uid()`) และพิจารณา `not null`

## 5. ฟังก์ชัน `security definer` ข้าม RLS — ระดับ **สูง**
- **ไฟล์:บรรทัด**: `20261026100000_staff_notes.sql:24-30`
- **ปัญหา**: `search_notes` เป็น `security definer` ไม่ตั้ง `search_path` ไม่ตรวจสิทธิ์ในฟังก์ชัน และไม่ได้ `revoke execute ... from public` (ค่าเริ่มต้นให้ PUBLIC เรียกได้)
- **วิธีพิสูจน์**: `anon` เรียก `POST /rest/v1/rpc/search_notes {"p_phone":"0X-XXX-XXXX"}` ได้โน้ตของเบอร์นั้น ข้าม RLS แม้แก้ policy แล้ว
- **วิธีแก้**: เปลี่ยนเป็น `security invoker` หรือลบทิ้ง ถ้าต้องใช้ definer ให้ `set search_path = ''`, ตรวจ `app_metadata.role = 'staff'` ในฟังก์ชัน และ `revoke execute ... from public, anon`

## ที่ถูกต้องแล้ว
- เปิด RLS ที่ตาราง (บรรทัด 10)
- policy insert ระบุ `to authenticated`
