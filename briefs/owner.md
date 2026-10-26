# Brief: แอปมือถือเจ้าของร้าน (PWA) — ยอดวันนี้ แก้วต่อชั่วโมง สต็อกใกล้หมด
> ข้อมูลสมมติเพื่อการเรียน · ชื่อและกติกาในนี้คือข้อตกลงที่ `npm run check -- 22` อ่านตามเป๊ะ · ใช้ Supabase ในเครื่อง ไม่ต้องสมัครอะไร

## เป้าหมาย
เจ้าของร้านเปิดมือถือแล้วเห็น **ยอดขายวันนี้ จำนวนบิล จำนวนแก้ว แก้วต่อชั่วโมง และของที่ใกล้หมด** โดยตัวเลขมาจากฟังก์ชันเดียว `sales_summary` ที่นับให้ **ทุกช่องทาง** (POS หน้าร้าน, สั่งล่วงหน้า, ร้านเมล็ดกาแฟออนไลน์) ไม่มีสำเนาของสูตรนับซ้ำในหน้าจอหรือแยกตามช่องทาง · และสต็อกวัตถุดิบถูกตัดตามสูตรเครื่องดื่มทุกครั้งที่ขาย แม้มีตัวเลือกเพิ่ม (ช็อต, นมทางเลือก) · ใช้ PWA (ติดตั้งลงหน้าจอ) ไม่ใช่แอปเนทีฟ เพราะแอปนี้แค่อ่านตัวเลข ไม่ต้องใช้ฮาร์ดแวร์พิเศษ

## ส่วน A) `sales_summary` (migration ใหม่ ห้ามแก้ migration เก่า)
`sales_summary(p_day date default (now() at time zone 'Asia/Bangkok')::date) returns jsonb` — **เฉพาะพนักงาน/เจ้าของ** (`app_metadata.role = 'staff'`; anon, ลูกค้า, ผู้ใช้ที่ตั้ง `user_metadata.role` เองเรียกไม่ได้ → `raise exception 'forbidden: …'`) · มีฟังก์ชันนี้ **ตัวเดียว** (ห้ามทำ `sales_summary_pos`, `sales_summary_shop` ฯลฯ):
```json
{ "day": "2026-03-03", "bills": 11, "revenue": 1523, "cups": 9,
  "by_hour": [ { "hour": 8, "bills": 2, "cups": 3, "revenue": 241 } ],
  "by_source": { "pos": {"bills":0,"revenue":0,"cups":0}, "preorder": {…}, "shop": {…} } }
```
- นับต่อวันตามเวลา **Asia/Bangkok** (บิลตี 00:30 ไทย = วันนั้น แม้ยังเป็นเมื่อวานใน UTC)
- แหล่งข้อมูล: `pos_bills` ทุกใบ (เวลา `at`, ยอด `total`, แก้ว = Σ `qty × menu_items.cup_units` ของรายการใน `pos_bill_items`) · `orders` (สั่งล่วงหน้า) สถานะ `placed`/`picked_up` เท่านั้น (เวลา `created_at`, ยอด `total`, แก้ว = Σ `order_items.cups`) · `shop_orders` สถานะ `paid`/`shipped` เท่านั้น (เวลา `created_at`, ยอด `total`, แก้ว 0)
- `by_hour`: เรียงชั่วโมง 0–23 จากน้อยไปมาก, **รวมทุกช่องทาง**, มีเฉพาะชั่วโมงที่มีขาย (ใส่ชั่วโมงที่ 0 ก็ได้) · `by_source` มีครบ 3 คีย์เสมอ (ไม่มีขาย = 0) · ผลรวมของ `by_source` ต้องเท่ากับ `bills`/`revenue`/`cups` ด้านบน
- test SQL `supabase/tests/*sales_summary*.sql` พิสูจน์ตัวเลขด้วยข้อมูลตัวอย่างที่สร้างเองใน test (rollback ทุกอย่าง)

## ส่วน B) สต็อกตามสูตร + `stock_history`
- ตาราง `stock_history(id uuid pk, ingredient_id → ingredients, delta numeric not null (ติดลบ = ใช้ไป), reason text, source text not null, source_id uuid not null, created_at timestamptz default now(), unique(source, source_id, ingredient_id))` · RLS เปิด · เฉพาะพนักงานอ่านได้ · ไม่มีใครเขียนตรง ๆ
- ฟังก์ชันภายใน `apply_stock_for_bill(p_bill uuid)` (ลูกค้า/anon/พนักงานเรียกตรง ๆ ไม่ได้ — เรียกจาก `pos_record_bill` เท่านั้น) ตัด `ingredients.stock` และเขียน `stock_history` ด้วย `source = 'pos_bill'`, `source_id = id ของบิล` · **ปรับ `pos_record_bill` ด้วย `create or replace function` ใน migration ใหม่** (ห้ามแก้ไฟล์ migration บท 21; คัดลอกตัวฟังก์ชันมาเพิ่มบรรทัดเรียก) · บิลซ้ำ (`duplicate: true`) ต้องไม่ตัดซ้ำ · `ingredients.stock` และ `stock_history` ต้องสอดคล้องกันเสมอ
- กติกาการตัด (ต่อ 1 รายการในบิล × จำนวน `qty`):
  1. ตาม `recipes` ของเมนู (ลาเต้ = เมล็ด 18 g + นมวัว 180 ml)
  2. **ช็อตเพิ่ม** (`options.extra_shots = n`): ตัดเมล็ด `เมล็ดกาแฟ Story House Blend` เพิ่ม n × 18 g
  3. **นม:** `โอ๊ต` → ไม่ตัดนมวัว ตัด `นมโอ๊ต` เท่าปริมาณนมวัวในสูตร · `อัลมอนด์`/`ถั่วเหลือง` → ไม่ตัดนมวัว และ **ไม่ตัดอะไรแทน** (ร้านไม่ได้ติดตามสต็อกนมสองชนิดนี้ — บันทึกเหตุผลไว้ใน `reason`/ตารางตั้งค่า) · `นมวัว`/ไม่ระบุ → ตามสูตร
  4. เบเกอรี่ (ไม่มีสูตร) ไม่ตัดอะไร · ไซซ์ไม่ทำให้ปริมาณเปลี่ยน
