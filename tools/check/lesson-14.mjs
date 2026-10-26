import { exists, read, lines, run, walk } from './lib.mjs'
import { mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = 'tools/loyalty'
const fixture = (name) => new URL(`./fixtures/${name}/`, import.meta.url).pathname
const ownTests = () => (exists(dir) ? readdirSync(join(process.cwd(), dir)).filter((f) => f.endsWith('.test.ts') && f !== 'smoke.test.ts') : [])
const SRC = ['store.ts', 'promo.ts', 'points.ts', 'redeem.ts', 'index.ts']

// เอา test ของผู้เรียนไปลองกับโค้ดชุดอื่น (original = ที่ freelancer ส่งมา · fixed = เฉลย) → { pass, fail }
function testsAgainst(which) {
  const tests = ownTests()
  if (!tests.length) return { pass: 0, fail: 0, noTests: true }
  const tmp = mkdtempSync(join(tmpdir(), 'cafe-loyalty-'))
  try {
    cpSync(join(process.cwd(), dir), tmp, { recursive: true })
    for (const f of SRC) cpSync(join(fixture(`loyalty-${which}`), f), join(tmp, f))
    const r = run('node', ['--import', 'tsx', '--test', ...tests.map((t) => join(tmp, t))], { cwd: process.cwd() })
    const g = (k) => Number(r.out.match(new RegExp(`^# ${k} (\\d+)`, 'm'))?.[1] ?? 0)
    return { pass: g('pass'), fail: g('fail'), out: r.out }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}
const probe = () => {
  const r = run('node', ['--import', 'tsx', 'tools/check/loyalty-probe.mjs'])
  try { return JSON.parse(r.out.trim().split('\n').pop()) } catch { return { error: r.out.slice(0, 300) } }
}
const bug = (k, label) => ({
  part: 'break', name: `บั๊ก ${k}: ${label} — แก้แล้ว`,
  run: () => { const p = probe(); return { ok: p[k] === true, hint: p.error ? `โค้ดโหลดไม่ได้: ${p.error}` : `ผลที่ได้ ${JSON.stringify(p.details?.[k])}` } },
})

export const checks = [
  {
    part: 'win', name: 'docs/loyalty-summary.md: อธิบายโครงไฟล์ครบ 5 ไฟล์ และเทียบ "README อ้างว่า" กับ "โค้ดทำจริง"',
    run: () => {
      const t = read('docs/loyalty-summary.md'); if (!t) return { ok: false, hint: 'ยังไม่มี docs/loyalty-summary.md' }
      const miss = []
      for (const f of SRC) if (!t.includes(f)) miss.push(f)
      if (!/README/.test(t)) miss.push('คำว่า README (เทียบคำอ้าง)')
      if (!/(ไม่ตรง|ขัดแย้ง|ต่างจาก|ไม่เป็นจริง|ไม่จริง|โกหก|คลาดเคลื่อน)/.test(t)) miss.push('ข้อความที่บอกว่า README ไม่ตรงโค้ด')
      return { ok: miss.length === 0 && lines('docs/loyalty-summary.md').filter((l) => l.trim()).length >= 15, hint: `สรุปยังขาด: ${miss.join(', ') || 'ยาวไม่ถึง 15 บรรทัด'}` }
    },
  },
  {
    part: 'win', name: 'มีไฟล์ test ของผู้เรียน (นอกจาก smoke.test.ts) ใน tools/loyalty/ ที่ import จาก ./index.ts',
    run: () => { const t = ownTests(); return { ok: t.length > 0 && t.every((f) => /from ['"]\.\/index\.ts['"]/.test(read(`${dir}/${f}`))), hint: 'ต้องมี tools/loyalty/*.test.ts อย่างน้อย 1 ไฟล์ และ import จาก ./index.ts เท่านั้น' } },
  },
  {
    part: 'win', name: 'test ของผู้เรียน "แดงก่อนแก้": รันกับโค้ดต้นฉบับของ freelancer แล้วล้มอย่างน้อย 4 ข้อ',
    run: () => { const r = testsAgainst('original'); return { ok: r.fail >= 4, hint: r.noTests ? 'ยังไม่มี test' : `ล้ม ${r.fail} ข้อ ผ่าน ${r.pass} ข้อ (ต้องล้มอย่างน้อย 4 — ครอบกฎ 4 ข้อ)` } },
  },
  {
    part: 'win', name: 'test ของผู้เรียน "ถูกต้อง": รันกับโค้ดเฉลยแล้วผ่านทุกข้อ (ล้มเพราะโค้ดผิด ไม่ใช่เพราะ test เขียนผิด)',
    run: () => { const r = testsAgainst('fixed'); return { ok: r.fail === 0 && r.pass > 0, hint: r.noTests ? 'ยังไม่มี test' : `กับเฉลย: ผ่าน ${r.pass} ล้ม ${r.fail}${r.fail ? ' — test บางข้อเขียนผิดกฎ: ' + (r.out.match(/not ok .*/g) ?? []).slice(0, 3).join(' | ') : ''}` } },
  },
  // ---- ลองพัง: แก้ 4 บั๊ก ----
  bug('A', 'ปัดเศษ (ต้องปัดลง 25 บาท = 1 แต้ม)'),
  bug('B', 'เขตเวลา (เสาร์ตามเวลาไทย ไม่ใช่ UTC)'),
  bug('C', 'แต้มติดลบ (ใช้ได้ไม่เกินยอดคงเหลือ · จำนวนเต็ม ≥ 1)'),
  bug('D', 'ใช้แต้มของคนอื่น (ต้องเป็นของคนที่ล็อกอินเท่านั้น)'),
  {
    part: 'break', name: 'test ของผู้เรียนผ่านบนโค้ดที่แก้แล้ว และ npm test ผ่านทั้งหมด · โค้ดยังส่งออกสัญญาเดิม',
    run: () => { const t = run('npm', ['test', '--silent']); const p = probe(); return { ok: t.ok && !p.error, hint: `npm test=${t.ok}${t.ok ? '' : ': ' + t.out.split('\n').filter((l) => /not ok|fail/.test(l)).slice(0, 3).join(' | ')} · โหลดสัญญา=${!p.error}` } },
  },
  {
    part: 'break', name: 'docs/loyalty-summary.md อัปเดตสถานะหลังแก้ (บอกว่าบั๊กทั้ง 4 แก้แล้ว)',
    run: () => { const t = read('docs/loyalty-summary.md'); return { ok: /แก้แล้ว|ปิดแล้ว|แก้เสร็จ|fixed/i.test(t) && /(ปัด|round|floor)/i.test(t) && /(UTC|เขตเวลา|timezone)/i.test(t) && /(ติดลบ|negative)/i.test(t) && /(customerId|ของคนอื่น|คนอื่น)/.test(t), hint: 'สรุปต้องมีสถานะของบั๊กทั้ง 4 (ปัดเศษ · เขตเวลา · ติดลบ · แต้มคนอื่น)' } },
  },
]
