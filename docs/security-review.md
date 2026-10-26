ตรวจโดย: security review — 2026-10-27

# ผลตรวจความปลอดภัย Story Cafe

ขอบเขต: migration ทั้งหมดใน `supabase/migrations/`, `supabase/functions/` (5 ฟังก์ชัน), `pos/`, `owner/`, `web/` และไฟล์ที่ commit ทั้ง repo
วิธีตรวจ: อ่านโค้ดเอง + ถามฐานข้อมูลในเครื่องโดยตรง (สิทธิ์ของตาราง/ฟังก์ชัน, policy) + `rls_audit()` + สแกนความลับในไฟล์ที่ commit
หมายเหตุ: สกิล `/security-review` อัตโนมัติรันไม่ได้ เพราะ repo นี้ไม่มี remote `origin` ให้เทียบ diff จึงตรวจด้วยมือแทนทั้งระบบ · ทุกอย่างตรวจกับ Supabase **ในเครื่อง** เท่านั้น ส่วนที่ต้องมีระบบจริงติดป้าย **[ตรวจหลังสมัคร]**

## สรุป

พบ 9 จุด: สูง 0 · กลาง 2 · ต่ำ 7 (แก้แล้ว 2 · ยอมรับ 7) · ไม่พบ RLS ที่ปิด, anon เขียนได้, policy เขียนเปิดโล่ง หรือ security definer ที่ไม่ตั้ง `search_path`

## ตารางจุดที่พบ

| # | ไฟล์ | ปัญหา | ระดับ | สถานะ |
|---|---|---|---|---|
| 1 | `supabase/migrations/…_create_shop_tables.sql` (สิทธิ์เริ่มต้น) | `authenticated` มีสิทธิ์ insert/update/delete/**truncate**/references/trigger บน `ingredients`, `menu_items`, `options`, `recipes`, `settings` RLS กัน insert/update/delete ไว้ชั้นเดียว แต่ TRUNCATE ไม่ผ่าน RLS | กลาง | แก้แล้ว — migration `20261027040000_revoke_extra_grants.sql` ถอนสิทธิ์เขียนทั้งหมด (คง select) + test `16_grants_least_privilege.sql` |
| 2 | `supabase/config.toml` | ไม่ได้ตั้ง `verify_jwt` ของ Edge Function: ค่าเริ่มต้นคือต้องมี JWT ทำให้ `payment_webhook` / `line_webhook` ที่ Stripe/LINE ยิงมา (ไม่มี JWT) ถูกปฏิเสธตอน deploy ส่วนฟังก์ชันอื่นควรระบุให้ชัดว่าต้องมี | กลาง | แก้แล้ว — ตั้ง `verify_jwt = false` เฉพาะสอง webhook (ป้องกันด้วยการตรวจลายเซ็นในโค้ด) และ `true` ให้ที่เหลือ · ผลจริงตอน deploy **[ตรวจหลังสมัคร]** (Edge runtime ในเครื่องปิดอยู่) |
| 3 | `supabase/functions/notify_owner/handler.ts`, `morning_summary/handler.ts` | ไม่ตรวจผู้เรียกในโค้ด พึ่ง gateway (`verify_jwt`) อย่างเดียว ใครมี anon key (ซึ่งเป็นสาธารณะ) ก็ยิงให้ส่ง push ได้ | ต่ำ | ยอมรับเพราะ ผลที่ได้ไม่รั่วข้อมูล (ตอบแค่จำนวน) · `morning_summary` ใช้ retry key ต่อวัน LINE ไม่ส่งซ้ำ · `notify_owner` ส่งได้เฉพาะแถวที่รออยู่ในคิวจริง · cron เรียกด้วยกุญแจจาก Vault ถ้าจะเข้มขึ้นให้บังคับ secret key ในโค้ด (ต้องแก้ทั้ง handler และ cron) |
| 4 | `supabase/migrations/…_preorder.sql` (`place_preorder`) | anon สั่งล่วงหน้าได้ไม่จำกัดจำนวนครั้ง ใครก็ใช้ชื่อ/เบอร์ปลอมจองโควตาแก้วของช่วงเวลาให้เต็มได้ | ต่ำ | ยอมรับเพราะ เป็นการเปิดให้คนทั่วไปสั่งโดยตั้งใจ · ออเดอร์ที่ไม่ยืนยันหมดอายุเอง (`expire_stale_preorders`) และเจ้าของยืนยันผ่าน LINE ก่อน · rate limit/captcha ต้องตั้งที่ Cloud **[ตรวจหลังสมัคร]** |
| 5 | `supabase/migrations/…_preorder.sql` (`lookup_order`, `cancel_preorder`) | anon ค้น/ยกเลิกออเดอร์ได้ด้วย "รหัสออเดอร์ + เบอร์โทร" ไม่มีตัวจำกัดการลองเดา | ต่ำ | ยอมรับเพราะ ต้องเดาถูกทั้งสองอย่าง · ตอบ `not_found` เหมือนกันทั้งรหัสผิด/เบอร์ผิด (ไม่บอกว่าอย่างไหนผิด) · ข้อมูลที่ได้เป็นรายการเครื่องดื่ม ไม่มีที่อยู่/บัตร · rate limit ที่ Cloud **[ตรวจหลังสมัคร]** |
| 6 | `supabase/migrations/…_shop_orders.sql` (`create_order`) | รหัสออเดอร์เป็นเลขสุ่ม 4 หลัก (`SH-0000`–`SH-9999`) วน loop หารหัสว่าง ถ้ารหัสเต็มทั้ง 10,000 จะค้างไม่จบ | ต่ำ | ยอมรับเพราะ ต้องมีออเดอร์ 10,000 รายการ ซึ่งสต็อกสินค้าจะหมดก่อนมาก · ถ้าร้านโตเกินนี้ให้ขยายรูปแบบรหัส |
| 7 | `supabase/config.toml` (`[auth]`) | `enable_signup = true` และ `enable_confirmations = false` ใครก็สมัครเป็น `authenticated` ได้ทันทีโดยไม่ยืนยันอีเมล | ต่ำ | ยอมรับเพราะ เป็นค่าสำหรับเครื่องพัฒนา · สิทธิ์ลูกค้ากับพนักงานแยกกันด้วย `app_metadata.role` ที่ผู้ใช้แก้เองไม่ได้ (test `14_pos_bills.sql` ลองตั้ง `user_metadata.role = staff` แล้วถูกปฏิเสธ) · ต้องเปิดยืนยันอีเมลที่ Cloud **[ตรวจหลังสมัคร]** |
| 8 | `pos/src-tauri/tauri.conf.json` | `csp: null` ปิด Content-Security-Policy ของหน้าต่าง POS | ต่ำ | ยอมรับเพราะ ไม่มี `dangerouslySetInnerHTML`/`innerHTML`/`eval` ในโค้ด POS, owner, web (ตรวจด้วย grep) และ capability เป็น `core:default` เท่านั้น (ไม่มี shell/fs) · ตั้ง CSP ที่ถูกต้องต้องลองกับแอปที่ build จริง ซึ่งตรวจในเครื่องนี้ไม่ได้ **[ตรวจหลังสมัคร]** |
| 9 | `tools/check/db.mjs` | มีกุญแจ `sb_secret_…` ฝังในไฟล์ที่ commit | ต่ำ | ยอมรับเพราะ เป็นกุญแจ demo ตายตัวที่ Supabase CLI ใช้เหมือนกันทุกเครื่องที่รัน local และใช้ได้กับ `127.0.0.1` เท่านั้น ไม่ใช่ความลับของร้าน (ห้ามใช้ค่าแบบนี้กับโปรเจกต์ Cloud) |