- **ตัวเลือกต้องเก็บเป็นข้อมูล ไม่ใช่ if ในโค้ด:** ตาราง `option_ingredients(option_kind, option_label, ingredient_name, amount, mode ('add'|'replace'), replaces_ingredient_name, note)` + ข้อมูลตั้งต้นของข้อ 2–3 อย่างน้อย 3 แถว (ตัวตรวจไม่อ่านเนื้อหาตารางนี้ แต่การตัดสต็อกต้องมาจากตารางนี้) · **เก็บเป็นชื่อวัตถุดิบ (text) ไม่ใช่ id:** แถวของ `ingredients` ถูกใส่โดย `supabase/seed.sql` *หลัง* migration ทุกไฟล์รันแล้ว ถ้า migration ค้นหา id ของวัตถุดิบตอนรัน จะได้ค่าว่าง ต้องค้นชื่อตอนตัดสต็อก
- `stock_low()` returns table (`name`, `unit`, `stock`, `reorder_level`) = วัตถุดิบที่ `stock <= reorder_level` เรียงตามชื่อ · เฉพาะพนักงาน
- test SQL `supabase/tests/*stock*.sql` พิสูจน์ลาเต้โอ๊ต + 2 ช็อต × 2 แก้ว: เมล็ด −108 g, นมโอ๊ต −360 ml, นมวัว 0 · และส่งบิลเดิมซ้ำไม่ตัดซ้ำ

## ส่วน C) แอป `owner/` (PWA; มีโครง Vite + React ให้แล้ว พอร์ต 1430)
- ไฟล์สำเร็จ: `owner/package.json` (มี `@supabase/supabase-js`), `vite.config.ts`, `index.html`, `src/main.tsx` (หน้าว่าง), **ไอคอนจริง** `owner/public/icons/icon-192.png` และ `icon-512.png` (ใช้ไฟล์นี้ ห้ามสร้างใหม่)
- `owner/public/manifest.webmanifest`: `name`, `short_name`, `start_url` `"/"`, `display` `"standalone"`, `theme_color`, `background_color`, `icons` ชี้ไอคอน 192 และ 512 (`type: image/png`) · `index.html` ต้องมี `<link rel="manifest">`, `<meta name="theme-color">` และ viewport มือถือ
- service worker `owner/public/sw.js` ลงทะเบียนตอนโหลด (`navigator.serviceWorker.register('/sw.js')`): เก็บ **เปลือกแอป** (HTML/JS/CSS/ไอคอน) ไว้ใน cache ให้เปิดแอปได้ตอนออฟไลน์ · **ห้าม cache คำขอไป Supabase** (ตัวเลขเงินต้องสดหรือแจ้งว่าออฟไลน์ ไม่โชว์ของเก่าเหมือนเป็นของปัจจุบัน)
- หน้าจอ: ล็อกอิน (`login-email`, `login-password`, `login-submit`) → แสดง `today-total` (ยอดขาย), `today-bills`, `today-cups` (ตัวเลขล้วน ไม่มีเครื่องหมายคั่น/หน่วยในองค์ประกอบเดียวกัน), `hour-bar-<ชั่วโมง>` ต่อชั่วโมงที่มีขาย (แท่งกราฟ; ใส่ `data-cups="<จำนวนแก้ว>"` และ `data-revenue`), `stock-low-<ชื่อวัตถุดิบ>` ต่อรายการใกล้หมด · รองรับ `?day=YYYY-MM-DD` ในที่อยู่หน้า เพื่อดูย้อนหลัง/ทดสอบ (ไม่ระบุ = วันนี้เวลาไทย)
- ข้อมูลมาจาก `rpc('sales_summary')` และ `rpc('stock_low')` เท่านั้น (ห้ามคิดยอดซ้ำในหน้าจอ) · ใช้ `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` · **ห้ามให้ `SUPABASE_SECRET_KEY` อยู่ใน bundle**
- `cd owner && npm run build` ต้องผ่าน และ `dist/` มี `sw.js`, `manifest.webmanifest`, `icons/`

## เสร็จเมื่อ
`npx supabase db reset`, `npm test`, `npm run test:db` ผ่าน · `cd owner && npm run build` ผ่าน · `npm run check -- 22` ผ่าน · commit เป็นภาษาไทย · รายงานสิ่งที่ยังไม่ได้ตรวจ (เช่น ติดตั้งลงหน้าจอมือถือจริง, iOS Safari)
