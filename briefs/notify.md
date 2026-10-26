# Brief: ออเดอร์ใหม่เด้งเข้า LINE เจ้าของร้าน
> ข้อมูลสมมติเพื่อการเรียน · ชื่อในนี้คือข้อตกลงที่ `npm run check -- 15` อ่านตามเป๊ะ · ทดสอบกับ LINE จำลอง (`tools/fakes/line.mjs`) ไม่ต้องสมัครอะไร
> ที่ต้องตรวจหลังสมัคร LINE Official Account: ส่งจริงถึงมือถือเจ้าของร้าน, โควตาข้อความ, เชื่อม pg_cron/Database Webhook เรียกฟังก์ชันบน Supabase จริง

## หลักการ
1. **การแจ้งเตือนห้ามทำให้ออเดอร์ล้ม** — ออเดอร์ถูกบันทึกเสมอ แม้ LINE ล่ม token ผิด หรือยังไม่ได้ตั้งค่า: ตอนสร้างออเดอร์ฐานข้อมูลแค่ "ใส่คิว" (ไม่เรียกเน็ตใน transaction)
2. **ส่งซ้ำได้โดยไม่ซ้ำข้อความ** — ทุกแถวในคิวมี `retry_key` (UUID) คงที่ ส่งซ้ำด้วย header `X-Line-Retry-Key` เดิม; LINE จำ key 24 ชั่วโมง ตอบ **409** ถ้าเคยรับแล้ว (ให้ถือว่าส่งสำเร็จ)
3. **ความลับไม่อยู่ในโค้ด ข้อความ error หรือ log** — token อยู่ใน env เท่านั้น (`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_OWNER_USER_ID`, `LINE_API_BASE` ค่าเริ่มต้น `https://api.line.me`)

## ตาราง `notify_queue` (migration ใหม่)
`id uuid pk` · `kind text` · `payload jsonb` · `dedupe_key text unique` · `status text` (`pending` / `sent` / `failed` / `dead`, default `pending`) · `attempts int default 0` · `next_attempt_at timestamptz default now()` · `retry_key uuid default gen_random_uuid()` · `last_error text` · `created_at timestamptz default now()` · `sent_at timestamptz` · RLS เปิด ไม่ให้ anon/authenticated อ่านเขียน
- trigger หลัง insert บน `orders` (สั่งล่วงหน้า) และ `shop_orders` → ใส่แถว `kind='order_placed'`, `payload={"code","total","source":"preorder"|"shop"}`, `dedupe_key='order_placed:<code>'` (`on conflict do nothing`) · trigger ต้องไม่ raise error เด็ดขาด
- `claim_notifications(p_limit int default 10) returns setof notify_queue` — **service_role เท่านั้น** · เลือกแถว `pending` ที่ถึงเวลา (`for update skip locked`) แล้วเลื่อน `next_attempt_at` ไป 5 นาที (กันสองตัวหยิบพร้อมกัน)
- `finish_notification(p_id uuid, p_outcome text, p_error text default null) returns void` — **service_role เท่านั้น** · `sent` → status sent + sent_at · `retry` → attempts+1, `next_attempt_at = now() + 2^attempts นาที` (เพดาน 60), ถ้า attempts ถึง 5 → `dead` · `failed` → status failed (ผิดถาวร เช่น 401/400) · `last_error` ตัดที่ 300 ตัวอักษร

## ฟังก์ชัน `notify_owner` (`supabase/functions/notify_owner/handler.ts` + `index.ts` ตามรูปแบบเดียวกับบท 13: `export default async (req, deps)`, ห้าม import ตอนรัน)
`POST` (ใครเรียกก็ได้ที่ผ่านการ์ดของ Supabase — ตัวเรียกจริงคือ cron/Database Webhook) → `claim_notifications` → ส่ง push ทีละแถวไป `${LINE_API_BASE}/v2/bot/message/push`:
- header `Authorization: Bearer <token>` และ `X-Line-Retry-Key: <retry_key ของแถว>` · body `{"to": LINE_OWNER_USER_ID, "messages":[{"type":"text","text":"ออเดอร์ใหม่ SC-… · ยอด 130 บาท"}]}` (ภาษาไทย มีเลขออเดอร์และยอด)
- 200 หรือ 409 → `sent` · 429 / 5xx / เน็ตล่ม / ช้ากว่า 5 วินาที → `retry` · 400 / 401 / 403 → `failed` · ไม่มี token หรือ owner id ใน env → `failed` ด้วย `line_not_configured` (ไม่ crash)
- `last_error` มีรหัสสถานะ/ข้อความสั้น ๆ แต่ **ห้ามมี token หรือ header**
- ตอบ 200 `{"sent":n,"retry":n,"failed":n}`

## เสร็จเมื่อ
`npm test`, `npm run test:db` และ `npm run check -- 15` ผ่าน · test ของฟังก์ชันอยู่ที่ `supabase/functions/notify_owner/handler.test.ts` (ใช้ LINE จำลอง)
