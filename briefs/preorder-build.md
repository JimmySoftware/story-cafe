# Brief: สร้างระบบสั่งกาแฟล่วงหน้า (ต่อจาก briefs/preorder.md)
> ข้อมูลสมมติเพื่อการเรียน · `briefs/preorder.md` คือกฎของร้าน (6 ข้อ) · ไฟล์นี้คือ "ข้อตกลงชื่อ" ที่ตัวตรวจ `npm run check -- 10` อ่านตามเป๊ะ
> ผลคำตอบของคำถามที่ brief เดิมยังไม่ตอบ: **ไม่ต้องล็อกอิน** (กรอกชื่อ + เบอร์) · สั่งได้ **วันนี้หรือพรุ่งนี้** เท่านั้น · ร้านเปิดทุกวัน

## หลักการ (สำคัญกว่ารายละเอียด)
1. **กฎของร้านต้องบังคับที่ฐานข้อมูล** ไม่ใช่ที่หน้าเว็บ — หน้าเว็บแค่ช่วยให้ลูกค้าไม่กดผิด แต่ใครยิง API ตรง ๆ ก็ต้องผ่านกฎเดียวกัน
2. **ตัวเลขของกฎอยู่ใน `settings`** ห้ามฝังในโค้ดหรือฟังก์ชัน
3. **ราคาคิดที่ฐานข้อมูล** จาก `menu_items.price` + `options.price_delta` (ไม่เชื่อราคาที่หน้าเว็บส่งมา)
4. เขียนเป็น migration ใหม่ (ห้ามแก้ migration เก่า) และมี test SQL (`npm run test:db`)

## ค่าใหม่ใน `settings` (ทุก key `is_public = true`, `value` เป็นตัวเลข JSON)
`cups_per_slot` = 6 · `slot_minutes` = 10 · `min_lead_minutes` = 15 · `cancel_cutoff_minutes` = 30 · `expire_after_minutes` = 30 · `preorder_days` = 1 (วันนี้ + อีก 1 วัน)
เวลาเปิด/ปิดใช้ `open_time` / `close_time` เดิม (เวลาไทย Asia/Bangkok) · ช่องสุดท้ายของวันคือช่องที่เริ่มก่อนเวลาปิด 10 นาที (16:50)

## คอลัมน์ใหม่
`menu_items.cup_units int not null default 1` — จำนวน "แก้ว" ที่เมนูนั้นกินโควตา: **ดริปกาแฟ เอธิโอเปีย = 2**, **เบเกอรี่ทุกรายการ = 0**, อื่น ๆ = 1

## ตาราง
| ตาราง | คอลัมน์ (ชื่อต้องตรง) |
|---|---|
| `pickup_slots` | `slot_start timestamptz` (pk), `cups_used int not null default 0` — แถวเดียวต่อช่องเวลา นับแก้วที่จองแล้ว |
| `orders` | `id uuid` (pk), `code text` (unique, อ่านง่าย เช่น `SC-4821`), `customer_name text`, `phone text`, `pickup_at timestamptz`, `status text` (`placed` / `cancelled` / `picked_up` / `expired`, default `placed`), `total int`, `created_at timestamptz default now()` |
| `order_items` | `id uuid` (pk), `order_id uuid` → orders (on delete cascade), `menu_item_id uuid` → menu_items, `qty int` (> 0), `options jsonb`, `unit_price int`, `cups int` |

เปิด RLS ทั้งสามตาราง · **ชั่วคราว (บท 11 จะปิดช่องนี้):** ให้ anon `select` `orders` และ `order_items` ได้ เพื่อให้หน้ายืนยันออเดอร์อ่านผ่าน API ได้ · `pickup_slots` ให้ anon อ่านได้ · **ไม่ให้ anon insert/update/delete ตารางไหนเลย** — เขียนผ่านฟังก์ชันด้านล่างเท่านั้น

## ฟังก์ชัน (schema `public`, `security definer`, `set search_path = public`, สั่งได้จาก anon: `grant execute … to anon`)
- `place_preorder(p_name text, p_phone text, p_pickup timestamptz, p_items jsonb) returns jsonb`
  - `p_items` = `[{"menu_item_id": "<uuid>", "qty": 2, "options": ["L","โอ๊ต","เพิ่ม shot เอสเปรสโซ"]}, …]` (`options` = รายการ `label` จากตาราง `options` ใช้กับเครื่องดื่มเท่านั้น)
  - สำเร็จ → `{"code": "SC-4821", "total": 130, "pickup_at": "…"}`
  - ผิดกฎ → `raise exception` โดย **ข้อความขึ้นต้นด้วยรหัสนี้**: `empty_order` · `bad_slot` (เวลาไม่ตรงช่อง 10 นาที) · `outside_hours` · `too_far` (เกินวันนี้+พรุ่งนี้) · `too_late` (เหลือน้อยกว่า `min_lead_minutes`) · `slot_full` (แก้วเกิน `cups_per_slot`) · `bad_option` (ตัวเลือกไม่มี/ใช้กับเบเกอรี่)
  - ต้องปลอดภัยเมื่อมีคนสั่งพร้อมกัน: ช่องที่เหลือแก้วเดียว สั่งพร้อมกันกี่คนก็ต้องได้ **คนเดียว**
- `cancel_preorder(p_code text, p_phone text) returns jsonb` — ยกเลิกได้จนถึง `cancel_cutoff_minutes` ก่อนเวลารับ · คืนแก้วให้ช่อง · เบอร์ไม่ตรง/ไม่พบ → `not_found` · เลยเวลา → `too_late_to_cancel`
- `available_slots(p_day date) returns table(slot_start timestamptz, cups_left int, bookable boolean)` — ทุกช่องของวันนั้น · `bookable = false` เมื่อเต็ม หรือใกล้เกิน `min_lead_minutes` หรือไม่อยู่ในวันนี้/พรุ่งนี้

## หน้าเว็บ (ทำหลังฐานข้อมูลผ่านแล้ว)
`web/src/` มีหน้าสั่งล่วงหน้า (เข้าที่ `#/preorder`): เลือกเมนูกับตัวเลือก (อ่านจากตาราง `menu_items`/`options` ผ่าน API) · เลือกช่องรับจาก `available_slots` (ช่องเต็มกดไม่ได้) · ใส่ชื่อ+เบอร์ · กดสั่งเรียก `place_preorder` แล้วแสดงเลขออเดอร์
ข้อความ error ที่ลูกค้าเห็นเป็นภาษาไทย (แปลงจากรหัสด้านบน) ไม่มี stack trace · ใช้ `@supabase/supabase-js` และตัวแปร `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (build ต้องผ่านแม้ยังไม่ตั้งค่า)

## เสร็จเมื่อ
- กฎของร้านทั้ง 6 ข้อใน `briefs/preorder.md` มี test SQL และผ่าน (`npm run test:db`)
- สั่งพร้อมกัน 2 คนเข้าช่องที่เหลือแก้วเดียว → ได้คนเดียว (test พิสูจน์ ไม่ใช่เดา)
- `npm test`, `npm run test:db`, `cd web && npm run build` ผ่าน
