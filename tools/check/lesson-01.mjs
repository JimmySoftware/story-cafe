import { exists, read, menuItems, lines } from './lib.mjs'

const html = () => read('menu.html')
const text = () => html().replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')

export const checks = [
  { part: 'win', name: 'มีไฟล์ menu.html', run: () => ({ ok: exists('menu.html'), hint: 'ยังไม่มี menu.html ในโฟลเดอร์' }) },
  {
    part: 'win', name: 'เมนูครบทั้ง 12 รายการ ชื่อและราคาตรงกับ menu.txt',
    run: () => {
      const t = text(); const missing = []
      for (const it of menuItems()) {
        const i = t.indexOf(it.name)
        const near = i < 0 ? '' : t.slice(i, i + it.name.length + 80)
        if (i < 0 || !new RegExp(`(^|[^0-9])${it.price}([^0-9]|$)`).test(near)) missing.push(`${it.name} ${it.price}`)
      }
      return { ok: menuItems().length === 12 && missing.length === 0, hint: missing.length ? `หาไม่เจอหรือราคาไม่ตรง: ${missing.join(', ')}` : 'อ่าน menu.txt ไม่ครบ 12 รายการ' }
    },
  },
  {
    part: 'win', name: 'มีกล่องตัวเลือก (ไซซ์ ความหวาน นม shot) พร้อมราคาที่บวก',
    run: () => {
      const t = text(); const need = ['ไซซ์', 'ความหวาน', 'นม', 'shot', '+15', '+20', 'โอ๊ต', 'อัลมอนด์']
      const miss = need.filter((k) => !t.toLowerCase().includes(k.toLowerCase()))
      return { ok: miss.length === 0, hint: `ยังขาด: ${miss.join(', ')}` }
    },
  },
  {
    part: 'win', name: 'มีชื่อร้าน Story Cafe เวลาเปิด 07:30–17:00 และ lang="th"',
    run: () => ({ ok: /Story Cafe/.test(text()) && /07[:.]30/.test(text()) && /17[:.]00/.test(text()) && /<html[^>]*lang=["']th["']/i.test(html()), hint: 'ต้องมีชื่อร้าน เวลาเปิด และ <html lang="th">' }),
  },
  {
    part: 'win', name: 'ไฟล์เดียวใช้ได้ออฟไลน์ (ไม่โหลดอะไรจากอินเทอร์เน็ต) และใช้ฟอนต์จาก fonts/',
    run: () => {
      const h = html()
      const ext = /(src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import\s+(url\()?["']?https?:/i.test(h)
      return { ok: !ext && /fonts\/Kanit/i.test(h), hint: ext ? 'มีการโหลดไฟล์จากอินเทอร์เน็ต (https://…) — ต้องใช้ไฟล์ในเครื่อง' : 'ยังไม่ได้อ้างฟอนต์ fonts/Kanit-*.ttf' }
    },
  },
  {
    part: 'win', name: 'ไม่มีเบอร์โทรจริง (ใช้ค่าสมมติ 0X-XXX-XXXX เท่านั้น)',
    run: () => ({ ok: !/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/.test(text()), hint: 'เจอตัวเลขที่ดูเหมือนเบอร์โทรจริง — เปลี่ยนเป็น 0X-XXX-XXXX' }),
  },
  {
    part: 'win', name: 'มี CLAUDE.md สั้น ๆ (3–25 บรรทัด) ที่ชี้ไปที่ menu.txt',
    run: () => {
      const n = lines('CLAUDE.md').filter((l) => l.trim()).length
      return { ok: n >= 3 && n <= 25 && /menu\.txt/.test(read('CLAUDE.md')), hint: 'CLAUDE.md ต้องมี 3–25 บรรทัดและพูดถึง menu.txt' }
    },
  },
]
