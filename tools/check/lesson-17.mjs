// ตัวตรวจบท 17: caption IG/TikTok ด้วย `claude -p` + JSON schema (ใช้ claude จำลอง tools/fakes/claude — ไม่เรียกโมเดลจริง ไม่ใช้เงิน)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exists, read, run, walk, root } from './lib.mjs'

const FAKE = resolve(root, 'tools/fakes/claude')
const seasonal = () => JSON.parse(read('data/seasonal.json') || '{"items":[]}')
const hasCli = () => exists('tools/caption/cli.ts') && exists('tools/caption/validate.ts')
const NOCLI = { ok: false, hint: 'ต้องมี tools/caption/cli.ts และ tools/caption/validate.ts ตาม briefs/caption.md' }
const thai = /[ก-๙]/

// ตัวตรวจกติกาของเราเอง (อิสระจาก validate.ts ของผู้เรียน)
export function valid(data, s) {
  const e = []
  const caps = data?.captions
  if (!Array.isArray(caps) || caps.length !== 3) return [`ต้องมี caption 3 อัน (ได้ ${caps?.length ?? 'ไม่มี'})`]
  const plats = caps.map((c) => c.platform)
  if (!plats.includes('instagram') || !plats.includes('tiktok')) e.push('ต้องมีทั้ง instagram และ tiktok')
  const prices = new Set(s.items.map((i) => i.price))
  caps.forEach((c, i) => {
    if (!['instagram', 'tiktok'].includes(c.platform)) e.push(`#${i + 1} platform แปลก`)
    const t = c.text ?? ''
    if (t.length < 20 || t.length > 200) e.push(`#${i + 1} ความยาว ${t.length}`)
    if (!thai.test(t)) e.push(`#${i + 1} ไม่มีภาษาไทย`)
    if (!s.items.some((it) => t.includes(it.name))) e.push(`#${i + 1} ไม่พูดถึงเมนูประจำฤดู`)
    for (const m of t.matchAll(/(\d[\d,]*)\s*(?:บาท|฿)/g)) if (!prices.has(Number(m[1].replace(/,/g, '')))) e.push(`#${i + 1} ราคา ${m[1]} ไม่ตรงไฟล์`)
    const h = c.hashtags
    if (!Array.isArray(h) || h.length < 3 || h.length > 8 || h.some((x) => typeof x !== 'string' || !x.startsWith('#') || /\s/.test(x))) e.push(`#${i + 1} hashtags ไม่ถูก`)
    if (/รักษา|ลดน้ำหนัก|ดีต่อสุขภาพ/.test(t)) e.push(`#${i + 1} อ้างสุขภาพ`)
  })
  return e
}

