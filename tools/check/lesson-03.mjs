import { exists, read } from './lib.mjs'

const settings = () => { try { return JSON.parse(read('.claude/settings.json')) } catch { return null } }
const deny = () => (settings()?.permissions?.deny ?? []).map(String)
const names = (t) => t.split('\n').map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]).filter(Boolean)

export const checks = [
  { part: 'win', name: 'มี .claude/settings.json ที่เป็น JSON ถูกต้อง', run: () => ({ ok: settings() !== null, hint: 'ไม่มีไฟล์ .claude/settings.json หรือ JSON เสีย' }) },
  {
    part: 'win', name: 'ห้ามอ่าน .env และ .env.* (Read deny)',
    run: () => {
      const d = deny()
      const ok = d.some((r) => /^Read\((\.\/|\*\*\/)?\.env\)$/.test(r)) && d.some((r) => /^Read\((\.\/|\*\*\/)?\.env\.\*+\)$/.test(r) || /^Read\((\.\/|\*\*\/)?\.env\*\)$/.test(r))
      return { ok, hint: 'ต้องมี Read(./.env) และ Read(./.env.*) ในรายการ deny' }
    },
  },
  { part: 'win', name: 'ห้ามอ่านโฟลเดอร์ secrets/', run: () => ({ ok: deny().some((r) => /^Read\((\.\/|\*\*\/)?secrets\/\*\*\)$/.test(r)), hint: 'ต้องมี Read(./secrets/**) ในรายการ deny' }) },
  { part: 'win', name: 'ถามก่อน push ขึ้น GitHub', run: () => ({ ok: (settings()?.permissions?.ask ?? []).some((r) => /^Bash\(git push/.test(String(r))), hint: 'ต้องมีกฎ ask สำหรับคำสั่ง git push ในรายการ ask' }) },
  {
    part: 'win', name: 'มี .env.example ชื่อตัวแปรครบ 3 ตัว ไม่มีค่าจริง',
    run: () => {
      const t = read('.env.example'); const n = names(t)
      const ok = ['SUPABASE_URL', 'STRIPE_TEST_KEY', 'LINE_CHANNEL_TOKEN'].every((k) => n.includes(k)) && !/FAKE|sk_|https?:/i.test(t.replace(/^#.*$/gm, ''))
      return { ok, hint: '.env.example ต้องมีชื่อตัวแปรทั้ง 3 ตัวและเว้นค่าว่าง' }
    },
  },
  { part: 'win', name: '.env เดิมไม่ถูกแก้', run: () => ({ ok: exists('.env') && /STRIPE_TEST_KEY=sk_test_FAKE_9f3a1c77d2b04e55a1c8e7/.test(read('.env')), hint: '.env ถูกแก้หรือหาย — ห้ามแตะไฟล์นี้' }) },
  {
    part: 'break', name: 'กันคำสั่ง shell ที่พิมพ์ .env ด้วย (รั้วชั้นสอง: cat / printenv)',
    run: () => {
      const d = deny().join(' ')
      return { ok: /Bash\([^)]*cat[^)]*\.env/.test(d) && /Bash\([^)]*printenv/.test(d), hint: 'ต้องมี Bash(cat …) ที่ชี้ .env และ Bash(printenv…) ในรายการ deny' }
    },
  },
]
