import { exists, read, lines, run, walk, inTemp } from './lib.mjs'
import { join } from 'node:path'

const md = () => read('CLAUDE.md')
const scripts = () => { try { return JSON.parse(read('package.json')).scripts ?? {} } catch { return {} } }
const nonEmpty = () => lines('CLAUDE.md').filter((l) => l.trim()).length

// ข้อที่ตรวจงานของผู้เรียนเอง: ข้ามเมื่อรันบน tag lesson-06 ตรง ๆ (ดู onTag ใน lib.mjs)
export const skipOnTag = (c) => c.part === 'break'

export const partNames = { break: 'ใช้ CLAUDE.md เพิ่มเมนู' }

export const checks = [
  { part: 'win', name: 'CLAUDE.md ยาว 30–75 บรรทัด (ไม่สั้นเกิน ไม่ยาวจนอ่านไม่ไหว)', run: () => ({ ok: nonEmpty() >= 30 && nonEmpty() <= 75, hint: `ตอนนี้ ${nonEmpty()} บรรทัด` }) },
  {
    part: 'win', name: 'มีกฎของร้านครบทั้ง 8 ข้อ (ราคา · VAT · ภาษาไทย · brief · .env · test · commit · ตอบไทย)',
    run: () => {
      const t = md(); const miss = []
      if (!/data\/menu\.csv/.test(t)) miss.push('ราคาอยู่ที่ data/menu.csv')
      if (!/vat/i.test(t)) miss.push('ไม่คิด VAT')
      if (!/stack\s*trace/i.test(t)) miss.push('ไม่มี stack trace')
      if (!/briefs\//.test(t)) miss.push('อ่าน briefs/ ก่อน')
      if (!/\.env/.test(t)) miss.push('ห้ามอ่าน .env')
      if (!/npm test/.test(t)) miss.push('รัน npm test ก่อนเสร็จ')
      if (!/commit/i.test(t) || !/push/i.test(t)) miss.push('กฎ commit/ห้าม push เอง')
      if (!/ภาษาไทย/.test(t)) miss.push('ตอบภาษาไทย')
      return { ok: miss.length === 0, hint: `ยังไม่มี: ${miss.join(', ')}` }
    },
  },
  { part: 'win', name: 'ทุกกฎมี "เหตุผล:" กำกับ (อย่างน้อย 8 จุด)', run: () => ({ ok: (md().match(/เหตุผล/g) ?? []).length >= 8, hint: `มีคำว่า "เหตุผล" ${(md().match(/เหตุผล/g) ?? []).length} จุด ต้อง 8` }) },
  {
    part: 'win', name: 'คำสั่ง npm ที่เขียนไว้ใช้ได้จริง (มีใน package.json)',
    run: () => {
      const s = scripts(); const used = [...md().matchAll(/npm run ([a-z][\w:-]*)/g)].map((m) => m[1])
      const bad = [...new Set(used)].filter((c) => !(c in s))
      return { ok: used.length >= 3 && bad.length === 0 && 'test' in s, hint: bad.length ? `คำสั่งที่ไม่มีใน package.json: ${bad.join(', ')}` : 'ต้องเขียนคำสั่ง npm run อย่างน้อย 3 คำสั่ง' }
    },
  },
  {
    part: 'win', name: 'พาธไฟล์ที่เขียนใน `…` มีอยู่จริงทั้งหมด (ไม่เดา)',
    run: () => {
      const paths = [...md().matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((p) => /^[\w./ก-๙-]+$/.test(p) && (p.includes('/') || /\.(md|csv|json|txt|html|ts|mjs)$/.test(p)) && !/^(npm|http|node)/.test(p) && !/\*|<|>|N{2,}|YYYY|\.\.|^\/(tmp|home)/.test(p))
      const all = walk('.')
      const generated = lines('.gitignore').map((l) => l.trim().replace(/^\//, '')) // โฟลเดอร์ที่สร้างตอนรัน (เช่น out/) ยังไม่มีในเครื่องก็ได้
      const missing = [...new Set(paths)].filter((p) => !exists(p.replace(/\/$/, '')) && !all.some((f) => f.endsWith('/' + p)) && !generated.includes(p))
      return { ok: missing.length === 0, hint: `ไม่พบไฟล์/โฟลเดอร์: ${missing.slice(0, 6).join(', ')}` }
    },
  },
  { part: 'win', name: 'npm test ผ่าน', run: () => { const r = run('npm', ['test', '--silent']); return { ok: r.ok, hint: 'npm test ไม่ผ่าน' } } },
  {
    part: 'break', name: 'มีเมนูใหม่ ลาเต้ส้ม 95 ใน data/menu.csv (หมวดกาแฟ เป็นเครื่องดื่ม) · ไม่ฝังราคาในโค้ด',
    run: () => {
      const row = lines('data/menu.csv').find((l) => l.split(',')[1]?.trim() === 'ลาเต้ส้ม') ?? ''
      const [cat, , price, drink] = row.split(',')
      const src = walk('tools').filter((p) => /\.(ts|mjs)$/.test(p) && !/\.test\.ts$/.test(p) && !p.startsWith('tools/check/')).map(read).join('\n')
      return { ok: cat === 'กาแฟ' && price === '95' && drink?.trim() === '1' && !/\b95\b/.test(src), hint: 'data/menu.csv ต้องมีแถว กาแฟ,ลาเต้ส้ม,95,1 และห้ามมีเลข 95 ในโค้ด' }
    },
  },
  {
    part: 'break', name: 'ใบเสนอราคาลาเต้ส้ม 10 แก้ว (รับที่ร้าน) ออกยอด 950 บาท',
    run: () => inTemp(['tools', 'data', 'orders', 'fonts', 'package.json'], (tmp) => {
      let o; try { o = JSON.parse(read('orders/ลาเต้ส้ม.json')) } catch { return { ok: false, hint: 'ไม่มี orders/ลาเต้ส้ม.json หรืออ่านไม่ได้' } }
      const okOrder = o.delivery === false && o.lines?.length === 1 && o.lines[0].item === 'ลาเต้ส้ม' && o.lines[0].qty === 10
      const r = run('npm', ['run', 'quote', '--silent', '--', 'orders/ลาเต้ส้ม.json'], { cwd: tmp })
      return { ok: okOrder && /ยอดสุทธิ 950 บาท/.test(r.out), hint: `คำขอต้องเป็นลาเต้ส้ม 10 แก้ว ไม่ส่ง และผลต้องเป็น 950 บาท (ได้: ${r.out.trim().split('\n').pop()})` }
    }),
  },
  {
    part: 'break', name: 'commit เป็นภาษาไทยแล้ว และ working tree สะอาด',
    run: () => {
      const s = run('git', ['log', '-1', '--format=%s']).out.trim()
      return { ok: /[ก-๙]/.test(s) && run('git', ['status', '--porcelain']).out.trim() === '', hint: `commit ล่าสุด: "${s}" — ต้องเป็นภาษาไทยและไม่มีไฟล์ค้าง` }
    },
  },
]
