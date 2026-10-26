# Brief: POS หน้าร้าน (Tauri) — คิดบิล รับเงิน ทอน ใช้แต้ม
> ข้อมูลสมมติเพื่อการเรียน · ชื่อและสูตรในนี้คือข้อตกลงที่ `npm run check -- 20` อ่านตามเป๊ะ · POS ยังไม่ต่อฐานข้อมูล (บท 21 ทำ) คิดเงินในเครื่องล้วน ๆ

## เป้าหมาย
แคชเชียร์กดเมนู เลือกตัวเลือก ใส่แต้มที่ลูกค้าอยากใช้ รับเงิน แล้วเห็น **ยอดรวมและเงินทอนที่ถูกต้องเสมอ** · เปลือกโปรแกรมเป็น Tauri (หน้าต่างบนเครื่องคอมหน้าร้าน) ส่วนคิดเงินเขียนเป็น TypeScript ที่ทดสอบได้โดยไม่ต้องเปิดหน้าต่าง

## ไฟล์สำเร็จที่ให้มา (`pos/`)
- `pos/src-tauri/` (Tauri 2: `Cargo.toml`, `tauri.conf.json`, `src/lib.rs`) · `pos/package.json`, `vite.config.ts`, `index.html`, `src/main.tsx` (หน้าว่าง)
- `pos/scripts/build-catalog.mjs` สร้าง `pos/public/catalog.json` จาก `data/menu.csv` + `data/options.csv` (`npm run catalog` ใน `pos/`) — **ราคาจริงอยู่ที่ `data/` ที่เดียว ห้ามพิมพ์ราคาซ้ำในโค้ด POS**
- เตรียมเครื่องครั้งเดียว (ขั้นที่เห็นได้ ไม่ทำเงียบ): `cd pos && npm install && npm run build && cd src-tauri && cargo build` (ดึง crate + คอมไพล์ Tauri ครั้งแรกใช้เวลาหลายนาที จึงทำก่อนเริ่มบท)

## 1) คิดบิล `pos/src/bill.ts`
```ts
export type Catalog = { items: { name: string; price: number; is_drink: boolean }[]; options: { kind: string; label: string; price_delta: number }[] }
export type BillLine = { item: string; qty: number; options?: { size?: 'S' | 'M' | 'L'; sweetness?: string; milk?: string; extra_shots?: number } }
export type BillInput = { lines: BillLine[]; redeem_points?: number; points_balance?: number; cash_received?: number; at?: string }
export type Bill = {
  lines: { item: string; qty: number; unit_price: number; line_total: number; label: string }[]
  subtotal: number; discount: number; total: number
  cash_received: number | null; change: number | null
  points_earned: number; points_redeemed: number
}
export function computeBill(input: BillInput, catalog: Catalog): Bill
```
กติกา (ตัวเลขทุกตัวเป็นจำนวนเต็มบาท):
1. `unit_price` = ราคาเมนู + `price_delta` ของ size + ของ milk + (`extra_shots` × `price_delta` ของตัวเลือก kind `extra`) · ไม่ระบุ size = ราคาตามเมนู (ไม่บวก) · `sweetness` ตรวจแค่ว่าเป็นค่าที่มีอยู่จริง (ไม่เปลี่ยนราคา) · `label` = ข้อความสั้นสำหรับใบเสร็จ เช่น `ลาเต้ L โอ๊ต หวาน 50%`
2. `line_total` = `unit_price × qty` · `subtotal` = ผลรวมทุกบรรทัด
3. **ใช้แต้ม:** 1 แต้ม = ลด 1 บาท · `points_redeemed = min(redeem_points, points_balance, subtotal)` (ไม่ระบุ = 0) · `discount = points_redeemed` · `total = subtotal − discount`
4. **ได้แต้ม:** `points_earned = floor(total / 25)` (คิดจากยอดที่จ่ายจริง) **× 2 ถ้าวันที่เป็นวันเสาร์ตามเวลาไทย (Asia/Bangkok)** · `at` = เวลา ISO ของบิล (ไม่ระบุ = ตอนนี้) · ระวังเที่ยงคืน UTC ≠ เที่ยงคืนไทย
5. **รับเงิน:** ถ้าให้ `cash_received` และน้อยกว่า `total` → โยน error `cash_short` · ไม่งั้น `change = cash_received − total` · ไม่ให้ = `cash_received` และ `change` เป็น `null`
6. **error:** ใช้ `throw new Error('<code>: ข้อความไทย')` โดย code เป็นหนึ่งใน `unknown_item` (ไม่มีเมนูนี้) · `bad_qty` (qty ต้องเป็นจำนวนเต็ม 1–99) · `bad_option` (ตัวเลือกไม่มีในแคตตาล็อก, ตัวเลือกกับของที่ไม่ใช่เครื่องดื่ม, `extra_shots` ไม่ใช่จำนวนเต็ม 0–4) · `bad_points` (`redeem_points`/`points_balance` ติดลบหรือไม่ใช่จำนวนเต็ม) · `empty_bill` (ไม่มีบรรทัด) · `cash_short`
7. ฟังก์ชันนี้ **ไม่มี side effect** (ไม่อ่านไฟล์ ไม่เรียกเน็ต ไม่แก้ input) · test ที่ `pos/src/bill.test.ts` (node:test + tsx เหมือนส่วนอื่น; `npm test` ที่ root รันให้)
- ตัวอย่างที่ต้องได้: ลาเต้ (size L, milk โอ๊ต, sweetness 50%) 1 แก้ว + ครัวซองต์เนย 1 ชิ้น · ใช้ 30 แต้ม (มีแต้ม 100) · รับเงิน 200 → `subtotal 179 · discount 30 · total 149 · change 51 · points_earned 5` (วันธรรมดา)

