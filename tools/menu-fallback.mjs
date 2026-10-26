// สร้าง web/public/menu-fallback.json ไว้ให้เว็บใช้เมื่อ Supabase หลับหรือล่ม
// เมนู+ราคา = data/menu.csv · ข้อมูลร้าน = settings ที่เปิดสาธารณะใน supabase/seed_settings.sql (ไม่พิมพ์ซ้ำค่าในโค้ด)
// ใช้: node tools/menu-fallback.mjs  (รันซ้ำได้ไฟล์เดิมเป๊ะ — เรียงตามลำดับในไฟล์ต้นทาง ไม่มีเวลา)
import { readFileSync, writeFileSync } from 'node:fs'

const src = (p) => new URL(`../${p}`, import.meta.url)
const fail = (msg) => { console.error(`สร้างไฟล์สำรองไม่ได้: ${msg}`); process.exit(1) }

const lines = readFileSync(src('data/menu.csv'), 'utf8').trim().split('\n')
if (lines[0].trim() !== 'category,name,price,is_drink') fail('หัวคอลัมน์ของ data/menu.csv ไม่ใช่ category,name,price,is_drink')
const menu = lines.slice(1).map((line, i) => {
  const [category, name, price, drink] = line.split(',').map((s) => s.trim())
  if (!category || !name || !Number.isFinite(Number(price)) || !/^[01]$/.test(drink ?? '')) fail(`data/menu.csv บรรทัด ${i + 2} ผิดรูปแบบ: ${line}`)
  return { category, name, price: Number(price), is_drink: drink === '1' }
})

// แถวใน seed: ('key', '<json>'::jsonb, true|false)
const sql = readFileSync(src('supabase/seed_settings.sql'), 'utf8')
const shop = {}
for (const m of sql.matchAll(/^\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'::jsonb\s*,\s*(true|false)\s*\)/gm)) {
  if (m[3] !== 'true') continue
  try { shop[m[1].replace(/''/g, "'")] = JSON.parse(m[2].replace(/''/g, "'")) } catch { fail(`ค่า ${m[1]} ใน seed_settings.sql ไม่ใช่ JSON`) }
}
if (!menu.length) fail('data/menu.csv ไม่มีรายการเมนู')
if (!Object.keys(shop).length) fail('อ่านข้อมูลร้านจาก supabase/seed_settings.sql ไม่ได้')

writeFileSync(src('web/public/menu-fallback.json'), JSON.stringify({ menu, shop }, null, 2) + '\n')
console.log(`สร้าง web/public/menu-fallback.json แล้ว: เมนู ${menu.length} รายการ · ข้อมูลร้าน ${Object.keys(shop).length} ค่า`)
