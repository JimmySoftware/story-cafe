// ตัวตรวจบท 18: โปสเตอร์เมนู PNG (โมเดลเขียนข้อความ → เครื่องมือกรอก template → ไฟล์ภาพ) + cache + เพดานค่าใช้จ่าย
// ใช้ claude จำลอง (tools/fakes/claude) ไม่เรียกโมเดลจริง · ใช้ Chromium ของ Playwright ตรวจภาพ
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { exists, read, run, walk, root } from './lib.mjs'

const FAKE = resolve(root, 'tools/fakes/claude')
const seasonal = () => JSON.parse(read('data/seasonal.json'))
const limits = () => JSON.parse(read('data/ai-limits.json'))
const hasCli = () => exists('tools/poster/cli.ts')
const NOCLI = { ok: false, hint: 'ต้องมี tools/poster/cli.ts ตาม briefs/poster.md' }
const thai = /[ก-๙]/
const noStack = (t) => !/\n\s+at .*\(|node:internal|TypeError:|ReferenceError:|ERR_/.test(t)

function cli(args = [], { mode = 'ok', env = {}, dir } = {}) {
  const d = dir ?? mkdtempSync(join(tmpdir(), 'cafe-poster-'))
  const log = join(d, 'calls.jsonl'), out = join(d, 'out', 'poster.png'), state = join(d, 'state')
  const r = spawnSync('node', ['--import', 'tsx', 'tools/poster/cli.ts', '--out', out, ...args], {
    cwd: root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, ANTHROPIC_API_KEY: '', CLAUDE_BIN: FAKE, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log, CAFE_STATE_DIR: state, ...env },
  })
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const spend = existsSync(join(state, 'spend.json')) ? JSON.parse(readFileSync(join(state, 'spend.json'), 'utf8')) : null
  return { status: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}`, calls, out, html: out.replace(/\.png$/, '.html'), hasOut: existsSync(out), spend, dir: d, state }
}
const done = (r) => rmSync(r.dir, { recursive: true, force: true })

// อ่านขนาดและพิกเซลของ PNG (8 บิต RGB/RGBA ไม่ interlace) → { w, h, px(x,y) }
function png(file) {
  const b = readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) return null
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], type = b[25]
  if (depth !== 8 || ![2, 6].includes(type) || b[28] !== 0) return { w, h, px: null }
  const ch = type === 6 ? 4 : 3; let o = 8; const idat = []
  while (o < b.length) { const len = b.readUInt32BE(o), t = b.toString('latin1', o + 4, o + 8); if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, img = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? img[y * stride + x - ch] : 0, up = y ? img[(y - 1) * stride + x] : 0, c = x >= ch && y ? img[(y - 1) * stride + x - ch] : 0
      let v = src[x]
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c }
      img[y * stride + x] = v & 255
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * ch; return (img[i] << 16) | (img[i + 1] << 8) | img[i + 2] } }
}

async function domCheck(htmlFile) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } })
  try {
    await page.goto(pathToFileURL(htmlFile).href); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200)
    return await page.evaluate(() => {
      const bad = []; const vw = 1080, vh = 1350
      for (const el of document.querySelectorAll('#headline, #subline, #items li, #footer')) {
        const r = el.getBoundingClientRect()
        if (r.left < -1 || r.right > vw + 1 || r.bottom > vh + 1 || el.scrollWidth > el.clientWidth + 2) bad.push(`${el.id || el.tagName}: ${Math.round(r.left)}..${Math.round(r.right)} x ..${Math.round(r.bottom)}`)
      }
      return { bad, kanit: document.fonts.check('600 40px Kanit'), items: [...document.querySelectorAll('#items li')].length, text: document.body.innerText }
    })
  } finally { await browser.close() }
}

export const skipOnTag = (c) => c.name.startsWith('ผลจริง')

export const checks = [
  {
    part: 'win', name: 'เครื่องมือโปสเตอร์: ได้ PNG 1080×1350 จากข้อความที่โมเดลเขียน · ชื่อและราคาเมนูตรงไฟล์ (ราคามาจาก data/seasonal.json เท่านั้น) · เรียก claude -p พร้อม --json-schema และ --max-budget-usd',
    run: () => {
      if (!hasCli()) return NOCLI
      const r = cli(); try {
        if (r.status !== 0) return { ok: false, hint: `exit ${r.status}: ${r.text.slice(0, 250)}` }
        if (!r.hasOut) return { ok: false, hint: 'ไม่มีไฟล์ PNG ที่ --out' }
        const p = png(r.out); const s = seasonal(); const html = existsSync(r.html) ? readFileSync(r.html, 'utf8') : ''
        const prices = new Set(s.items.map((i) => i.price))
        const found = [...html.matchAll(/(?:฿\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:บาท|฿))/g)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, '')))
        for (const m of html.matchAll(/class="[^"]*price[^"]*"[^>]*>([^<]*)</g)) { const v = m[1].match(/\d[\d,]*/); if (v) found.push(Number(v[0].replace(/,/g, ''))) } // รูปแบบราคาอิสระ (98.-, ฿98, 98 บาท) ขอแค่อยู่ใน element ที่ class มีคำว่า price
        const names = s.items.every((i) => html.includes(i.name)), priceOk = s.items.every((i) => found.includes(i.price)) && found.every((v) => prices.has(v))
        const c = r.calls[0]; const a = c?.args ?? []
        const argsOk = a[0] === '-p' && a.includes('--json-schema') && a.includes('--output-format') && a.includes('--max-budget-usd') && Number(a[a.indexOf('--max-budget-usd') + 1]) === limits().max_usd_per_call
        let schema = null; try { schema = JSON.parse(a[a.indexOf('--json-schema') + 1]) } catch { /* ว่าง */ }
        return { ok: p?.w === 1080 && p?.h === 1350 && names && priceOk && argsOk && !!schema?.properties?.headline && r.calls.length === 1 && !('price' in (schema?.properties?.items?.items?.properties ?? {})),
          hint: `ขนาด ${p?.w}×${p?.h} · ชื่อเมนูใน HTML ครบ=${names} · ราคาใน HTML=${found.join(',')} ตรงไฟล์=${priceOk} · args ถูก=${argsOk} (budget ต้อง ${limits().max_usd_per_call}) · schema มี headline=${!!schema?.properties?.headline} · เรียกโมเดล ${r.calls.length} ครั้ง` }
      } finally { done(r) }
    },
  },
  {
    part: 'win', name: 'ตรวจภาพจริง: ไม่ใช่ภาพว่าง (มีสีหลายสี มีเนื้อหา 5–60% ของภาพ) · HTML ที่วาดไม่มีข้อความล้นกรอบ · ฟอนต์ Kanit โหลด · มี 3 รายการ',
    run: async () => {
      if (!hasCli()) return NOCLI
      const r = cli(); try {
        if (r.status !== 0 || !r.hasOut) return { ok: false, hint: `เครื่องมือรันไม่สำเร็จ (exit ${r.status}): ${r.text.slice(0, 200)}` }
        const p = png(r.out); if (!p?.px) return { ok: false, hint: 'อ่านพิกเซลของ PNG ไม่ได้ (ต้องเป็น 8 บิต RGB/RGBA)' }
        const bg = p.px(5, 5), seen = new Set(); let diff = 0, n = 0
        for (let y = 0; y < p.h; y += 5) for (let x = 0; x < p.w; x += 5) { const v = p.px(x, y); n++; if (v !== bg) diff++; seen.add(v) }
        const ratio = diff / n
        const dom = await domCheck(r.html)
        return { ok: ratio > 0.05 && ratio < 0.6 && seen.size > 40 && !dom.bad.length && dom.kanit && dom.items === 3,
          hint: `เนื้อหา ${(ratio * 100).toFixed(1)}% ของภาพ · สี ${seen.size} · ล้นกรอบ=${dom.bad.join('; ') || 'ไม่มี'} · Kanit=${dom.kanit} · รายการ ${dom.items}` }
      } finally { done(r) }
    },
  },
  {
    part: 'win', name: 'test ของ tools/poster/ มีและผ่าน',
    run: () => {
      const tests = walk('tools/poster').filter((f) => f.endsWith('.test.ts'))
      if (!tests.length) return { ok: false, hint: 'ยังไม่มีไฟล์ test ใน tools/poster/' }
      const r = run('node', ['--import', 'tsx', '--test', ...tests])
      return { ok: r.ok, hint: r.ok ? '' : r.out.slice(-400) }
    },
  },
  {
    part: 'win', name: 'ผลจริงจากล็อกอินของคุณ: out/poster.png ขนาด 1080×1350 และมีเนื้อหา',
    run: () => {
      if (!exists('out/poster.png')) return { ok: false, hint: 'ยังไม่มี out/poster.png — รัน npm run poster ด้วยล็อกอินของคุณหนึ่งครั้ง' }
      const p = png(join(root, 'out/poster.png'))
      return { ok: p?.w === 1080 && p?.h === 1350 && statSync(join(root, 'out/poster.png')).size > 20000, hint: `ขนาด ${p?.w}×${p?.h}, ${statSync(join(root, 'out/poster.png')).size} ไบต์` }
    },
  },
  // ---- ลองทดสอบหนัก ๆ: กดซ้ำ 20 ครั้ง ----
  {
    part: 'break', name: 'กดซ้ำเมนูเดิม 3 ครั้ง → เรียกโมเดลแค่ครั้งเดียว (cache) · ใช้ --force → เรียกใหม่ · cache ไม่นับค่าใช้จ่าย',
    run: () => {
      if (!hasCli()) return NOCLI
      const d = mkdtempSync(join(tmpdir(), 'cafe-poster-')); const rs = []
      try {
        for (let i = 0; i < 3; i++) rs.push(cli([], { dir: d }))
        const afterThree = rs[2].calls.length, spend3 = rs[2].spend?.calls
        const f = cli(['--force'], { dir: d })
        return { ok: rs.every((r) => r.status === 0 && r.hasOut) && afterThree === 1 && spend3 === 1 && /cache/i.test(rs[1].text) && f.status === 0 && f.calls.length === 2 && f.spend?.calls === 2,
          hint: `เรียกโมเดลหลังกด 3 ครั้ง = ${afterThree} (ต้อง 1) · spend.calls=${spend3} · ข้อความรอบ 2 บอก cache=${/cache/i.test(rs[1].text)} · หลัง --force เรียก ${f.calls.length} ครั้ง` }
      } finally { rmSync(d, { recursive: true, force: true }) }
    },
  },
  {
    part: 'break', name: 'กดซ้ำ 20 ครั้งด้วย theme ต่างกัน → ถึงเพดานจำนวนครั้ง/วัน แล้วหยุดเรียกโมเดล (exit 3 ข้อความไทย) · ของที่เคยทำแล้วยังออกได้จาก cache',
    run: () => {
      if (!hasCli()) return NOCLI
      const d = mkdtempSync(join(tmpdir(), 'cafe-poster-')); const max = limits().max_calls_per_day; const codes = []; let last
      try {
        for (let i = 0; i < 20; i++) { last = cli(['--theme', `ธีม ${i}`], { dir: d }); codes.push(last.status) }
        const blocked = codes.filter((c) => c === 3).length, okc = codes.filter((c) => c === 0).length
        const msg = cli(['--theme', 'ธีม 19'], { dir: d })
        const cached = cli(['--theme', 'ธีม 0'], { dir: d })
        return { ok: okc === max && blocked === 20 - max && last.calls.length === max && last.spend?.calls === max && msg.status === 3 && thai.test(msg.text) && noStack(msg.text) && cached.status === 0 && cached.calls.length === max,
          hint: `สำเร็จ ${okc} (ต้อง ${max}) · ถูกบล็อก ${blocked} · เรียกโมเดลรวม ${last.calls.length} · ข้อความบล็อก "${msg.text.trim().slice(0, 80)}" · cache หลังถึงเพดาน exit ${cached.status} เรียกเพิ่ม=${cached.calls.length - max}` }
      } finally { rmSync(d, { recursive: true, force: true }) }
    },
  },
  {
    part: 'break', name: 'เพดานเงินต่อวัน: ถ้าแต่ละครั้งแพงขึ้น ($0.20) หยุดก่อนเกิน max_usd_per_day · spend.json เก็บยอดจริงจากผลของ claude',
    run: () => {
      if (!hasCli()) return NOCLI
      const d = mkdtempSync(join(tmpdir(), 'cafe-poster-')); const L = limits(); const cost = 0.2; let last; const codes = []
      try {
        for (let i = 0; i < 6; i++) { last = cli(['--theme', `แพง ${i}`], { dir: d, env: { FAKE_CLAUDE_COST: String(cost) } }); codes.push(last.status) }
        const maxCalls = Math.floor((L.max_usd_per_day - L.max_usd_per_call) / cost) + 1 // เรียกได้จน usd + max_usd_per_call > max_usd_per_day
        const usd = last.spend?.usd ?? -1
        return { ok: usd <= L.max_usd_per_day + 1e-9 && last.calls.length >= 1 && last.calls.length <= maxCalls && last.calls.length === last.spend?.calls && Math.abs(usd - last.calls.length * cost) < 1e-6 && codes.includes(3),
          hint: `exit ${codes.join(',')} · เรียก ${last.calls.length} ครั้ง (ไม่เกิน ${maxCalls}) · spend ${JSON.stringify(last.spend)} (เพดาน $${L.max_usd_per_day})` }
      } finally { rmSync(d, { recursive: true, force: true }) }
    },
  },
  {
    part: 'break', name: 'โมเดลส่งเมนูที่ไม่มีในร้านมา → ไม่สร้างภาพ (exit 1 ข้อความไทย) · ข้อความที่มีแท็ก HTML ถูก escape (ไม่มี <script>/<img ดิบใน HTML)',
    run: () => {
      if (!hasCli()) return NOCLI
      const bad = cli([], { mode: 'poster_bad' }), xss = cli([], { mode: 'poster_xss' }); try {
        const html = existsSync(xss.html) ? readFileSync(xss.html, 'utf8') : ''
        const okBad = bad.status === 1 && !bad.hasOut && thai.test(bad.text) && noStack(bad.text)
        const okX = xss.status === 0 && xss.hasOut && !/<script>alert|<img src=x/i.test(html) && html.includes('เมนูใหม่')
        return { ok: okBad && okX, hint: `เมนูผิด: exit ${bad.status} ไฟล์=${bad.hasOut} ไทย=${thai.test(bad.text)} · แท็กใน HTML ดิบ=${/<script>alert|<img src=x/i.test(html)} exit ${xss.status}` }
      } finally { done(bad); done(xss) }
    },
  },
  // ---- ต่อยอด ----
  {
    part: 'extra', name: 'ข้อความยาวจนล้นกรอบ → ตรวจภาพจับได้ → exit 4 ข้อความไทย ไม่ทิ้งไฟล์ PNG · ข้อความปกติผ่าน',
    run: () => {
      if (!hasCli()) return NOCLI
      const long = cli([], { mode: 'poster_long' }), okRun = cli(); try {
        return { ok: long.status === 4 && !long.hasOut && thai.test(long.text) && noStack(long.text) && okRun.status === 0 && okRun.hasOut, hint: `ข้อความยาว: exit ${long.status} (ต้อง 4) ไฟล์=${long.hasOut} · ปกติ: exit ${okRun.status}` }
      } finally { done(long); done(okRun) }
    },
  },
  {
    part: 'extra', name: 'package.json มี npm run poster และ playwright · state (.cafe/) ไม่เข้า git · ไม่มี key/ค่าลับในไฟล์ของเครื่องมือ',
    run: () => {
      const p = JSON.parse(read('package.json')); const gi = read('.gitignore')
      const leaks = walk('tools/poster').filter((f) => /sk-ant-(?!FAKE)[A-Za-z0-9_-]{20,}/.test(read(f)))
      return { ok: !!p.scripts?.poster && !!(p.devDependencies?.playwright || p.dependencies?.playwright) && /^\.cafe\/?$/m.test(gi) && !leaks.length, hint: `script poster=${!!p.scripts?.poster} · playwright=${!!(p.devDependencies?.playwright || p.dependencies?.playwright)} · .cafe ใน .gitignore=${/^\.cafe\/?$/m.test(gi)} · ไฟล์ที่มี key=${leaks.join(',') || 'ไม่มี'}` }
    },
  },
]