## RLS

- ทุกตารางใน `public` (21 ตาราง) เปิด RLS · ตารางข้อมูลของลูกค้า/ระบบ (`orders`, `order_items`, `pickup_slots`, `notify_queue`, `line_events`, `stripe_events`) ไม่มี policy เลย = ปิดสนิทสำหรับ anon/ลูกค้า เข้าได้ผ่านฟังก์ชัน `security definer` ที่ตรวจเงื่อนไขเองเท่านั้น
- policy อ่านที่เปิด: เมนู/ตัวเลือก/สินค้าที่ขาย และ `settings` ที่ `is_public` (anon) · ตารางการเงินและข้อมูลพนักงานอ่านได้เฉพาะ `app_metadata.role = 'staff'` · ออเดอร์/การจ่าย/สลิปของลูกค้าอ่านได้เฉพาะของตัวเอง
- policy เขียนมีอันเดียว: `staff_notes_insert` (พนักงาน และ `author = auth.uid()`) ไม่มี policy ที่เป็น `true` ล้วน
- ฟังก์ชัน `security definer` ทุกตัวตั้ง `search_path` และเปิดให้เรียกเท่าที่จำเป็น: ฟังก์ชันฝั่งเซิร์ฟเวอร์ (`mark_order_paid`, `record_stripe_event`, `claim_notifications`, `confirm_preorder` …) เรียกได้เฉพาะ `service_role`

### `rls_audit()` (ทำไว้แล้ว)

