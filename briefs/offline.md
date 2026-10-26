# Brief: POS ตอนเน็ตหลุด — ปิดบิลต่อได้ เปิดเน็ตแล้วส่งครบ ไม่ซ้ำ + ใบเสร็จ
> ข้อมูลสมมติเพื่อการเรียน · ชื่อและกติกาในนี้คือข้อตกลงที่ `npm run check -- 21` อ่านตามเป๊ะ · ใช้ Supabase ในเครื่อง ไม่ต้องสมัครอะไร

## เป้าหมาย
Wi-Fi ร้านหลุดกลางชั่วโมงเร่งด่วน แคชเชียร์ต้องปิดบิลต่อได้ **ไม่ต้องรอเน็ต** พอเน็ตกลับมาบิลทั้งหมดถูกส่งเข้าฐานข้อมูล **ครบ ตามลำดับ และไม่ซ้ำ** แม้ส่งซ้ำ ส่งพร้อมกัน หรือแอปเปิดใหม่คั่นกลาง · หลักคิดคือ **หนึ่ง API หลาย client**: ราคาและยอดทุกอย่างคิดซ้ำที่ฝั่งเซิร์ฟเวอร์ (client ส่งแค่ "ขายอะไร") และบิลหนึ่งใบมีเลขประจำตัว `client_order_id` ที่ตั้งตั้งแต่ตอนกดบันทึก

## 1) คิวฝั่ง client `pos/src/queue.ts` (ไม่ผูกกับเบราว์เซอร์ จึงทดสอบได้)
```ts
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }  // เหมือน localStorage
export type PendingBill = { client_order_id: string; lines: BillLine[]; redeem_points?: number; points_balance?: number; cash_received?: number; at: string; customer_phone?: string }
export function createBillQueue(storage: KV, send: (b: PendingBill) => Promise<{ duplicate?: boolean } | void>, opts?: { key?: string; newId?: () => string }): {
  enqueue(input: Omit<PendingBill, 'client_order_id' | 'at'> & { at?: string }): PendingBill
  pending(): PendingBill[]
  dead(): { bill: PendingBill; error: string }[]
  flush(): Promise<{ sent: number; failed: number; dead: number; remaining: number }>
}
```
กติกา:
1. `enqueue` ตั้ง `client_order_id` (UUID v4, ใช้ `opts.newId` ถ้ามี ไม่งั้น `crypto.randomUUID()`) และ `at` (ISO ตอนนั้น ถ้าไม่ระบุ) แล้ว **บันทึกลง storage ทันที** (ปิดแอปแล้วเปิดใหม่ = `createBillQueue` ใหม่บน storage เดิมต้องเห็นบิลเดิมด้วย id เดิม) · `pending()` เรียงตามลำดับ enqueue
2. `flush` ส่งทีละใบตามลำดับ · `send` สำเร็จ (รวมตอบ `{duplicate:true}`) → เอาออกจากคิว นับ `sent` · `send` throw error ทั่วไป (เน็ตหลุด) → **หยุดทันที** บิลนั้นและที่เหลือยังอยู่ตามลำดับเดิม นับ `failed` 1
3. error ที่มี `retryable === false` (เซิร์ฟเวอร์ปฏิเสธเพราะบิลผิด ส่งกี่ครั้งก็ไม่ผ่าน) → ย้ายบิลไป `dead()` พร้อมข้อความ error แล้ว **ส่งใบถัดไปต่อ** (ไม่ให้บิลเสียหนึ่งใบค้างทั้งคิว)
4. `flush` ที่ถูกเรียกซ้อนกัน (กดรัว, timer + event) ใช้งานเดียวกัน: **ไม่มีบิลไหนถูกส่งสองครั้งพร้อมกัน** · `enqueue` ระหว่าง flush ต้องไม่หาย และถูกส่งในรอบเดียวกันหรือรอบถัดไป
5. id ไม่เปลี่ยนตอนส่งซ้ำ (ส่งใหม่ด้วย `client_order_id` เดิมเสมอ)

## 2) API ฝั่งฐานข้อมูล (migration ใหม่ ห้ามแก้ migration เก่า)
- ตาราง `pos_bills` (`id uuid pk`, `client_order_id uuid not null unique`, `code text unique`, `subtotal, discount, total int`, `cash_received int null`, `change int null`, `points_earned, points_redeemed int`, `customer_phone text null`, `at timestamptz`, `created_at timestamptz default now()`, `staff uuid`) และ `pos_bill_items` (`id`, `bill_id` → `pos_bills` on delete cascade, `item_name text`, `qty int`, `unit_price int`, `line_total int`, `label text`, `options jsonb`) · RLS เปิดทั้งคู่
- **ไม่มีใครเขียนตารางตรง ๆ ได้** (anon, ลูกค้า, แม้ผู้ใช้ที่ตั้ง `user_metadata.role='staff'` เอง ก็ไม่ได้) · อ่านได้เฉพาะพนักงาน (`app_metadata.role = 'staff'`)
- เขียนผ่านฟังก์ชันเดียว `pos_record_bill(p_client_order_id uuid, p_lines jsonb, p_redeem_points int default 0, p_points_balance int default 0, p_cash_received int default null, p_at timestamptz default now(), p_customer_phone text default null) returns jsonb`:
  - **เฉพาะพนักงาน** (ไม่ใช่ → `raise exception 'forbidden: …'`) · `anon` เรียกไม่ได้เลย
  - `p_lines` รูปแบบเดียวกับ `BillLine` ของ `bill.ts` (`[{item, qty, options:{size,milk,sweetness,extra_shots}}]`) · **คิดราคา ส่วนลด แต้ม เงินทอน ที่ฝั่งเซิร์ฟเวอร์เองจาก `menu_items`/`options`** ด้วยกติกาเดียวกับ `pos/src/bill.ts` ทุกข้อ (บท 20: ใช้แต้ม 1 แต้ม = 1 บาท, ได้แต้ม floor(total/25) ×2 วันเสาร์ตามเวลา Asia/Bangkok ของ `p_at`, error code เดียวกัน `unknown_item|bad_qty|bad_option|bad_points|empty_bill|cash_short` ขึ้นต้นข้อความ exception เป็น `code: …`) · ไม่รับยอดรวมจาก client
  - **idempotent:** `client_order_id` เดิม → ไม่เพิ่มแถว คืนบิลเดิมพร้อม `"duplicate": true` · เรียกพร้อมกันหลายสายด้วย id เดียว → ได้ 1 แถว ไม่มีสายไหนได้ error (ระวัง unique violation) · id ต่างกันพร้อมกัน → `code` ไม่ซ้ำ
  - คืน `{id, code, subtotal, discount, total, change, points_earned, points_redeemed, duplicate}` · `code` รูปแบบ `PB-YYYYMMDD-NNNN` (YYYYMMDD = วันที่ไทยของ `p_at`, NNNN = ลำดับของวันนั้น เริ่ม 0001)