function cli(args = [], { mode = 'ok', env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cafe-cap-'))
  const log = join(dir, 'calls.jsonl'), out = join(dir, 'out', 'captions.json')
  const r = spawnSync('node', ['--import', 'tsx', 'tools/caption/cli.ts', '--out', out, ...args], {
    cwd: root, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, ANTHROPIC_API_KEY: '', CLAUDE_BIN: FAKE, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log, ...env },
  })
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const res = { status: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}`, calls, out, hasOut: existsSync(out), data: existsSync(out) ? (() => { try { return JSON.parse(readFileSync(out, 'utf8')) } catch { return null } })() : null, dir }
  return res
}
const done = (r) => rmSync(r.dir, { recursive: true, force: true })
const noStack = (t) => !/\n\s+at .*\(|node:internal|TypeError:|ReferenceError:|ERR_/.test(t)

export const skipOnTag = (c) => c.name.startsWith('ผลจริงจาก claude')

export const checks = [
  {
    part: 'win', name: 'เครื่องมือ caption: เรียก claude -p แบบอาร์เรย์ พร้อม --output-format json และ --json-schema (schema ต้องเป็น JSON ที่ parse ได้ และระบุ captions) · ได้ caption 3 อันผ่านกติกา',
    run: () => {
      if (!hasCli()) return NOCLI
      const r = cli(); try {
        if (r.status !== 0) return { ok: false, hint: `exit ${r.status}: ${r.text.slice(0, 200)}` }
        const c = r.calls[0]; if (!c) return { ok: false, hint: 'ไม่ได้เรียก claude ผ่าน CLAUDE_BIN (ต้องอ่าน env CLAUDE_BIN, ค่าเริ่มต้น claude)' }
        const a = c.args
        const okArgs = a[0] === '-p' && a.includes('--output-format') && a[a.indexOf('--output-format') + 1] === 'json' && a.includes('--json-schema')
        let schema = null; try { schema = JSON.parse(a[a.indexOf('--json-schema') + 1]) } catch { /* ว่าง */ }
        const names = seasonal().items.every((i) => c.prompt.includes(i.name))
        const errs = r.data ? valid(r.data, seasonal()) : ['ไม่มีไฟล์ผลลัพธ์/อ่านไม่ได้']
        return { ok: okArgs && !!schema?.properties?.captions && names && !errs.length,
          hint: `args ถูก=${okArgs} · schema มี captions=${!!schema?.properties?.captions} · prompt มีชื่อเมนูครบ=${names} · ผล: ${errs.join('; ') || 'ผ่านกติกา'}` }
      } finally { done(r) }
    },
  },
  {
    part: 'win', name: 'test ของ tools/caption/ (validateCaptions) มีและผ่าน',
    run: () => {
      const tests = walk('tools/caption').filter((f) => f.endsWith('.test.ts'))
      if (!tests.length) return { ok: false, hint: 'ยังไม่มีไฟล์ test ใน tools/caption/' }
      const r = run('node', ['--import', 'tsx', '--test', ...tests])
      return { ok: r.ok, hint: r.ok ? '' : r.out.slice(-400) }
    },
  },
  {
    part: 'win', name: 'ผลจริงจาก claude -p ของคุณ: out/captions.json มี 3 caption ผ่านกติกา',
    run: () => {
      if (!exists('out/captions.json')) return { ok: false, hint: 'ยังไม่มี out/captions.json — รัน node --import tsx tools/caption/cli.ts ด้วยล็อกอินของคุณหนึ่งครั้ง' }
      let d; try { d = JSON.parse(read('out/captions.json')) } catch { return { ok: false, hint: 'out/captions.json ไม่ใช่ JSON' } }
      const e = valid(d, seasonal())
      return { ok: !e.length, hint: e.join('; ') }
    },
  },
  // ---- ลองพัง ----
  {
    part: 'break', name: 'โมเดลตอบผิดกติกาครั้งแรก → ลองใหม่ 1 ครั้งโดย prompt บอกข้อที่ผิด → สำเร็จด้วยผลที่ถูก (เรียก claude 2 ครั้ง)',
    run: () => {
      if (!hasCli()) return NOCLI
      const r = cli([], { mode: 'bad_then_ok' }); try {
        const errs = r.data ? valid(r.data, seasonal()) : ['ไม่มีไฟล์']
        const longer = r.calls.length === 2 && r.calls[1].prompt.length > r.calls[0].prompt.length
        return { ok: r.status === 0 && r.calls.length === 2 && longer && !errs.length, hint: `exit ${r.status} · เรียก ${r.calls.length} ครั้ง (ต้อง 2) · prompt รอบสองยาวกว่า(มีข้อที่ผิด)=${longer} · ${errs.join('; ')}` }
      } finally { done(r) }
    },
  },
  {
    part: 'break', name: 'โมเดลผิดทั้งสองครั้ง หรือกล้าเขียนราคาที่ไม่มีในเมนู → ไม่เขียนไฟล์ผลลัพธ์ · exit 1 · ข้อความไทยบอกข้อที่ผิด · ลองใหม่แค่ 1 ครั้ง',
    run: () => {
      if (!hasCli()) return NOCLI
      const out = []
      for (const mode of ['always_bad', 'wrong_price']) {
        const r = cli([], { mode })
        out.push(`${mode}: exit ${r.status} เรียก ${r.calls.length} ครั้ง ไฟล์=${r.hasOut} ไทย=${thai.test(r.text)}`)
        const ok = r.status === 1 && !r.hasOut && r.calls.length === 2 && thai.test(r.text) && noStack(r.text)
        done(r); if (!ok) return { ok: false, hint: out.join(' · ') }
      }
      return { ok: true, hint: out.join(' · ') }
    },
  },
  {
    part: 'break', name: 'ยังไม่ได้ล็อกอิน / claude พัง / ตอบไม่ใช่ JSON → exit ไม่ใช่ 0 · ไม่เขียนไฟล์ · ข้อความไทยบอกให้ /login (ไม่โชว์ stack trace)',
    run: () => {
      if (!hasCli()) return NOCLI
      const a = cli([], { mode: 'login' }), b = cli([], { mode: 'garbage' }); try {
        const c = cli([], { env: { CLAUDE_BIN: '/nonexistent/claude' } })
        const okA = a.status === 2 && !a.hasOut && /\/login/.test(a.text) && thai.test(a.text) && noStack(a.text)
        const okB = b.status !== 0 && !b.hasOut && thai.test(b.text) && noStack(b.text)
        const okC = c.status !== 0 && !c.hasOut && thai.test(c.text) && noStack(c.text); done(c)
        return { ok: okA && okB && okC, hint: `ไม่ได้ล็อกอิน: exit ${a.status} /login=${/\/login/.test(a.text)} ไทย=${thai.test(a.text)} stack=${!noStack(a.text)} · ตอบขยะ: exit ${b.status} ไฟล์=${b.hasOut} · หา claude ไม่เจอ: exit ${c.status} ${okC ? 'ok' : c.text.slice(0, 120)}` }
      } finally { done(a); done(b) }
    },
  },
  // ---- ต่อยอด: ส่วนตัว vs ให้บริการ + API key ----
  {
    part: 'extra', name: 'checkAuth(env): ไม่มี key = login · key รูปแบบ sk-ant-… = api-key ok · key รูปแบบผิด = api-key ไม่ ok · ค่าว่างนับเป็นไม่มี',
    run: () => {
      if (!exists('tools/caption/auth.ts')) return { ok: false, hint: 'ต้องมี tools/caption/auth.ts ส่งออก checkAuth' }
      const code = `import { checkAuth } from './tools/caption/auth.ts'
const r = [checkAuth({}), checkAuth({ ANTHROPIC_API_KEY: '' }), checkAuth({ ANTHROPIC_API_KEY: 'sk-ant-FAKE-0123456789abcdefghij' }), checkAuth({ ANTHROPIC_API_KEY: 'hello' }), checkAuth({ ANTHROPIC_API_KEY: 'sk-ant-short' })]
console.log(JSON.stringify(r))`
      const td = mkdtempSync(join(tmpdir(), 'cafe-auth-')), f = join(td, 'x.mts'); writeFileSync(f, code.replace("'./tools/caption/auth.ts'", `'${resolve(root, 'tools/caption/auth.ts')}'`))
      const r = run('node', ['--import', 'tsx', f]); rmSync(td, { recursive: true, force: true })
      if (!r.ok) return { ok: false, hint: r.out.slice(0, 300) }
      let v; try { v = JSON.parse(r.out.trim().split('\n').pop()) } catch { return { ok: false, hint: `อ่านผลไม่ได้: ${r.out.slice(0, 200)}` } }
      const [a, b, c, d, e] = v
      const ok = a.mode === 'login' && a.keyOk === null && b.mode === 'login' && c.mode === 'api-key' && c.keyOk === true && d.mode === 'api-key' && d.keyOk === false && e.keyOk === false
      return { ok, hint: JSON.stringify(v) }
    },
  },
  {
    part: 'extra', name: '--auth-check บอกโหมดเป็นภาษาไทย · ไม่พิมพ์ key (เต็มหรือบางส่วน) · key รูปแบบผิด exit 1',
    run: () => {
      if (!hasCli() || !exists('tools/caption/auth.ts')) return NOCLI
      const key = 'sk-ant-FAKE-ZZ9Q8X7W6V5U4T3S2R1P'
      const leak = (t) => t.includes(key) || t.includes('ZZ9Q8X7W') || t.includes('3S2R1P')
      const a = cli(['--auth-check'], { env: { ANTHROPIC_API_KEY: key } }), b = cli(['--auth-check'], { env: { ANTHROPIC_API_KEY: 'sk-bad-FAKE' } }), c = cli(['--auth-check'])
      const ok = a.status === 0 && thai.test(a.text) && /api-key/i.test(a.text) && !leak(a.text) && a.calls.length === 0 && b.status === 1 && thai.test(b.text) && !b.text.includes('sk-bad-FAKE') && c.status === 0 && /login/i.test(c.text)
      const hint = `key ถูก: exit ${a.status} รั่ว=${leak(a.text)} เรียก claude=${a.calls.length} · key ผิด: exit ${b.status} · ไม่มี key: exit ${c.status} "${c.text.trim().slice(0, 80)}"`
      done(a); done(b); done(c); return { ok, hint }
    },
  },
  {
    part: 'extra', name: 'เอกสาร + ความลับ: .env.example มี ANTHROPIC_API_KEY ค่าว่าง · docs/personal-vs-service.md ครบ · ไม่มี key จริงในไฟล์ · ไม่เรียกเครื่องมือในข้อความที่ร้านเห็นว่า "Claude Code"',
    run: () => {
      const env = read('.env.example'), doc = read('docs/personal-vs-service.md')
      const envOk = /^ANTHROPIC_API_KEY=\s*$/m.test(env)
      const docOk = ['ส่วนตัว', 'ให้บริการ', 'API key', 'https://code.claude.com/docs/en/legal-and-compliance'].every((w) => doc.includes(w))
      const files = [...walk('tools'), ...walk('docs'), '.env.example', ...walk('briefs')].filter((f) => !/node_modules|fixtures|\.mjs$/.test(f) || /tools\/caption/.test(f))
      const leaks = files.filter((f) => /sk-ant-(?!FAKE)[A-Za-z0-9_-]{20,}/.test(read(f)))
      const src = walk('tools/caption').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      const named = src.filter((f) => /['"`][^'"`\n]*Claude Code[^'"`\n]*['"`]/.test(read(f)))
      return { ok: envOk && docOk && !leaks.length && !named.length, hint: `.env.example ok=${envOk} · doc ครบ=${docOk} · ไฟล์ที่มี key จริง=${leaks.join(',') || 'ไม่มี'} · ข้อความที่เรียกว่า Claude Code=${named.join(',') || 'ไม่มี'}` }
    },
  },
]