## 2) หน้าจอ POS (`pos/src/`, React + Vite)
โหลด `/catalog.json` แล้วแสดงปุ่มเมนู · กดเลือกตัวเลือก · เพิ่มลงบิล · ใส่แต้ม · รับเงิน · ทุกค่าที่ตัวตรวจอ่านมี `data-testid` ตามนี้:
- ปุ่มเมนู `menu-<ชื่อเมนู>` (เช่น `menu-ลาเต้`) · ตัวเลือก `opt-size-S|M|L`, `opt-milk-<label>` (เช่น `opt-milk-โอ๊ต`), `opt-sweetness-<label>` (เช่น `opt-sweetness-50%`) · จำนวนช็อตเพิ่ม: ปุ่ม `shots-plus` / `shots-minus` · ปุ่ม `add-line` เพิ่มลงบิล (แล้วล้างตัวเลือก) · รายการในบิล `bill-line` (หนึ่งองค์ประกอบต่อบรรทัด)
- ช่องกรอก `balance-input` (แต้มคงเหลือของลูกค้า), `redeem-input` (แต้มที่ขอใช้), `cash-input` (เงินที่รับ) · ค่าที่แสดง (ข้อความเป็นตัวเลขล้วน ไม่มีหน่วยในองค์ประกอบเดียวกัน): `subtotal`, `discount`, `total`, `change`, `points-earned`
- ทุกตัวเลขในหน้าจอได้จาก `computeBill` เท่านั้น (ห้ามคิดซ้ำในคอมโพเนนต์) · ถ้าเงินไม่พอ `change` แสดงข้อความ "เงินไม่พอ" แทนตัวเลข · ปุ่มใหญ่พอกดเร็วด้วยนิ้ว (อย่างน้อย 44 px) ภาษาไทย ฟอนต์อ่านชัด

## 3) เปลือก Tauri
- `src-tauri/tauri.conf.json`: `productName` "Story Cafe POS", `identifier` `th.example.storycafe.pos`, `build.frontendDist` `../dist`, หน้าต่างกว้างอย่างน้อย 1000 px · **ห้ามเพิ่มสิทธิ์/permission ที่ไม่จำเป็น** (POS ยังไม่ต้องอ่านไฟล์หรือเน็ตผ่าน Tauri)
- `cargo check` ใน `pos/src-tauri/` ต้องผ่านหลัง `npm run build`
- เปิดหน้าต่างจริงด้วย `cd pos && npm run tauri dev` (ต้องมีจอ) · ขั้นนี้ผู้เรียนทำเอง · บน Windows/Mac ยังไม่ได้ทดสอบ

## เสร็จเมื่อ
`npm test` ผ่าน (มี test ของ `computeBill`) · `npm run check -- 20` ผ่าน · commit เป็นภาษาไทย
