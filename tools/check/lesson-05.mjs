import { exists, read, run } from './lib.mjs'

const git = (...a) => run('git', a)
const tracked = () => git('ls-files').out.split('\n').filter(Boolean)

// ข้อที่ตรวจงานของผู้เรียนเอง: ข้ามเมื่อรันบน tag lesson-05 ตรง ๆ (ดู onTag ใน lib.mjs)
export const skipOnTag = (c) => c.part === 'break' || /^(มี git repo|\.env \(ความลับ\)|ตั้งชื่อผู้ commit)/.test(c.name)

export const checks = [
  { part: 'win', name: 'มี git repo (branch main) และ commit อย่างน้อย 1 ครั้ง', run: () => ({ ok: exists('.git') && git('rev-parse', '--abbrev-ref', 'HEAD').out.trim() === 'main' && Number(git('rev-list', '--count', 'HEAD').out.trim() || 0) >= 1, hint: 'ยังไม่มี repo, ไม่ได้ชื่อ branch main หรือยังไม่เคย commit' }) },
  {
    part: 'win', name: '.env (ความลับ) และ node_modules ไม่ได้เข้า git',
    run: () => {
      const t = tracked()
      const bad = t.filter((f) => f === '.env' || f.startsWith('node_modules/') || f.startsWith('out/') || f.startsWith('.cafe/'))
      return { ok: t.length > 0 && bad.length === 0, hint: bad.length ? `ไฟล์ที่ไม่ควรเข้า git: ${bad.slice(0, 5).join(', ')}` : 'ยังไม่มีไฟล์ใน git เลย' }
    },
  },
  { part: 'win', name: 'กฎความปลอดภัยของทีม .claude/settings.json เข้า git (ไฟล์ส่วนตัวอื่นใน .claude/ ไม่เข้า)', run: () => { const t = tracked(); return { ok: t.includes('.claude/settings.json') && !t.some((f) => f.startsWith('.claude/') && f !== '.claude/settings.json'), hint: '.claude/settings.json ต้องเข้า git (เป็นกฎที่ทีมใช้ร่วมกัน) และห้ามมีไฟล์อื่นใน .claude/ ที่เป็นของส่วนตัว' } } },
  { part: 'win', name: '.env.example เข้า git (มีชื่อตัวแปร ไม่มีค่า)', run: () => ({ ok: tracked().includes('.env.example'), hint: '.env.example ต้องเข้า git เพื่อให้คนอื่นรู้ว่าต้องตั้งตัวแปรอะไร' }) },
  {
    part: 'win', name: '.gitignore กัน .env, node_modules และ out/',
    run: () => {
      const g = read('.gitignore'); const miss = ['.env', 'node_modules', 'out'].filter((k) => !new RegExp(`^/?${k.replace('.', '\\.')}(/|\\*)?\\s*$`, 'm').test(g))
      return { ok: miss.length === 0, hint: `.gitignore ยังไม่มี: ${miss.join(', ')}` }
    },
  },
  { part: 'win', name: 'ไฟล์งานสำคัญเข้า git ครบ (menu.txt, menu.html, data/menu.csv, tools/quote/pricing.ts)', run: () => { const t = tracked(); const miss = ['menu.txt', 'menu.html', 'data/menu.csv', 'tools/quote/pricing.ts', 'package.json'].filter((f) => !t.includes(f)); return { ok: miss.length === 0, hint: `ยังไม่ได้ commit: ${miss.join(', ')}` } } },
  { part: 'win', name: 'ตั้งชื่อผู้ commit เฉพาะ repo นี้ (ไม่ใช่ global) และ working tree สะอาด', run: () => ({ ok: git('config', '--local', 'user.name').out.trim() !== '' && git('status', '--porcelain').out.trim() === '', hint: 'ยังไม่ได้ตั้ง user.name ใน repo นี้ หรือมีไฟล์ที่ยังไม่ได้ commit/ignore' }) },
  { part: 'win', name: 'มี docs/git-first-commit.md อธิบายว่าไฟล์ไหนเข้า/ไม่เข้า เพราะอะไร', run: () => ({ ok: /\.env/.test(read('docs/git-first-commit.md')) && /node_modules/.test(read('docs/git-first-commit.md')) && read('docs/git-first-commit.md').split('\n').length >= 8, hint: 'ต้องมี docs/git-first-commit.md ที่พูดถึง .env และ node_modules' }) },
  {
    part: 'break', name: 'ย้อนด้วย revert: commit ที่ผิดยังอยู่ในประวัติ และมี commit ย้อนตามมา (ไม่ใช่ reset)',
    run: () => {
      // commit ที่แก้เป็น 750 ต้องยังอยู่ในประวัติ (ไม่ใช่ reset) และมี commit ถัดมาที่เอา 750 ออก = อย่างน้อย 2 commit ที่แตะบรรทัดนี้
      const touched = git('log', '-S750', '--format=%h', '--', 'menu.txt').out.trim().split('\n').filter(Boolean)
      return { ok: touched.length >= 2, hint: 'ประวัติต้องมี commit ที่แก้เป็น 750 อยู่ และมี commit ย้อน (revert) ตามมา — ถ้าใช้ reset ประวัติจะหาย' }
    },
  },
  { part: 'break', name: 'ราคาลาเต้ใน menu.txt กลับเป็น 75', run: () => ({ ok: /^- ลาเต้ 75 /m.test(read('menu.txt')), hint: 'บรรทัดลาเต้ใน menu.txt ต้องเป็น 75' }) },
  {
    part: 'later', name: 'ขึ้น GitHub แล้ว (remote origin + push)',
    run: () => { const u = git('remote', 'get-url', 'origin'); return { ok: u.ok, skip: !u.ok, hint: '[ตรวจหลังสมัคร GitHub] ยังไม่มี remote origin — ทำตามขั้นตอนที่ Claude เขียนไว้ตอนมีบัญชี' } },
  },
]
