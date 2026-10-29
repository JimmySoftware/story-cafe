import { exists, read, lines, walk, menuItems } from './lib.mjs'
import { statSync } from 'node:fs'

const app = () => read('web/src/App.tsx')
const srcFiles = () => walk('web/src').filter((p) => /\.(tsx?|css)$/.test(p) && !/menu\.ts$|main\.tsx$|vite-env/.test(p))
const srcText = () => srcFiles().map(read).join('\n')
const mtime = (p) => (exists(p) ? statSync(p).mtimeMs : 0)

const nonEmpty = (p) => lines(p).filter((l) => l.trim()).length
export const partNames = { break: 'ตรวจ plugin ก่อนไว้ใจ', extra: 'เทียบกับ prompt แรก' }

export const checks = [
  { part: 'win', name: 'หน้าแรกถูกเขียนใหม่แล้ว (web/src/App.tsx ไม่ใช่หน้าชั่วคราว)', run: () => ({ ok: lines('web/src/App.tsx').length >= 25 && !/กำลังสร้างหน้าร้าน/.test(app()), hint: 'App.tsx ยังเป็นหน้าชั่วคราว' }) },
  { part: 'win', name: 'build ผ่านและมี web/dist/index.html (build หลังแก้ไฟล์ล่าสุด)', run: () => { const latest = Math.max(...srcFiles().map(mtime), 0); return { ok: exists('web/dist/index.html') && mtime('web/dist/index.html') >= latest - 1000, hint: 'ยังไม่มี web/dist หรือ build เก่ากว่าไฟล์ที่แก้ — รัน cd web && npm run build' } } },
  {
    part: 'win', name: 'เมนูในหน้ามาจาก src/menu.ts (ไม่พิมพ์ชื่อ/ราคาเมนูซ้ำในโค้ด)',
    run: () => {
      const t = srcText(); const items = menuItems()
      const usesMenu = /from ['"]\.\/menu['"]/.test(app()) && /\bmenu\b/.test(app())
      // ชื่อเมนูที่ถูกพิมพ์ซ้ำเป็นข้อความเดี่ยว ๆ ('ลาเต้' หรือ >ลาเต้<) ไม่นับคำที่ปนอยู่ในประโยค เช่น alt ของภาพ
      const hardNames = items.filter((i) => new RegExp(`['"\`>]\\s*${i.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*['"\`<]`).test(t)).map((i) => i.name)
      const code = srcFiles().filter((p) => p.endsWith('.tsx')).map(read).join('\n')
      const hardPrices = [55, 65, 75, 85, 90, 95, 69, 79, 120, 380, 175, 650].filter((p) => new RegExp(`(฿\\s*|price\\s*[:=]\\s*)${p}\\b|\\b${p}\\s*(บาท|฿)`).test(code)) // เฉพาะตัวเลขที่อยู่ในรูปราคา (ไม่นับพิกัด SVG)
      return { ok: usesMenu && hardNames.length === 0 && hardPrices.length === 0, hint: !usesMenu ? 'App.tsx ต้องอ่านเมนูจาก ./menu' : `พบข้อมูลที่ควรอ่านจากไฟล์ถูกพิมพ์ซ้ำในโค้ด: ${[...hardNames, ...hardPrices].slice(0, 5).join(', ')}` }
    },
  },
  {
    part: 'win', name: 'ข้อมูลเมนูครบ 12 รายการอยู่ในไฟล์ที่ build ออกมา',
    run: () => {
      const files = walk('web/dist').filter((p) => p.endsWith('.js')).map(read).join('\n')
      const miss = menuItems().filter((i) => !files.includes(i.name)).map((i) => i.name)
      return { ok: exists('web/dist/index.html') && miss.length === 0, hint: `ไม่พบใน build: ${miss.join(', ')}` }
    },
  },
  {
    part: 'win', name: 'ใช้ข้อมูลร้านจาก shop (ชื่อ ของขาย workshop) และคง lang="th" + title ภาษาไทย',
    run: () => {
      const a = app(); const idx = read('web/index.html')
      const ok = /shop\.name/.test(a) && /shop\.products/.test(a) && /shop\.workshop/.test(a) && /<html[^>]*lang=["']th["']/.test(idx) && /<title>[^<]*[ก-๙]/.test(idx)
      return { ok, hint: 'ต้องใช้ shop.name, shop.products, shop.workshop และไม่ลบ lang="th" / title ภาษาไทยใน web/index.html' }
    },
  },
  {
    part: 'win', name: 'ไม่โหลดอะไรจากอินเทอร์เน็ต และใช้ฟอนต์ Kanit จาก /fonts/',
    run: () => {
      const t = srcText() + read('web/index.html')
      const ext = /fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr|<img[^>]+src=["']https?:|url\(["']?https?:/i.test(t)
      return { ok: !ext && /\/fonts\/Kanit/.test(t), hint: ext ? 'พบการโหลดจากอินเทอร์เน็ต' : 'ยังไม่ได้อ้างฟอนต์ /fonts/Kanit-*.ttf' }
    },
  },
  {
    part: 'win', name: 'ปุ่มโทรไม่โทรออกหาเบอร์สมมติ (ไม่มีลิงก์ tel: ที่เป็นตัวเลขจริง)',
    run: () => {
      const t = srcText()
      const telLiteral = /tel:\s*\+?[0-9]/.test(t)
      const telDynamic = /tel:\$\{/.test(t) || /["']tel:["']\s*\+/.test(t) || /href=\{[^}]*tel:/.test(t)
      const guarded = !telDynamic || /\/\^?\\?\+?\[?0-9|\\d|replace\(|isNaN|test\(/.test(t)
      return { ok: !telLiteral && guarded, hint: 'ลิงก์ tel: ต้องสร้างเมื่อ shop.phone เป็นตัวเลขล้วนเท่านั้น (ค่าสมมติ 0X-XXX-XXXX ต้องไม่เป็นลิงก์)' }
    },
  },
  {
    part: 'break', name: 'มีรายงาน docs/plugin-review.md: plugin ที่ใช้ทำอะไร มี hooks/MCP/สคริปต์ไหม',
    run: () => {
      const t = read('docs/plugin-review.md')
      return { ok: lines('docs/plugin-review.md').filter((l) => l.trim()).length >= 8 && /frontend-design/.test(t) && /hook/i.test(t) && /MCP/i.test(t) && /(ปลอดภัย|ไม่พบ|พบ)/.test(t), hint: 'รายงานต้องยาวอย่างน้อย 8 บรรทัด พูดถึง frontend-design, hooks, MCP และสรุปผลตรวจ' }
    },
  },
  {
    part: 'extra', name: 'มีใบเทียบ docs/เทียบ-07.md ที่บอกว่า prompt แรก (สั่งสั้น ๆ ก่อนมี brief) ทำให้ Claude ต้อง "เดา" อะไร และ brief เพิ่มอะไร',
    run: () => ({ ok: nonEmpty('docs/เทียบ-07.md') >= 5 && /เดา/.test(read('docs/เทียบ-07.md')), hint: 'ใบเทียบต้องมีอย่างน้อย 5 บรรทัดและใช้คำว่า "เดา" บอกว่ารอบแรก Claude ต้องเดาอะไร และ brief ที่ร้านส่งมาเพิ่มอะไร' }),
  },
]