- test SQL `supabase/tests/13_pos_bills.sql` (หรือชื่ออื่นที่มี `pos_bills`) พิสูจน์: ส่งซ้ำไม่เพิ่มแถว, ผู้ใช้ทั่วไปเรียกไม่ได้ · `npm run test:db` ผ่านทั้งหมด

## 3) ใบเสร็จ `pos/src/receipt.ts`
`renderReceipt(bill: Bill, info: { shop_name: string; bill_no: string; at: string }): string[]` — บรรทัดข้อความสำหรับเครื่องพิมพ์ใบเสร็จแคบ:
- แต่ละบรรทัด **กว้างไม่เกิน 32 คอลัมน์** (สระบน/วรรณยุกต์ไทย U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E กว้าง 0) · ชื่อร้านยาวหรือรายการยาวต้องตัดบรรทัด
- มี: ชื่อร้านกลางบรรทัด (**มาจาก `info.shop_name` ซึ่งหน้าจออ่านจากตาราง `settings` คีย์ `shop_name` ห้ามพิมพ์ชื่อร้านในโค้ด**), `bill_no`, วันเวลา `dd/MM/yyyy HH:mm` เวลาไทยของ `info.at`, แต่ละรายการ (`label`, จำนวน × ราคาต่อหน่วย, ยอดบรรทัด), รวม, ส่วนลด (ถ้ามี), สุทธิ, รับเงิน/ทอน (ถ้ามี), แต้มที่ได้, ท้ายใบ "ขอบคุณที่มาอุดหนุน" · ไม่มีคำว่า `undefined` หรือ `NaN`
- test ที่ `pos/src/receipt.test.ts`

## 4) หน้าจอ POS (ต่อจากบท 20; `pos/src/`)
- เพิ่ม `@supabase/supabase-js` ใน `pos/` (`cd pos && npm install @supabase/supabase-js`) · อ่าน URL/key จาก `import.meta.env.VITE_SUPABASE_URL` และ `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` (ถ้าต้องการอ่านจาก `.env` ที่ root ให้ `define` เฉพาะ `SUPABASE_URL` กับ `SUPABASE_PUBLISHABLE_KEY` เหมือน `web/vite.config.ts` · **ห้ามให้ `SUPABASE_SECRET_KEY` หลุดเข้า bundle**)
- หน้าล็อกอินพนักงาน: `login-email`, `login-password`, `login-submit` (ล็อกอินแล้วเห็นหน้า POS เดิมของบท 20; session คงอยู่หลังรีโหลด)
- `save-bill`: สร้างบิลจากสิ่งที่อยู่บนจอด้วย `computeBill` → `enqueue` ลงคิว (`localStorage`) → แสดงใบเสร็จใน `receipt` (องค์ประกอบ `<pre>`) → ล้างบิลบนจอ → `flush` (**ไม่รอเน็ต ปุ่มต้องใช้ได้ตอนออฟไลน์**) · `send` เรียก `rpc('pos_record_bill', …)` โดยแยกให้ถูกว่า error จากเน็ตหลุด (retry) กับเซิร์ฟเวอร์ปฏิเสธบิล (`retryable: false`)
- `pending-count` = จำนวนบิลที่ยังไม่ส่ง (ตัวเลข) · `sync-status` = ข้อความสถานะสั้น ๆ · เน็ตกลับมา (event `online` หรือ timer ไม่เกิน 10 วินาที) → flush อัตโนมัติ
- ชื่อร้านบนใบเสร็จมาจากตาราง `settings` คีย์ `shop_name` · **ในฐานข้อมูลนี้เฉพาะ role `anon` อ่าน `settings` ที่ `is_public` ได้ (role `authenticated` ไม่มีสิทธิ์)** จึงอ่านด้วย client แยกที่ไม่ใช้ session ล็อกอิน (`persistSession: false`) · เก็บค่าล่าสุดไว้ใน `localStorage` ใช้ตอนไม่มีเน็ต · ห้ามเปิดสิทธิ์ให้ `authenticated` เพิ่มเพียงเพื่อเรื่องนี้

## เสร็จเมื่อ
`npm test` ผ่าน (มี test ของ `queue.ts` และ `receipt.ts`) · `npm run test:db` ผ่าน · `cd pos && npm run build` ผ่าน · `npm run check -- 21` ผ่าน · commit เป็นภาษาไทย · รายงานสิ่งที่ยังไม่ได้ตรวจ (เช่น เครื่องพิมพ์ใบเสร็จจริง, Wi-Fi หลุดจริงบนเครื่องหน้าร้าน)
