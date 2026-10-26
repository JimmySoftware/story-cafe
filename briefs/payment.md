# Brief: รับเงิน PromptPay (Stripe โหมดทดสอบ) + ทางสำรองสลิป
> ข้อมูลสมมติเพื่อการเรียน · ชื่อในนี้คือข้อตกลงที่ `npm run check -- 13` อ่านตามเป๊ะ · ทุกอย่างรันกับ **Stripe จำลองในเครื่อง** (`tools/fakes/stripe.mjs`) ไม่ต้องสมัครอะไร
> ของจริงที่ยังต้องตรวจหลังสมัคร Stripe (โหมดทดสอบ): แสดง QR ด้วย Stripe.js, `stripe listen`, ใบหน้า dashboard — ไม่ทำในบทนี้

## ลำดับการจ่ายเงิน (ตามเอกสาร Stripe PromptPay)
1. ลูกค้าสั่งของ (`create_order` จากบท 12 ได้ออเดอร์ `pending`)
2. เซิร์ฟเวอร์ **สร้าง PaymentIntent** (`POST /v1/payment_intents`: `amount` หน่วยสตางค์ = ยอดออเดอร์ × 100, `currency=thb`, `payment_method_types[]=promptpay`, `metadata[order_code]`) แล้วส่ง `client_secret` ให้หน้าเว็บแสดง QR ด้วย Stripe.js (ขั้นนี้ทำหลังสมัคร)
3. ลูกค้าสแกนจ่าย → Stripe ส่ง **webhook** `payment_intent.succeeded` มาที่เรา → เราเปลี่ยนออเดอร์เป็น `paid`
**สถานะจ่ายแล้วเชื่อ webhook เท่านั้น** ห้ามเชื่อหน้าเว็บที่บอกว่าจ่ายแล้ว

## ตัวแปรสภาพแวดล้อมของฟังก์ชัน (ชื่อตาม `.env.example`)
`STRIPE_SECRET_KEY` (ต้องขึ้นต้น `sk_test_` — ถ้าเป็น `sk_live_` ให้ปฏิเสธทำงาน) · `STRIPE_WEBHOOK_SECRET` (`whsec_…`) · `STRIPE_API_BASE` (ค่าเริ่มต้น `https://api.stripe.com`; ตอนทดสอบชี้ไปที่ Stripe จำลอง) · `SUPABASE_URL` / `SUPABASE_SECRET_KEY`
**ความลับห้ามอยู่ในโค้ด ในข้อความ error หรือใน log**

## รูปแบบไฟล์ของฟังก์ชัน (เพื่อให้ทดสอบด้วย Node ได้ และ deploy ด้วย Deno ได้)
`supabase/functions/<ชื่อ>/handler.ts` — `export default async function handler(req: Request, deps: Deps): Promise<Response>` โดย `Deps = { env: Record<string,string|undefined>; fetch: typeof fetch; db: SupabaseClient }` (db = สิทธิ์ service) · **ห้าม import อะไรตอนรัน** ใช้เฉพาะ Web API มาตรฐาน (`crypto.subtle`, `fetch`, `Request`/`Response`) และ `import type` ได้
`supabase/functions/<ชื่อ>/index.ts` — เปลือกบาง ๆ สำหรับ Deno: `Deno.serve((req) => handler(req, { env: Deno.env.toObject(), fetch, db: createClient(...) }))`
ตัวตรวจเปิด `handler.ts` ด้วย `tools/check/serve-handler.mjs` (Node + tsx) แล้วยิง HTTP จริง

