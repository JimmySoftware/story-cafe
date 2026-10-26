# Brief: ทีมผู้ช่วย — subagent `reviewer` ตรวจโค้ดของ freelancer
> ข้อมูลสมมติเพื่อการเรียน · ชื่อและโครงในนี้คือข้อตกลงที่ `npm run check -- 19` อ่านตามเป๊ะ

## เป้าหมาย
ตรวจงานของ freelancer ใน `exercise/rls-leak/` ด้วย **ผู้ตรวจที่ไม่ได้เขียนโค้ดนั้น และไม่มีสิทธิ์แก้อะไร** (subagent ที่ context สะอาด) ไม่ใช่ session ที่เพิ่งคุยเรื่องนี้มา แล้วค่อยแก้เองใน session หลัก

## 1) subagent `reviewer` (`.claude/agents/reviewer.md`)
- frontmatter: `name: reviewer`, `description:` (บอกว่าใช้เมื่อไหร่: ตรวจ migration/RLS/สิทธิ์ก่อน merge, ≥ 20 ตัวอักษร), `tools:` **เฉพาะ `Read, Grep, Glob`** (ห้าม Edit, Write, Bash, NotebookEdit หรือ `*`), `model:` จะระบุหรือไม่ก็ได้
- เนื้อหา (system prompt, ภาษาไทย): ตรวจเฉพาะความปลอดภัยของข้อมูล RLS/policy/grant/ฟังก์ชัน `security definer`/การเชื่อ `user_metadata` · รายงานเป็นรายการ: ไฟล์:บรรทัด · ปัญหา · ระดับ (สูง/กลาง/ต่ำ) · วิธีพิสูจน์ว่ารั่ว (ใครเข้าถึงอะไรได้) · วิธีแก้ที่แนะนำ (ไม่ต้องลงมือแก้) · บอก "ไม่พบ" ชัด ๆ ถ้าไม่มี · **ไม่แก้ไฟล์ ไม่เดาสิ่งที่ไม่ได้อ่าน**
- **subagent ที่เพิ่งสร้างไฟล์ ต้องเปิด session ใหม่ (หรือ `/agents`) ถึงจะเรียกใช้ได้** — session ปัจจุบันยังไม่เห็น

## 2) ให้ reviewer ตรวจ
- ส่งงานให้ `reviewer` ตรวจ `exercise/rls-leak/` (บอกแค่ว่าตรวจอะไร ไม่เฉลยว่ามีปัญหาอะไร)
- session หลักเขียนผลลงที่ `docs/review-staff-notes.md` (reviewer เขียนไฟล์ไม่ได้) ขึ้นต้นบรรทัดแรกด้วย `ตรวจโดย: reviewer` ตามด้วยรายการปัญหา อย่างน้อยต้องชี้: ตาราง `staff_notes` · ใคร (`anon` / ลูกค้าทั่วไป) อ่านได้เพราะ policy ไหน · ระดับ **สูง**

## 3) แก้ใน session หลัก (ไม่ใช่ reviewer)
- เพิ่ม migration ใหม่ใน `supabase/migrations/` (ไม่ใช่ไฟล์ใน `exercise/`, ห้ามแก้ migration เก่า): ตาราง `staff_notes` คอลัมน์เดิมครบ (`id, customer_phone, note, author, created_at`) · RLS เปิด · เฉพาะพนักงาน (`app_metadata.role = 'staff'`) อ่านและจดได้ · anon ไม่มีสิทธิ์อะไรเลย · `author` ใส่ `auth.uid()` ให้เอง · ถ้าเก็บ `search_notes` ไว้ต้องไม่ bypass RLS (หรือลบทิ้ง)
- test SQL ใหม่ `supabase/tests/13_staff_notes.sql` พิสูจน์: anon อ่านไม่ได้ · ลูกค้า (แม้ตั้ง `user_metadata.role = 'staff'` เอง) อ่าน/จดไม่ได้ · พนักงานทำได้ · แล้ว `npm run test:db` ผ่านทั้งหมด

## 4) ตรวจซ้ำ
ให้ reviewer (ตัวใหม่ context สะอาดอีกครั้ง) ตรวจ migration ที่แก้แล้ว เขียนผลลง `docs/review-staff-notes-2.md` (ขึ้นต้น `ตรวจโดย: reviewer`) · ต้องบอกชัดว่าไม่พบปัญหาระดับสูงเหลือ และถ้ามีเรื่องเล็กน้อยที่ยังไม่แก้ให้เขียนเหตุผล

## เสร็จเมื่อ
`npm run check -- 19` ผ่าน · `npm run test:db` ผ่าน · commit เป็นภาษาไทย
