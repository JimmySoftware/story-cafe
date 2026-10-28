import { exists, read, run, walk, inTemp } from './lib.mjs'
import { statSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const testRun = () => run('npm', ['test', '--silent'])

export const partNames = { break: 'ต่อยอด: เมนูจาก Excel' }

export const checks = [
  { part: 'win', name: 'มี tools/quote/pricing.ts และ tools/quote/cli.ts', run: () => ({ ok: exists('tools/quote/pricing.ts') && exists('tools/quote/cli.ts'), hint: 'ยังขาด pricing.ts หรือ cli.ts' }) },
  { part: 'win', name: 'npm test ผ่านทั้งหมด', run: () => { const r = testRun(); return { ok: r.ok, hint: r.out.split('\n').filter((l) => /not ok|fail|Error/i.test(l)).slice(0, 3).join(' | ') || 'npm test ไม่ผ่าน' } } },
  {
    part: 'win', name: 'npm run quote ได้ PDF และบรรทัดสุดท้ายบอกยอดสุทธิ 2,880 บาท',
    run: () => inTemp(['tools', 'data', 'orders', 'fonts', 'package.json'], (tmp) => {
      const r = run('npm', ['run', 'quote', '--silent', '--', 'orders/ออฟฟิศสมมติ.json'], { cwd: tmp })
      const last = r.out.trim().split('\n').pop() ?? ''
      const m = last.match(/ยอดสุทธิ\s+2,880\s+บาท\s*→\s*(\S+\.pdf)/)
      const f = m ? join(tmp, m[1]) : ''
      const ok = r.ok && !!m && existsSync(f) && readFileSync(f).subarray(0, 4).toString() === '%PDF' && statSync(f).size > 2000 && /^out\/QT-20261102-001\.pdf$/.test(m[1])
      return { ok, hint: `บรรทัดสุดท้ายที่ได้: "${last}" (ต้องเป็น ยอดสุทธิ 2,880 บาท → out/QT-20261102-001.pdf)` }
    }),
  },
  {
    part: 'win', name: 'ไม่พิมพ์ราคาซ้ำในโค้ด (ราคาอยู่ที่ data/menu.csv ที่เดียว)',
    run: () => {
      const src = ['tools/quote/pricing.ts', 'tools/quote/cli.ts'].map(read).join('\n')
      const hard = [55, 65, 75, 85, 90, 95, 69, 79, 120].filter((p) => new RegExp(`\\b${p}\\b`).test(src))
      return { ok: hard.length === 0, hint: `โค้ดมีตัวเลขราคา ${hard.join(', ')} — ให้อ่านจาก data/menu.csv` }
    },
  },
  {
    part: 'win', name: 'ไม่มีการคิด VAT',
    run: () => ({ ok: !/vat|ภาษีมูลค่าเพิ่ม\s*[0-9]|\*\s*1\.07|0\.07/i.test(read('tools/quote/pricing.ts')), hint: 'พบการคิด VAT ใน pricing.ts — ร้านยังไม่ให้คิด' }),
  },
  {
    part: 'break', name: 'อ่านเมนูจาก Excel ของร้านได้ (ราคาแบบ ฿75.-, 85 บาท, 65.00, มีช่องว่าง, มีแถวว่าง)',
    run: () => {
      const r = run('npm', ['run', 'menu', '--silent', '--', 'data/เมนู-จากร้าน.xlsx', '/tmp/cafe-check-menu.csv'])
      if (!r.ok) return { ok: false, hint: r.out.split('\n')[0] }
      const got = readFileSync('/tmp/cafe-check-menu.csv', 'utf8'); rmSync('/tmp/cafe-check-menu.csv', { force: true })
      return { ok: got === read('tools/menu/expected-menu.csv'), hint: 'ได้ไฟล์แต่เนื้อไม่ตรงกับ tools/menu/expected-menu.csv (12 รายการ ราคาตรงกัน)' }
    },
  },
  {
    part: 'break', name: 'ราคาที่ไม่ใช่ตัวเลขจริง ๆ (เช่น "ประมาณ 80") ยังต้องหยุดและบอกแถว',
    run: () => {
      const r = run('npx', ['--no-install', 'tsx', '-e', "import('./tools/menu/parse.ts').then(m=>{try{m.parsePrice('ประมาณ 80',9);console.log('NOERR')}catch(e){console.log(e.message)}})"])
      return { ok: /แถว 9/.test(r.out) && !/NOERR/.test(r.out), hint: `parsePrice('ประมาณ 80') ควร error ที่แถว 9 แต่ได้: ${r.out.trim().slice(0, 80)}` }
    },
  },
  {
    part: 'break', name: 'เพิ่ม test ให้กรณีใหม่แล้ว (จำนวน test ใน tools/menu มากกว่าเดิม 3)',
    run: () => {
      const n = walk('tools/menu').filter((p) => p.endsWith('.test.ts')).map(read).join('\n').match(/\btest\(/g)?.length ?? 0
      return { ok: n > 3, hint: `มี test ${n} ข้อ ต้องเพิ่มอย่างน้อย 1 ข้อสำหรับรูปแบบราคาใหม่` }
    },
  },
  { part: 'break', name: 'ไฟล์ Excel ของร้านไม่ถูกแก้ (ลายนิ้วมือไฟล์ตรงกับที่ร้านส่งมา)', run: () => ({ ok: createHash('sha256').update(readFileSync('data/เมนู-จากร้าน.xlsx')).digest('hex') === 'e4343810b9cc0a6c3c5c56df18bb1d151ae57f7b787b97b4d2e5d2e2cecbf896', hint: 'ไฟล์ data/เมนู-จากร้าน.xlsx ถูกแก้ — ต้องคืนไฟล์เดิมจากที่ร้านส่งมา ห้ามแก้ไฟล์ต้นทางของร้าน' }) },
]
