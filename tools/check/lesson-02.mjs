import { exists, read, lines, walk } from './lib.mjs'

const plan = () => read('docs/plan-preorder.md')
const nonEmpty = (p) => lines(p).filter((l) => l.trim()).length

export const checks = [
  { part: 'win', name: 'มีแผน docs/plan-preorder.md ยาว 15–45 บรรทัด (พอดีหนึ่งหน้าจอ อ่านจบจริง)', run: () => ({ ok: nonEmpty('docs/plan-preorder.md') >= 15 && lines('docs/plan-preorder.md').length <= 50, hint: `ตอนนี้ ${nonEmpty('docs/plan-preorder.md')} บรรทัด (ทั้งไฟล์ ${lines('docs/plan-preorder.md').length}) — แผนต้องสั้นพอดีหนึ่งหน้าจอ` }) },
  {
    part: 'win', name: 'แผนใช้กฎของร้านครบ: 6 แก้ว · 10 นาที · ดริป 2 แก้ว · 15 นาที · 30 นาที · จ่ายที่เคาน์เตอร์',
    run: () => {
      const t = plan()
      const miss = []
      if (!/6\s*แก้ว/.test(t)) miss.push('6 แก้วต่อช่อง')
      if (!/10\s*นาที/.test(t)) miss.push('ช่อง 10 นาที')
      if (!/ดริป[^\n]{0,80}\b2\b|\b2\s*แก้ว[^\n]{0,80}ดริป/.test(t)) miss.push('ดริป = 2 แก้ว')
      if (!/15\s*นาที/.test(t)) miss.push('สั่งล่วงหน้า 15 นาที')
      if (!/30\s*นาที/.test(t)) miss.push('ยกเลิกก่อน 30 นาที')
      if (!/เคาน์เตอร์/.test(t)) miss.push('จ่ายที่เคาน์เตอร์')
      return { ok: miss.length === 0, hint: `แผนยังไม่พูดถึง: ${miss.join(', ')}` }
    },
  },
  {
    part: 'win', name: 'มีหัวข้อคำถามที่ brief ยังไม่ตอบ อย่างน้อย 2 ข้อ (ไม่เดาเอง)',
    run: () => {
      const ls = lines('docs/plan-preorder.md')
      const heads = ls.map((l, i) => (/^#{1,4}\s.*(คำถาม|ยังไม่ได้ตัดสินใจ|ยังไม่แน่ใจ)/.test(l) ? i : -1)).filter((i) => i >= 0)
      if (!heads.length) return { ok: false, hint: 'ไม่พบหัวข้อ "คำถามที่ brief ยังไม่ตอบ"' }
      const count = (i) => {
        const level = ls[i].match(/^#+/)[0].length; let n = 0
        for (const l of ls.slice(i + 1)) { const h = l.match(/^(#{1,4})\s/); if (h && h[1].length <= level) break; if (/^\s*([-*]|\d+[.)])\s+\S/.test(l)) n++ }
        return n
      }
      return { ok: heads.some((i) => count(i) >= 2), hint: 'ใต้หัวข้อคำถามต้องมีรายการอย่างน้อย 2 ข้อ' }
    },
  },
  {
    part: 'win', name: 'มีแผนการทดสอบ (test ที่ตัดสินว่าเสร็จ)',
    run: () => ({ ok: /test|ทดสอบ/i.test(plan()), hint: 'แผนยังไม่บอกว่าจะใช้ test อะไรตัดสินว่าเสร็จ' }),
  },
  {
    part: 'win', name: 'ยังไม่มีโค้ดระบบ (บทนี้ทำแผนอย่างเดียว)',
    run: () => {
      const code = walk('.', ['node_modules', '.git', 'dist', '.cafe', 'fonts', 'tools']).filter((p) => /\.(js|mjs|ts|tsx|jsx|css|py|sql)$/.test(p))
      return { ok: code.length === 0, hint: `มีไฟล์โค้ดที่ไม่ควรมีในบทนี้: ${code.join(', ')}` }
    },
  },
  { part: 'break', name: 'มีแผนแบบกำกวม docs/plan-vague.md', run: () => ({ ok: nonEmpty('docs/plan-vague.md') >= 3, hint: 'ยังไม่มี docs/plan-vague.md' }) },
  {
    part: 'break', name: 'มีใบเทียบ docs/เทียบแผน.md ที่บอกว่าแผนกำกวมต้อง "เดา" อะไร',
    run: () => ({ ok: nonEmpty('docs/เทียบแผน.md') >= 5 && /เดา/.test(read('docs/เทียบแผน.md')), hint: 'ใบเทียบต้องมีอย่างน้อย 5 บรรทัดและใช้คำว่า "เดา" บอกว่าอะไรที่แผนกำกวมต้องเดา' }),
  },
]
