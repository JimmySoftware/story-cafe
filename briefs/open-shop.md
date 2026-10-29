# Brief: เปิดร้านจริง — ความปลอดภัย แผนสำรอง สำรองข้อมูล รู้เมื่อเกินฟรี + สูตรของคุณเอง
> ข้อมูลสมมติเพื่อการเรียน · ชื่อในนี้คือข้อตกลงที่ `npm run check -- 24` อ่านตามเป๊ะ · ที่ต้องตรวจหลังขึ้นระบบจริง (Supabase Cloud, Cloudflare, บัญชีจริง) ทำตาม `docs/runbook.md` ด้วยตัวเอง: `[ตรวจหลังสมัคร]`
> ไฟล์สำเร็จที่ให้มา: `data/free-tier.json` (ลิมิต Free ที่ตรวจจากเอกสารทางการ วันที่ 26 ต.ค. 2026), `tools/e2e/run.mjs` (รันทั้งระบบ), `templates/recipe-template.md`

## 1) ความปลอดภัย (prompt 1 = `rls_audit` + แก้ที่เจอ · prompt 3 = `/security-review` + `docs/security-review.md`)
- ตรวจแบบ `/security-review` ทั้งระบบ (migration, `supabase/functions/`, `pos/`, `owner/`, `web/`) และเขียนผลที่ `docs/security-review.md`: ตารางจุดที่พบ (ไฟล์ · ปัญหา · ระดับสูง/กลาง/ต่ำ · สถานะ `แก้แล้ว` หรือ `ยอมรับเพราะ…`) · บรรทัดแรก `ตรวจโดย: security review` ตามด้วยวันที่ · ต้องมีหัวข้อพูดถึง `RLS`, `service_role`, `.env`/ความลับ
- **`rls_audit()`** (migration ใหม่ ห้ามแก้เก่า): `public.rls_audit() returns jsonb` = อาร์เรย์ของจุดที่ไม่ปลอดภัย แต่ละจุด `{"table": ชื่อ, "problem": รหัส, "detail": ข้อความไทยสั้น ๆ}` เรียกได้เฉพาะ `service_role` (anon/ลูกค้า/พนักงานเรียกไม่ได้) รหัสปัญหา:
  - `rls_off` — ตารางใน schema `public` ที่ยังไม่เปิด RLS
  - `anon_write` — ตารางที่ role `anon` มีสิทธิ์ insert/update/delete
  - `open_write_policy` — policy คำสั่งเขียนหรือ `all` ที่ `using`/`with check` เป็น `true` ล้วน (ยกเว้น policy ของ `service_role`)
  - `definer_no_search_path` — ฟังก์ชัน `security definer` ใน `public` ที่ไม่ตั้ง `search_path` (ช่อง `table` ใส่ชื่อฟังก์ชัน)
- แก้ทุกจุดที่ `rls_audit()` เจอในระบบจริงของร้านด้วย migration ใหม่ จนผลเป็น `[]` · test SQL ใหม่ `supabase/tests/15_rls_audit.sql`
- ห้ามมีความลับจริงในไฟล์ที่ commit (กุญแจ `sk_live_…`, `sk-ant-…` จริง, private key, JWT ยาว) และ `.env` ต้องไม่ถูก track