## ตาราง + ฟังก์ชัน SQL (migration ใหม่)
- `payments(id uuid pk, order_id uuid unique → shop_orders, provider text default 'stripe', provider_ref text unique, amount int /*บาท*/, status text /*created|succeeded|failed*/, created_at timestamptz default now())`
- `stripe_events(id text pk, type text, received_at timestamptz default now())`
- `payment_slips(id uuid pk, order_id uuid → shop_orders, storage_path text, status text /*pending|approved|rejected*/ default 'pending', reason text, created_at timestamptz default now(), reviewed_at timestamptz)`
- `mark_order_paid(p_code text, p_ref text, p_amount int) returns jsonb` — **เรียกได้เฉพาะ service_role** (anon/authenticated เรียกไม่ได้) · ออเดอร์ `pending` → `paid` · ยอด `p_amount` (บาท) ต้องเท่ายอดออเดอร์ ไม่เท่า → `raise exception 'amount_mismatch'` · เรียกซ้ำกับออเดอร์ที่ `paid` แล้ว → `{"already":true}` ไม่ทำซ้ำ · ออเดอร์ไม่มี → `not_found`
- `record_stripe_event(p_id text, p_type text) returns boolean` — service_role เท่านั้น · ใหม่ → true · เคยรับแล้ว → false
- `submit_slip(p_code text, p_path text) returns jsonb` — ผู้ใช้ที่ล็อกอิน เฉพาะออเดอร์ของตัวเอง (คนอื่น → `not_found`) · สร้าง `payment_slips` pending
- `review_slip(p_slip uuid, p_approve boolean, p_reason text default null) returns jsonb` — **พนักงานเท่านั้น** (JWT `app_metadata.role = 'staff'`; ลูกค้าเรียก → `forbidden`) · อนุมัติ → สลิป approved + ออเดอร์ paid (ยอดตามออเดอร์) · ปฏิเสธ → rejected + เหตุผล ออเดอร์ยัง pending
- RLS: ผู้ใช้อ่าน `payments`/`payment_slips` ของออเดอร์ตัวเองได้ · `stripe_events` ปิดทั้งหมด

## ฟังก์ชัน `create_payment`
`POST` JSON `{"order_code":"SH-…"}` + header `Authorization: Bearer <JWT ผู้ใช้>`
- ไม่มี/ผิด JWT → 401 · ออเดอร์ไม่มีหรือไม่ใช่ของผู้ใช้ → 404 (ข้อความเดียวกัน) · ออเดอร์ไม่ใช่ `pending` → 409
- **ยอดอ่านจากฐานข้อมูล** ไม่ใช้ตัวเลขที่ลูกค้าส่งมา (ลูกค้าส่ง `amount` มาก็ไม่มีผล)
- เรียก Stripe พร้อม header `Idempotency-Key: order-<code>` (กดซ้ำได้ PaymentIntent เดียว) · เก็บ `payments` (status created)
- สำเร็จ → 200 `{"payment_intent_id":"pi_…","client_secret":"…","amount_thb":380}`
- Stripe ตอบ error → 502 `{"error":"payment_provider_error"}` (ไม่ส่งข้อความหรือ key ของ Stripe ต่อให้ลูกค้า)

## ฟังก์ชัน `payment_webhook`
`POST` ตัวอักษรดิบจาก Stripe + header `Stripe-Signature`
1. **ตรวจลายเซ็นก่อน parse JSON เสมอ**: `t=<unix>,v1=<hex>` · `signed_payload = t + "." + raw body` · HMAC-SHA256 กุญแจ `STRIPE_WEBHOOK_SECRET` · เทียบแบบ constant-time · ใช้เฉพาะ `v1` · ค่า `t` ห่างจากเวลาปัจจุบันเกิน 300 วินาที → ปฏิเสธ · ไม่ผ่าน → 400 `{"error":"bad_signature"}` (body ขยะก็ต้อง 400 ไม่ใช่ 500)
2. กันซ้ำด้วย event id (`record_stripe_event`) — ซ้ำ → 200 `{"duplicate":true}` ไม่ทำอะไรซ้ำ
3. `payment_intent.succeeded` → `mark_order_paid(metadata.order_code, id, amount_received/100)` + `payments.status = succeeded` · ยอดไม่ตรง → 400 `{"error":"amount_mismatch"}` ออเดอร์ไม่ถูกเปลี่ยน
4. `payment_intent.payment_failed` → `payments.status = failed` ออเดอร์ยัง pending · event ชนิดอื่น → 200 ข้าม

## เสร็จเมื่อ
`npm test`, `npm run test:db`, `npm run check -- 13` (ตรวจครบทั้งสามส่วน) ผ่าน · test ของฟังก์ชันอยู่ใน `supabase/functions/<ชื่อ>/handler.test.ts` (รันกับ `npm test` ได้ ใช้ Stripe จำลองและ `signStripe` จาก `tools/fakes/stripe.mjs`)