`public.rls_audit()` ตรวจ `rls_off` · `anon_write` · `open_write_policy` · `definer_no_search_path` เรียกได้เฉพาะ `service_role` · กับระบบจริงของร้านได้ `[]` ทั้งก่อนและหลังแก้จุดที่ 1 · test: `supabase/tests/15_rls_audit.sql` · ควรรันซ้ำหลังเพิ่ม migration ทุกครั้งและหลังขึ้น Cloud
ข้อจำกัด: ตรวจเฉพาะ 4 รหัสนี้ ไม่เห็นเรื่อง **สิทธิ์ที่เกินจำเป็นของ authenticated** (จุดที่ 1 หลุดจาก `rls_audit()` — พบจากการอ่านสิทธิ์ตรง ๆ) หรือ view/storage

## service_role

- กุญแจ `service_role` / `sb_secret_…` อยู่ในฝั่งเซิร์ฟเวอร์เท่านั้น: Edge Function อ่านจาก env (`SUPABASE_SECRET_KEY`) · cron อ่านจาก Vault · ไม่มีในโค้ด `pos/`, `owner/`, `web/` (ทั้งสามใช้ publishable key เท่านั้น และ `vite.config.ts` ฝังเฉพาะตัวแปรขึ้นต้น `SUPABASE_` ผ่าน allowlist สองตัว: URL กับ publishable key)
- Edge Function ทุกตัวยืนยันก่อนทำงาน: `create_payment` ตรวจ JWT ผู้ใช้ + ออเดอร์ต้องเป็นของผู้ใช้ + ยอดมาจากฐานข้อมูล + บังคับ `sk_test_` (ตอนเปิดรับเงินจริงต้องตั้งใจเปลี่ยนข้อนี้) · `payment_webhook` ตรวจ Stripe-Signature (HMAC, ตรวจเวลา, เทียบแบบ constant-time) ก่อน parse + กัน event ซ้ำ · `line_webhook` ตรวจ x-line-signature และรับคำสั่งจากเจ้าของร้าน (`LINE_OWNER_USER_ID`) เท่านั้น
- ฟังก์ชันที่ลูกค้าเรียกได้ (`create_order`, `place_preorder`, `pos_record_bill` …) คำนวณราคา/ยอดบนเซิร์ฟเวอร์เอง ไม่เชื่อตัวเลขจากฝั่งลูกค้า

## .env และความลับ

- `.env` ไม่ถูก track (อยู่ใน `.gitignore` พร้อม `.env.*`) มีเฉพาะแบบฟอร์ม `.env.example` ที่ถูก track
- สแกนไฟล์ที่ commit หา `sk_live_…`, `sk-ant-…`, private key, JWT ยาว, `sb_secret_…`, `whsec_…`: ไม่พบความลับจริง ที่เจอเป็นค่าปลอมสำหรับ test (`sk_test_fake…`, `whsec_unittest…`, ค่าปลอมที่หน้าตาเหมือนกุญแจ live ใช้พิสูจน์ว่าระบบปฏิเสธกุญแจ live) และกุญแจ demo ของ local ตามจุดที่ 9
- ผู้ตรวจ (รวมถึงตัว AI) ไม่ได้อ่านไฟล์ `.env` จริง ตามกฎร้านข้อ 5
- ถ้ากุญแจหลุด ทำตาม `docs/runbook.md` หัวข้อ "ถ้าข้อมูลหลุด"

## ฝั่งแอป (pos / owner / web)

- ไม่พบ `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `document.write` · React escape ข้อความให้
- POS เก็บบิลที่รอส่งและ session พนักงานใน `localStorage` ของเครื่องร้าน (ตามที่ออกแบบให้ขายต่อตอนออฟไลน์) — ถ้าเครื่องหาย ผู้ถือเครื่องเห็นบิลค้างและใช้ session ได้จนกว่าจะหมดอายุ ให้ล็อกเครื่อง POS และออกจากระบบเมื่อเลิกงาน
- service worker ของแอปเจ้าของ (`owner/public/sw.js`) เก็บเฉพาะเปลือกแอปจากที่มาเดียวกัน คำขอไปฐานข้อมูลไม่ถูกเก็บ

## สิ่งที่ตรวจไม่ได้ในเครื่องนี้

- การตั้งค่า Auth บน Supabase Cloud (ยืนยันอีเมล, rate limit, captcha), ว่า Edge Function ที่ deploy จริงรับ `verify_jwt` ตามไฟล์ config ไหม, การตั้ง Vault/cron บน Cloud **[ตรวจหลังสมัคร]**
- แอป POS ที่ build เป็น Tauri จริง (CSP, การเก็บ session ในเครื่อง)
- การโจมตีผ่านเครือข่ายจริงต่อ endpoint ที่ deploy แล้ว (ที่ทำคือตรวจโค้ดกับฐานในเครื่อง ไม่ได้ยิงโจมตีระบบจริง)
- dependency ที่มีช่องโหว่ (ไม่ได้รัน `npm audit` / `cargo audit`)
