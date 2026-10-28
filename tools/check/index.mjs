// npm run check -- <เลขบท> [--part win|break]
// พิมพ์ผ่าน/ตกเป็นภาษาไทย · exit 0 = ผ่านทุกข้อ · exit 1 = มีข้อที่ตก · --json = ผลเป็น JSON (ให้เครื่องมืออ่าน)
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { root, onTag } from './lib.mjs'

const args = process.argv.slice(2)
const num = args.find((a) => /^\d+$/.test(a))
const part = args.includes('--part') ? args[args.indexOf('--part') + 1] : null
const asJson = args.includes('--json')
if (num === undefined) {
  console.log('ใช้แบบนี้: npm run check -- <เลขบท>   เช่น npm run check -- 1')
  process.exit(2)
}
const nn = String(num).padStart(2, '0')
const dir = process.env.CAFE_CHECK_DIR ?? join(root, 'tools/check') // CAFE_CHECK_DIR: ใช้ตัวตรวจจากที่อื่น (ให้เครื่องมือตรวจซ้ำโดยไม่แตะไฟล์ในโฟลเดอร์ผู้เรียน)
const file = join(dir, `lesson-${nn}.mjs`)
if (!existsSync(file)) {
  console.log(`ยังไม่มีตัวตรวจของบทที่ ${Number(num)} ในโฟลเดอร์นี้ (ตัวตรวจมากับสูตรของบทนั้น)`)
  process.exit(2)
}
const mod = await import(pathToFileURL(file).href)
const results = []
const tagged = onTag()
for (const c of mod.checks) {
  if (part && c.part !== part) continue
  let r
  if (tagged && mod.skipOnTag?.(c)) { results.push({ part: c.part, name: c.name, ok: false, skip: true, hint: 'ข้าม (เป็นงานของผู้เรียน)' }); continue }
  try { r = await c.run() } catch (e) { r = { ok: false, hint: `ตัวตรวจทำงานไม่สำเร็จ: ${e.message}` } }
  results.push({ part: c.part, name: c.name, ok: !!r.ok, skip: !!r.skip, hint: r.hint ?? '' })
}
if (asJson) console.log(JSON.stringify(results))
else {
  console.log(`ตรวจบทที่ ${Number(num)}${part ? ` (ส่วน ${{ win: 'ผลแรก', break: 'ลองทดสอบหนัก ๆ', extra: 'ต่อยอด', ...mod.partNames }[part] ?? part})` : ''}`)
  for (const r of results) {
    const mark = r.skip ? '… ' : r.ok ? '✓ ' : '✗ '
    console.log(`${mark}${r.name}${!r.ok && !r.skip && r.hint ? `\n    → ${r.hint}` : ''}${r.skip ? `\n    → ${r.hint}` : ''}`)
  }
  const bad = results.filter((r) => !r.ok && !r.skip).length
  if (results.length > 0 && results.every((r) => r.skip)) console.log(`\nยังไม่ได้ตรวจสักข้อ: ทุกข้อถูกข้าม เพราะโฟลเดอร์นี้อยู่บน tag เฉลย lesson-${nn} ตรง ๆ\nถ้านี่คืองานของคุณเอง ให้รันใหม่ด้วย CAFE_AS_LEARNER=1 npm run check -- ${Number(num)}`)
  else console.log(bad === 0 ? '\nผ่านทั้งหมด 🎉' : `\nตก ${bad} ข้อ — ก๊อปข้อความด้านบนไปบอก Claude ว่าให้แก้ข้อที่ตก`)
}
process.exit(results.some((r) => !r.ok && !r.skip) ? 1 : 0)
