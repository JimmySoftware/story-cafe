import { exists, read, run } from './lib.mjs'

// ข้อที่ตรวจงานของผู้เรียนเอง: ข้ามเมื่อรันบน tag lesson-00 ตรง ๆ (ดู onTag ใน lib.mjs)
export const skipOnTag = () => true

export const checks = [
  { part: 'win', name: 'มีไฟล์ .cafe/ready.md (ผลเช็กเครื่อง)', run: () => ({ ok: exists('.cafe/ready.md'), hint: 'ยังไม่มีไฟล์ .cafe/ready.md — ให้ Claude เช็กเครื่องแล้วเขียนผลลงไฟล์นี้' }) },
  {
    part: 'win', name: 'รายงานครบ 3 โปรแกรม: node, git, claude',
    run: () => {
      const t = read('.cafe/ready.md').toLowerCase()
      const ok = ['node', 'git', 'claude'].every((k) => t.includes(k))
      return { ok, hint: 'ในไฟล์ต้องมีบรรทัดของ node, git และ claude อย่างละบรรทัด' }
    },
  },
  {
    part: 'win', name: 'ทุกบรรทัดมีเครื่องหมาย ✓ หรือ ✗ พร้อมเวอร์ชัน',
    run: () => {
      const t = read('.cafe/ready.md')
      const rows = t.split('\n').filter((l) => /(node|git|claude)/i.test(l) && /[✓✗]/.test(l))
      const ok = rows.length >= 3 && rows.every((l) => /\d+\.\d+/.test(l) || l.includes('✗'))
      return { ok, hint: 'แต่ละบรรทัดต้องบอกเวอร์ชัน (เช่น 22.23.3) หรือเป็น ✗ ถ้าไม่พบ' }
    },
  },
  {
    part: 'win', name: 'node เป็นเวอร์ชัน 22 ขึ้นไป (✓) หรือบอกวิธีติดตั้งถ้าไม่ใช่',
    run: () => {
      const t = read('.cafe/ready.md')
      const line = t.split('\n').find((l) => /node/i.test(l) && /\d+\.\d+/.test(l)) ?? ''
      const major = Number((line.match(/(\d+)\.\d+/) ?? [])[1] ?? 0)
      const ok = major >= 22 ? /✓/.test(line) : /✗/.test(line) && /nodejs\.org/i.test(t)
      return { ok, hint: 'node ต่ำกว่า 22 ต้องเป็น ✗ และมีลิงก์ nodejs.org ให้ติดตั้ง' }
    },
  },
  {
    part: 'win', name: 'ผลตรงกับเครื่องจริง (git และ claude ที่ติดตั้งอยู่ต้องเป็น ✓)',
    run: () => {
      const rows = read('.cafe/ready.md').split('\n')
      const bad = []
      for (const p of ['git', 'claude']) {
        const real = run(p, ['--version']).ok
        const row = rows.find((l) => new RegExp(`\\b${p}\\b`, 'i').test(l) && /[✓✗]/.test(l)) ?? ''
        if (real && !/✓/.test(row)) bad.push(p)
      }
      return { ok: bad.length === 0, hint: `เครื่องนี้มี ${bad.join(', ')} อยู่แต่ในไฟล์เขียนว่า ✗ — ให้ Claude รัน ${bad[0]} --version จริงแล้วแก้` }
    },
  },
]