## 2) แผนสำรอง + สำรองข้อมูล + รู้เมื่อเกินฟรี (prompt 2)
- **Supabase หลับ/ล่ม:** เว็บต้องยังโชว์เมนูและข้อมูลร้านได้: `tools/menu-fallback.mjs` สร้าง `web/public/menu-fallback.json` = `{"menu":[{category,name,price,is_drink}…] จาก data/menu.csv, "shop":{key→value ของ settings จาก supabase/seed_settings.sql}}` (รันซ้ำแล้วได้ไฟล์เดิมเป๊ะ) และ `web/` ใช้ไฟล์นี้เมื่อเรียก Supabase ไม่ได้ (หน้าแรกยังเห็นเมนู+ราคา+ชื่อร้าน) · POS ขายต่อได้ด้วยคิว offline (บท 21)
- **`tools/backup.sh`:** `pg_dump` ของ schema `public` จาก container ของ Supabase ในเครื่อง (`supabase_db_<project_id ใน supabase/config.toml>`) เขียนไฟล์ `${CAFE_BACKUP_DIR:-backups}/story-cafe-YYYYMMDD-HHMMSS.sql` (chmod 600) พิมพ์ **เส้นทางไฟล์เป็นบรรทัดสุดท้าย** · ไม่พิมพ์รหัสผ่าน/connection string · container ไม่รัน → ข้อความไทย exit 1 · `backups/` อยู่ใน `.gitignore`
- **`tools/restore-check.sh <ไฟล์.sql>`:** สร้างฐานข้อมูลชั่วคราว `restore_check_<เลขสุ่ม>` ใน container เดียวกัน → กู้ไฟล์ลงไป → เทียบจำนวนแถวของ **ทุกตารางใน public** กับฐานจริง → พิมพ์ผลรายตาราง (`✓ ชื่อ 12/12` หรือ `✗ ชื่อ 12/11`) → ลบฐานชั่วคราว **ทุกกรณี** (trap) → exit 0 เมื่อตรงทุกตาราง ไม่งั้น exit 1 (error เรื่อง FK ไป `auth.users` ที่ฐานชั่วคราวไม่มีเป็นเรื่องปกติ: นับแถวต่อได้ ห้ามล้มทั้งงาน)
- **`tools/usage-check.mjs`:** อ่านลิมิตจาก `data/free-tier.json` เท่านั้น (ห้ามพิมพ์ตัวเลขซ้ำในโค้ด) · ขนาดฐานข้อมูลจาก `pg_database_size` (ในเครื่อง) หรือ env `CAFE_FAKE_DB_BYTES` (ไว้ทดสอบ) · พิมพ์ `ฐานข้อมูล: X MB จาก 500 MB (Y%)` · < 80% → `ปกติ` exit 0 · ≥ 80% → `ใกล้เต็ม` exit 1 · ≥ 100% → `เต็มแล้ว` exit 1 · ข้อความไทย
- **`docs/runbook.md`:** (ภาษาไทย สำหรับคนที่ไม่ใช่โปรแกรมเมอร์ตอนตี 6 ร้านเปิดไม่ได้) หัวข้ออย่างน้อย: `Supabase หลับหรือล่ม` (ทำอะไรทีละข้อ: POS ขายต่อ, เว็บใช้ menu-fallback, ตรวจสถานะ, ปลุกโปรเจกต์), `ลิมิตของแผนฟรี` (ตัวเลข 500 MB, 50,000 MAU, 1 GB storage, 5 GB egress, pause 7 วัน อ้างจาก `data/free-tier.json` พร้อมลิงก์ https://supabase.com/docs/guides/platform/billing-on-supabase และ https://supabase.com/docs/guides/deployment/going-into-prod), `สำรองและกู้คืน` (Free ไม่มี backup ให้ดาวน์โหลด ต้องสำรองเอง: ลิงก์ https://supabase.com/docs/guides/platform/backups · ใช้ `tools/backup.sh` / `tools/restore-check.sh` · ความถี่), `ถ้าข้อมูลหลุด` (ตัดกุญแจ เปลี่ยนรหัส) · **ห้ามเดาตัวเลขที่ไม่อยู่ใน FACTS/`free-tier.json`**

## 3) สูตรของคุณเอง (prompt 3, level write; ผลแรก `--part win` = ข้อ 1 ส่วน `rls_audit` เท่านั้น)
เขียนสูตรหนึ่งใบเกี่ยวกับ "ฟีเจอร์ถัดไปของร้านคุณ" ด้วยแม่แบบ `templates/recipe-template.md` → `mine/recipe.md` + ตัวตรวจเล็ก ๆ `mine/check.mjs` ที่ผ่านเมื่อทำตามสูตรแล้ว
- frontmatter: `schema: 1`, `id` (ตัวพิมพ์เล็ก ตัวเลข ขีด), `title` (≤ 90), `win`, `win_minutes` (≤ 3), `start`, `check` (ขึ้นต้น `node mine/check.mjs`), `level: write`, `min_claude_code`
- เนื้อหา: `## prompt 1 · ชนะ` และ `## prompt 2 · ลองทดสอบหนัก ๆ` ใส่ prompt ในบล็อก ```text (อย่างน้อย 80 ตัวอักษรต่อบล็อก) · `## รู้ทันสูตร` อย่างน้อย 2 ข้อ · `## ตรวจ` · ห้ามคัดลอกข้อความจากแม่แบบทิ้งไว้ (เช่นข้อความในวงเล็บ) · ห้ามมีความลับ
- ผ่านเมื่อ: `node mine/check.mjs` exit 0

## 4) ทั้งระบบ (recap)
`node tools/e2e/run.mjs` ต้องผ่านทุกขั้น: พรีออเดอร์ → แจ้ง LINE → จ่ายเงิน (Stripe จำลอง) → POS ปิดบิลซ้ำไม่ซ้ำ → ยอดขายเจ้าของ → สต็อกตามสูตร → สำรอง/กู้คืน → `rls_audit` ว่าง

## เสร็จเมื่อ
`npm test`, `npm run test:db`, `npm run check -- 24` ผ่าน · commit เป็นภาษาไทย · ส่วนที่ต้องมีบัญชีจริง (deploy Cloudflare, Supabase Cloud, LINE/Stripe จริง) ระบุเป็น `[ตรวจหลังสมัคร]` ใน `docs/runbook.md`
