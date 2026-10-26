# Brief: สรุปเช้า 07:00 + กดยืนยันออเดอร์จาก LINE
> ข้อมูลสมมติเพื่อการเรียน · ชื่อในนี้คือข้อตกลงที่ `npm run check -- 16` อ่านตามเป๊ะ · ทดสอบกับ LINE จำลอง (`tools/fakes/line.mjs`)
> ที่ต้องตรวจหลังสมัคร LINE: ตั้ง Webhook URL แล้วกด Verify ใน LINE Developers Console, ข้อความถึงมือถือจริง, pg_cron รันตามเวลาจริงบน Supabase

## สองเรื่องนี้ต่างกัน (อย่าสลับ)
- **cron** = เราเป็นฝ่ายเริ่ม: ทุกเช้า 07:00 เวลาไทย ระบบส่ง "สรุปเช้า" หาเจ้าของร้าน
- **webhook** = LINE เป็นฝ่ายเริ่ม: เจ้าของพิมพ์ในแชต → LINE ยิงมาที่เรา **ใครก็ยิงมาที่ URL นี้ได้** จึงต้องพิสูจน์ว่ามาจาก LINE จริงก่อนทำอะไร

## ค่า/ตารางใน migration ใหม่
- เปิดส่วนขยาย `pg_cron` และ `pg_net` · `cron.schedule('morning-summary', '0 0 * * *', …)` — **pg_cron ใช้เวลา UTC**: 07:00 เวลาไทย = 00:00 UTC จึงเป็น `0 0 * * *` (คำสั่งในงานต้องเรียกฟังก์ชัน `morning_summary` ผ่าน `net.http_post`; URL กับ key เก็บใน Vault/ค่าตั้งค่า ห้ามพิมพ์ในไฟล์ migration)
- `orders.status` เพิ่มค่า `confirmed` (ของเดิม: placed / cancelled / picked_up / expired)
- `line_events(id text pk, received_at timestamptz default now())` — เก็บ `webhookEventId` ที่รับแล้ว · RLS ปิดทั้งหมด
- `record_line_event(p_id text) returns boolean` — service_role เท่านั้น · ใหม่ → true · ซ้ำ → false
- `confirm_preorder(p_code text) returns jsonb` — service_role เท่านั้น · `placed` → `confirmed` คืน `{"code","status":"confirmed"}` · ไม่พบ → `not_found` · สถานะอื่น (cancelled/expired/…) → `bad_status` · ยืนยันซ้ำที่ confirmed แล้ว → `{"already":true}`
- `morning_summary_data(p_day date default (now() at time zone 'Asia/Bangkok')::date) returns jsonb` — service_role เท่านั้น · `{"day":"YYYY-MM-DD","orders":n,"cups":n,"first_pickup":"HH:MM","last_pickup":"HH:MM","low_stock":[{"name","stock","unit","reorder_level"}]}` · นับออเดอร์ `placed`/`confirmed` ที่เวลารับอยู่ในวันนั้น (เวลาไทย) · `cups` = ผลรวมคอลัมน์ `order_items.cups` (ซึ่งเป็นจำนวนแก้วของทั้งรายการอยู่แล้ว = cup_units × qty ตามบท 10 ห้ามคูณ qty ซ้ำ) · `low_stock` = วัตถุดิบที่ `stock <= reorder_level`

## ฟังก์ชัน `morning_summary` (`supabase/functions/morning_summary/handler.ts` + `index.ts` รูปแบบเดียวกับบท 13/15)
`POST` → `morning_summary_data` → ส่ง push หา `LINE_OWNER_USER_ID` เป็นภาษาไทย: วันที่, จำนวนออเดอร์และแก้ว, ช่วงเวลารับ, รายการวัตถุดิบใกล้หมด (ชื่อ + เหลือเท่าไร) — วัตถุดิบที่ยังพอไม่ต้องขึ้น
- `X-Line-Retry-Key` เป็น UUID ที่ **คำนวณจากวันที่** (วันเดียวกัน = key เดิมเสมอ เช่น เอา SHA-256 ของ `morning-YYYY-MM-DD` ใส่รูป UUID) เพื่อให้ cron รันซ้ำในวันเดียวกันไม่ส่งซ้ำ · LINE ตอบ 409 ให้ถือว่าส่งแล้ว (200)
- LINE ล่ม/ตอบผิด → 502 (ให้ cron รู้และลองใหม่) · ไม่มี token → 500 `line_not_configured` · ห้ามหลุด token ในคำตอบ

## ฟังก์ชัน `line_webhook` (`supabase/functions/line_webhook/…`)
`POST` ตัวอักษรดิบจาก LINE + header `x-line-signature` (ชื่อ header ไม่แยกตัวพิมพ์)
1. **ตรวจลายเซ็นก่อน parse JSON**: `x-line-signature` = Base64 ของ HMAC-SHA256(กุญแจ = `LINE_CHANNEL_SECRET`, ข้อมูล = body ดิบ) · เทียบแบบ constant-time · ไม่ผ่าน/ไม่มี header → 401 `{"error":"bad_signature"}` (body ขยะก็ 401 ไม่ใช่ 500)
2. `events` ว่าง (ปุ่ม Verify ของ LINE) → 200
3. แต่ละ event: ข้ามถ้า `record_line_event(webhookEventId)` ได้ false (LINE ส่งซ้ำ รวมถึง `isRedelivery`) · ทำเฉพาะ `type = message` ข้อความ `text` ที่ **`source.userId` เท่ากับ `LINE_OWNER_USER_ID`**
4. ข้อความ `ยืนยัน SC-1234` → `confirm_preorder` → ตอบกลับด้วย **reply API** (`replyToken`, ไม่นับโควตา push): สำเร็จ "ยืนยันออเดอร์ SC-1234 แล้ว" · ไม่พบ "ไม่พบออเดอร์ SC-1234" · สถานะไม่ใช่ placed "ออเดอร์ SC-1234 ยืนยันไม่ได้ (สถานะ …)"
5. คนอื่น (ไม่ใช่เจ้าของ) พิมพ์อะไรก็ **ไม่เปลี่ยนออเดอร์** (ตอบ "ไม่มีสิทธิ์" ได้หรือเงียบก็ได้) · ข้อความอื่นที่ไม่รู้จัก → ตอบวิธีใช้สั้น ๆ
6. ลายเซ็นถูกแล้ว ตอบ 200 เสมอ แม้ reply ไป LINE ล้มเหลว (ไม่ให้ LINE ส่งซ้ำไม่รู้จบ)

## เสร็จเมื่อ
`npm test`, `npm run test:db` และ `npm run check -- 16` ผ่าน · test ของทั้งสองฟังก์ชันอยู่ที่ `handler.test.ts` ข้างไฟล์ (ใช้ LINE จำลองและ `signLine` จาก `tools/fakes/line.mjs`)
