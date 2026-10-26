// สร้าง pos/public/catalog.json จาก data/menu.csv + data/options.csv (ราคาจริงอยู่ที่ data/ ที่เดียว — POS ไม่พิมพ์ราคาซ้ำ)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const table = (file) => {
  const [head, ...rows] = readFileSync(join(root, 'data', file), 'utf8').split('\n').filter((l) => l.trim())
  const cols = head.split(',')
  return rows.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])))
}
const items = table('menu.csv').map((r) => ({ category: r.category, name: r.name, price: Number(r.price), is_drink: r.is_drink === '1' }))
const options = table('options.csv').map((r) => ({ kind: r.kind, label: r.label, price_delta: Number(r.price_delta), sort: Number(r.sort) }))
mkdirSync(join(root, 'pos', 'public'), { recursive: true })
writeFileSync(join(root, 'pos', 'public', 'catalog.json'), `${JSON.stringify({ items, options }, null, 2)}\n`)
console.log(`catalog.json: เมนู ${items.length} · ตัวเลือก ${options.length}`)
