# Brief: ร้านเมล็ดกาแฟและ drip bag ออนไลน์ (สมัครสมาชิก + ตะกร้า + สั่งซื้อ)
> ข้อมูลสมมติเพื่อการเรียน · ชื่อตาราง/ฟังก์ชันในนี้คือข้อตกลงที่ตัวตรวจ `npm run check -- 12` อ่านตามเป๊ะ · ยังไม่มีการจ่ายเงินออนไลน์ (บท 13)

## หลักการ
1. **สินค้ามีจำนวนจำกัด** — ตัดสต็อกที่ฐานข้อมูลใน transaction เดียวกับการสร้างออเดอร์ ห้ามตัดที่หน้าเว็บ · สต็อกห้ามติดลบไม่ว่าจะมีคนกดพร้อมกันกี่คน
2. **ต้องล็อกอินก่อนสั่ง** (Supabase Auth อีเมล + รหัสผ่าน) · ลูกค้าเห็นได้เฉพาะออเดอร์ของตัวเอง (RLS)
3. **ราคาคิดที่ฐานข้อมูล** จาก `products.price` ไม่เชื่อราคาที่หน้าเว็บส่งมา
4. ข้อมูลสินค้ามาจาก `data/products.csv` (seed) — **ย้าย key `products` ออกจาก `settings`** (migration ลบแถวนั้น) เพราะสินค้าอยู่ในตาราง `products` แล้ว
5. migration ใหม่ + test SQL (`npm run test:db`) · ห้ามแก้ migration เก่า

## ตาราง
| ตาราง | คอลัมน์ (ชื่อต้องตรง) |
|---|---|
| `products` | `id uuid` (pk), `sku text` (unique), `name text`, `price int` (>= 0), `stock int` (**check >= 0**), `active boolean` (default true), `sort int` |
| `shop_orders` | `id uuid` (pk), `code text` (unique, เช่น `SH-4821`), `user_id uuid` → auth.users, `status text` (`pending` / `paid` / `cancelled` / `shipped`, default `pending`), `total int`, `ship_name text`, `ship_phone text`, `ship_address text`, `created_at timestamptz default now()` |
| `shop_order_items` | `id uuid` (pk), `order_id uuid` → shop_orders (on delete cascade), `product_id uuid` → products, `qty int` (> 0), `unit_price int` |

RLS: `products` ทุกคนอ่านได้ (เฉพาะ active) แต่ไม่มีใครนอกจากฟังก์ชันแก้ `stock`/`price` ได้ · `shop_orders` / `shop_order_items`: ผู้ใช้ที่ล็อกอิน (`authenticated`) **อ่านได้เฉพาะของตัวเอง** (`user_id = auth.uid()`), anon อ่านไม่ได้เลย, ไม่มีใครเขียนตารางตรง ๆ (เขียนผ่านฟังก์ชัน)

## ฟังก์ชัน (security definer, `set search_path = public`)
`create_order(p_items jsonb, p_ship jsonb) returns jsonb`
- `p_items` = `[{"sku":"beans-250","qty":2}, …]` · `p_ship` = `{"name":"…","phone":"…","address":"…"}`
- สำเร็จ → `{"code":"SH-4821","total":760}` และสต็อกลดตามจำนวน
- ต้องล็อกอิน (anon เรียก → `not_authenticated`)
- ผิดกฎ → `raise exception` ข้อความขึ้นต้นด้วย: `empty_order` · `bad_qty` (qty ต้องเป็น 1–10) · `bad_product` (ไม่มี sku หรือไม่ active) · `out_of_stock` (สต็อกไม่พอ ข้อความต่อท้ายด้วย sku) · `bad_ship` (ขาดชื่อ/เบอร์/ที่อยู่)
- ทั้งออเดอร์สำเร็จหรือล้มทั้งออเดอร์ (ถ้ารายการที่ 2 หมด รายการที่ 1 ต้องไม่ถูกตัดสต็อก)

## หน้าเว็บ (ทำหลังฐานข้อมูลผ่านแล้ว)
`web/src/` มี: สมัคร/ล็อกอิน · หน้าร้านค้า (สินค้า + ตะกร้า) ที่ `#/shop` · หน้าออเดอร์ของฉัน — ใช้ `@supabase/supabase-js` (มีอยู่แล้ว) ข้อความ error เป็นภาษาไทย ไม่มี stack trace · ปุ่มสั่งต้องกดซ้ำไม่ได้ระหว่างรอ · build ต้องผ่านแม้ยังไม่ตั้ง `VITE_SUPABASE_*`

## เสร็จเมื่อ
`npm test` · `npm run test:db` · `cd web && npm run build` ผ่าน · สั่งพร้อมกันของชิ้นสุดท้าย ได้คนเดียว
