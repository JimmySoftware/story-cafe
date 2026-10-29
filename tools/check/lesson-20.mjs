// ตัวตรวจบท 20: POS หน้าร้าน (Tauri) — คิดบิล (เทียบกับสูตรอ้างอิงของตัวตรวจ) · ลองทดสอบหนัก ๆ กับข้อมูลแปลก ๆ · หน้าจอ (Playwright) · เปลือก Tauri
import { spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync, createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { exists, read, run, walk, root } from './lib.mjs'

const NOBILL = { ok: false, hint: 'ต้องมี pos/src/bill.ts ส่งออก computeBill ตาม briefs/pos.md' }
const csv = (p) => { const [h, ...r] = read(p).split('\n').filter((l) => l.trim()); const c = h.split(','); return r.map((l) => Object.fromEntries(l.split(',').map((v, i) => [c[i], v.trim()]))) }
export const catalog = () => ({
  items: csv('data/menu.csv').map((r) => ({ name: r.name, price: Number(r.price), is_drink: r.is_drink === '1' })),
  options: csv('data/options.csv').map((r) => ({ kind: r.kind, label: r.label, price_delta: Number(r.price_delta) })),
})
const fail = (code) => ({ throws: code })

// ---- สูตรอ้างอิงของตัวตรวจ (อิสระจากโค้ดของผู้เรียน) ----
export function ref(input, cat) {
  if (!input.lines?.length) return fail('empty_bill')
  const ints = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
  const kindOf = (k, l) => cat.options.find((o) => o.kind === k && o.label === l)
  const lines = []
  for (const l of input.lines) {
    const it = cat.items.find((i) => i.name === l.item); if (!it) return fail('unknown_item')
    if (!ints(l.qty, 1, 99)) return fail('bad_qty')
    const o = l.options ?? {}; let unit = it.price; const parts = [it.name]
    if (!it.is_drink && (o.size !== undefined || o.sweetness !== undefined || o.milk !== undefined || (o.extra_shots ?? 0) !== 0)) return fail('bad_option')
    if (o.size !== undefined) { const s = kindOf('size', o.size); if (!s) return fail('bad_option'); unit += s.price_delta; parts.push(o.size) }
    if (o.milk !== undefined) { const m = kindOf('milk', o.milk); if (!m) return fail('bad_option'); unit += m.price_delta; parts.push(o.milk) }
    if (o.sweetness !== undefined) { if (!kindOf('sweetness', o.sweetness)) return fail('bad_option') }
    if (o.extra_shots !== undefined) { if (!ints(o.extra_shots, 0, 4)) return fail('bad_option'); unit += o.extra_shots * cat.options.find((x) => x.kind === 'extra').price_delta }
    lines.push({ item: it.name, qty: l.qty, unit_price: unit, line_total: unit * l.qty })
  }
  for (const k of ['redeem_points', 'points_balance']) if (input[k] !== undefined && !ints(input[k], 0, Number.MAX_SAFE_INTEGER)) return fail('bad_points')
  const subtotal = lines.reduce((a, l) => a + l.line_total, 0)
  const redeemed = Math.min(input.redeem_points ?? 0, input.points_balance ?? 0, subtotal)
  const total = subtotal - redeemed
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' }).format(new Date(input.at ?? '2026-10-26T10:00:00+07:00'))
  const earned = Math.floor(total / 25) * (dow === 'Sat' ? 2 : 1)
  if (input.cash_received !== undefined && input.cash_received < total) return fail('cash_short')
  return { ok: { lines, subtotal, discount: redeemed, total, cash_received: input.cash_received ?? null, change: input.cash_received === undefined ? null : input.cash_received - total, points_earned: earned, points_redeemed: redeemed } }
}

// ---- ชุดทดสอบ ----
const MON = '2026-10-26T10:00:00+07:00', SAT = '2026-10-24T10:00:00+07:00'
const basic = [
  { lines: [{ item: 'ลาเต้', qty: 1, options: { size: 'L', milk: 'โอ๊ต', sweetness: '50%' } }, { item: 'ครัวซองต์เนย', qty: 1 }], redeem_points: 30, points_balance: 100, cash_received: 200, at: MON, expect: { subtotal: 179, discount: 30, total: 149, change: 51, points_earned: 5 } },
  { lines: [{ item: 'เอสเปรสโซ', qty: 2 }], cash_received: 110, at: MON, expect: { subtotal: 110, total: 110, change: 0, points_earned: 4 } },
  { lines: [{ item: 'อเมริกาโน่', qty: 1, options: { size: 'M', extra_shots: 2 } }], at: MON, expect: { subtotal: 115, total: 115, change: null, points_earned: 4 } },
]
const edge = [
  { lines: [{ item: 'ลาเต้', qty: 1 }, { item: 'ครัวซองต์เนย', qty: 2 }], at: SAT, redeem_points: 5, points_balance: 5 },                              // วันเสาร์ ×2
  { lines: [{ item: 'ลาเต้', qty: 1 }], at: '2026-10-23T18:30:00Z' },                                                                              // เสาร์ 01:30 ไทย (ยังเป็นพฤหัสใน UTC)
  { lines: [{ item: 'ลาเต้', qty: 1 }], at: '2026-10-24T17:30:00Z' },                                                                              // อาทิตย์ 00:30 ไทย (ยังเป็นเสาร์ใน UTC)
  { lines: [{ item: 'ลาเต้', qty: 1 }], redeem_points: 500, points_balance: 20, at: MON },                                                         // ขอใช้เกินที่มี
  { lines: [{ item: 'เอสเปรสโซ', qty: 1 }], redeem_points: 500, points_balance: 500, at: MON },                                                    // ขอใช้เกินยอด → ลดเท่ายอด ได้ 0 แต้ม
  { lines: [{ item: 'เอสเปรสโซ', qty: 1 }], redeem_points: 30, at: MON },                                                                          // ไม่บอกแต้มที่มี = ใช้ไม่ได้
  { lines: [{ item: 'ชามะนาว', qty: 1 }, { item: 'บราวนี่ช็อกโกแลต', qty: 1 }], at: MON },                                                           // total 144 → 5 แต้ม
  { lines: [{ item: 'เอสเปรสโซ', qty: 1 }], redeem_points: 31, points_balance: 31, at: MON },                                                      // total 24 → 0 แต้ม
  { lines: [{ item: 'โคลด์บรูว์', qty: 1, options: { size: 'S' } }], redeem_points: 10, points_balance: 10, at: MON },                              // total 75 → 3
  { lines: [{ item: 'ลาเต้', qty: 1, options: { extra_shots: 0 } }], at: MON },
  { lines: [{ item: 'ลาเต้', qty: 99 }], at: MON },
  { lines: [{ item: 'ลาเต้', qty: 1 }], cash_received: 75, at: MON },
  { lines: [{ item: 'ลาเต้', qty: 1 }], cash_received: 74, at: MON, throws: 'cash_short' },
  { lines: [{ item: 'พิซซ่าฮาวาย', qty: 1 }], at: MON, throws: 'unknown_item' },
  { lines: [{ item: 'ลาเต้', qty: 0 }], at: MON, throws: 'bad_qty' },
  { lines: [{ item: 'ลาเต้', qty: 1.5 }], at: MON, throws: 'bad_qty' },
  { lines: [{ item: 'ลาเต้', qty: 100 }], at: MON, throws: 'bad_qty' },
  { lines: [{ item: 'ลาเต้', qty: -1 }], at: MON, throws: 'bad_qty' },
  { lines: [{ item: 'ครัวซองต์เนย', qty: 1, options: { size: 'L' } }], at: MON, throws: 'bad_option' },
  { lines: [{ item: 'ครัวซองต์เนย', qty: 1, options: { extra_shots: 1 } }], at: MON, throws: 'bad_option' },
  { lines: [{ item: 'ลาเต้', qty: 1, options: { sweetness: '70%' } }], at: MON, throws: 'bad_option' },
  { lines: [{ item: 'ลาเต้', qty: 1, options: { milk: 'นมแพะ' } }], at: MON, throws: 'bad_option' },
  { lines: [{ item: 'ลาเต้', qty: 1, options: { size: 'XL' } }], at: MON, throws: 'bad_option' },
  { lines: [{ item: 'ลาเต้', qty: 1, options: { extra_shots: 5 } }], at: MON, throws: 'bad_option' },
  { lines: [{ item: 'ลาเต้', qty: 1, options: { extra_shots: 1.5 } }], at: MON, throws: 'bad_option' },
  { lines: [{ item: 'ลาเต้', qty: 1 }], redeem_points: -5, points_balance: 10, at: MON, throws: 'bad_points' },
  { lines: [{ item: 'ลาเต้', qty: 1 }], redeem_points: 2.5, points_balance: 10, at: MON, throws: 'bad_points' },
  { lines: [{ item: 'ลาเต้', qty: 1 }], redeem_points: 5, points_balance: -1, at: MON, throws: 'bad_points' },
  { lines: [], at: MON, throws: 'empty_bill' },
]
function randomCases(n) {
  let s = 20260; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const cat = catalog(), pick = (a) => a[Math.floor(rnd() * a.length)], labels = (k) => cat.options.filter((o) => o.kind === k).map((o) => o.label)
  const days = [MON, SAT, '2026-10-27T03:00:00Z', '2026-10-24T20:00:00Z', '2026-10-25T01:00:00+07:00', '2026-10-23T23:59:00+07:00']
  return Array.from({ length: n }, () => {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
      const it = pick(cat.items); const o = {}
      if (it.is_drink) { if (rnd() < 0.7) o.size = pick(labels('size')); if (rnd() < 0.5) o.milk = pick(labels('milk')); if (rnd() < 0.5) o.sweetness = pick(labels('sweetness')); if (rnd() < 0.3) o.extra_shots = Math.floor(rnd() * 5) }
      return { item: it.name, qty: 1 + Math.floor(rnd() * 5), ...(Object.keys(o).length ? { options: o } : {}) }
    })
    const c = { lines, at: pick(days) }
    if (rnd() < 0.7) { c.points_balance = Math.floor(rnd() * 300); c.redeem_points = Math.floor(rnd() * 400) }
    if (rnd() < 0.6) c.cash_received = 100 + Math.floor(rnd() * 1000)
    return c
  })
}

function runBill(cases) {
  const d = mkdtempSync(join(tmpdir(), 'cafe-bill-')), f = join(d, 'run.mts')
  const cat = catalog()
  writeFileSync(f, `import { computeBill } from ${JSON.stringify(resolve(root, 'pos/src/bill.ts'))}
const cat = ${JSON.stringify(cat)}; const cases = ${JSON.stringify(cases.map((c) => ({ ...c, expect: undefined, throws: undefined })))}
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze) } return o }
const out = cases.map((c) => { try { return { ok: computeBill(deepFreeze(structuredClone(c)), structuredClone(cat)) } } catch (e) { return { err: String(e?.message ?? e) } } })
console.log(JSON.stringify(out))`)
  const r = spawnSync('node', ['--import', 'tsx', f], { cwd: root, encoding: 'utf8', timeout: 90000 })
  rmSync(d, { recursive: true, force: true })
  if (r.status !== 0) return { error: `${r.stdout}${r.stderr}`.slice(-400) }
  try { return { out: JSON.parse(r.stdout.trim().split('\n').pop()) } } catch { return { error: `อ่านผลไม่ได้: ${r.stdout.slice(0, 200)}` } }
}
const sameBill = (a, b) => ['subtotal', 'discount', 'total', 'cash_received', 'change', 'points_earned', 'points_redeemed'].every((k) => a?.[k] === b[k]) && Array.isArray(a?.lines) && a.lines.length === b.lines.length && a.lines.every((l, i) => l.unit_price === b.lines[i].unit_price && l.line_total === b.lines[i].line_total && l.qty === b.lines[i].qty && l.item === b.lines[i].item && typeof l.label === 'string' && l.label.includes(l.item))
function compare(cases) {
  if (!exists('pos/src/bill.ts')) return NOBILL
  const cat = catalog(), r = runBill(cases); if (r.error) return { ok: false, hint: r.error }
  const bad = []
  cases.forEach((c, i) => {
    const want = ref(c, cat), got = r.out[i]
    if (c.throws && want.throws !== c.throws) bad.push(`ตัวตรวจเอง: case ${i}`)
    if (want.throws) { if (!(got.err ?? '').startsWith(`${want.throws}:`) && got.err !== want.throws) bad.push(`#${i} ${JSON.stringify(c).slice(0, 90)} ควร ${want.throws} ได้ ${got.err ?? JSON.stringify(got.ok).slice(0, 60)}`) }
    else if (got.err || !sameBill(got.ok, want.ok)) bad.push(`#${i} ${JSON.stringify(c).slice(0, 90)} ควร total ${want.ok.total} ทอน ${want.ok.change} แต้ม ${want.ok.points_earned} · ได้ ${got.err ?? `total ${got.ok.total} ทอน ${got.ok.change} แต้ม ${got.ok.points_earned}`}`)
  })
  return { ok: !bad.length, hint: bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … (ผิด ${bad.length}/${cases.length})` : '') }
}

// ---- เซิร์ฟเวอร์ static สำหรับ pos/dist ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.png': 'image/png' }
function serveDist() {
  const dir = join(root, 'pos/dist')
  const s = createServer((q, a) => {
    let p = join(dir, decodeURIComponent(q.url.split('?')[0])); if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html')
    a.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); createReadStream(p).pipe(a)
  })
  return new Promise((res) => s.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() })))
}
const cargoEnv = () => ({ ...process.env, PATH: `${process.env.CARGO_HOME ?? `${homedir()}/.cargo`}/bin:${process.env.PATH}` })
const n = (t) => Number(String(t).replace(/[^\d.-]/g, ''))

export const skipOnTag = (c) => false

export const checks = [
  {
    part: 'win', name: 'computeBill: ตัวอย่างในบทได้ครบ (ลาเต้ L โอ๊ต หวาน 50% + ครัวซองต์ − 30 แต้ม รับ 200 → รวม 179, ลด 30, สุทธิ 149, ทอน 51, ได้ 5 แต้ม) + อีก 2 บิลธรรมดา (วันธรรมดา) ตรงสูตรอ้างอิง',
    run: () => {
      // ตรวจว่าสูตรอ้างอิงของตัวตรวจเองตรงตัวเลขในบท
      for (const b of basic) { const w = ref(b, catalog()).ok; for (const [k, v] of Object.entries(b.expect)) if (w[k] !== v) return { ok: false, hint: `ตัวตรวจเอง: ${k} ${w[k]} ≠ ${v}` } }
      return compare(basic.map(({ expect, ...c }) => c))
    },
  },
  {
    part: 'win', name: 'bill.ts ไม่มีราคาเมนูฝังในโค้ด (ราคามาจาก catalog ที่มาจาก data/ ที่เดียว) · test ของ computeBill มีและผ่าน · npm test (root) รัน test ของ pos ด้วย',
    run: () => {
      if (!exists('pos/src/bill.ts')) return NOBILL
      const code = read('pos/src/bill.ts').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
      const hard = [...new Set(catalog().items.map((i) => i.price))].filter((p) => new RegExp(`(?<![\\w.])${p}(?![\\w.])`).test(code))
      const tests = walk('pos/src').filter((f) => f.endsWith('.test.ts'))
      if (!tests.length) return { ok: false, hint: 'ยังไม่มี pos/src/bill.test.ts' }
      const t = run('node', ['--import', 'tsx', '--test', ...tests])
      const wired = /pos\/src/.test(JSON.parse(read('package.json')).scripts?.test ?? '')
      return { ok: !hard.length && t.ok && wired, hint: `ราคาที่ถูกฝังในโค้ด=${hard.join(',') || 'ไม่มี'} · test ผ่าน=${t.ok}${t.ok ? '' : ' ' + t.out.slice(-250)} · npm test รวม pos=${wired}` }
    },
  },
  {
    part: 'break', name: 'ลองทดสอบหนัก ๆ (ข้อมูลแปลก ๆ): วันเสาร์ตามเวลาไทย (ข้ามเที่ยงคืน UTC) · ใช้แต้มเกินที่มี/เกินยอด · ปัดเศษแต้ม · เงินไม่พอ · เมนู/จำนวน/ตัวเลือก/แต้มผิด → error ตามรหัสในบท · input ไม่ถูกแก้',
    run: () => compare(edge),
  },
  {
    part: 'break', name: 'สุ่ม 400 บิลเทียบกับสูตรอ้างอิง (ทุกเมนู ตัวเลือก จำนวน แต้ม เงินรับ วันเวลา) ตรงทั้งหมด',
    run: () => compare(randomCases(400)),
  },
  {
    part: 'extra', name: 'catalog: npm run catalog (pos/) สร้าง public/catalog.json จาก data/ ครบทุกเมนูและตัวเลือก',
    run: () => {
      if (!exists('pos/package.json')) return { ok: false, hint: 'ไม่มีโฟลเดอร์ pos/' }
      const r = spawnSync('node', ['scripts/build-catalog.mjs'], { cwd: join(root, 'pos'), encoding: 'utf8' })
      const c = JSON.parse(read('pos/public/catalog.json') || '{}'), m = catalog()
      return { ok: r.status === 0 && c.items?.length === m.items.length && c.options?.length === m.options.length, hint: `${r.stdout}${r.stderr}`.trim().slice(0, 150) }
    },
  },
  {
    part: 'extra', name: 'หน้าจอ POS (build จริง + Playwright): กดลาเต้ L โอ๊ต 50% + ครัวซองต์ · แต้ม 100 ใช้ 30 · รับ 200 → รวม 149 ทอน 51 ได้ 5 แต้ม · ใช้แต้มเกินที่มีไม่ทำให้ยอดเพี้ยน · เงินไม่พอขึ้น "เงินไม่พอ" · ไม่มี error ใน console',
    run: async () => {
      if (!exists('pos/src/App.tsx') && !walk('pos/src').some((f) => /\.tsx$/.test(f) && f !== 'pos/src/main.tsx')) return { ok: false, hint: 'ยังไม่มีหน้าจอ POS ใน pos/src/' }
      const b = spawnSync('npm', ['run', 'build', '--silent'], { cwd: join(root, 'pos'), encoding: 'utf8', timeout: 170000 })
      if (b.status !== 0) return { ok: false, hint: `npm run build (pos/) ไม่ผ่าน: ${(b.stdout + b.stderr).slice(-300)}` }
      const { chromium } = await import('playwright'); const srv = await serveDist(); const browser = await chromium.launch(); const errs = []
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
        page.on('console', (m) => m.type() === 'error' && errs.push(m.text())); page.on('pageerror', (e) => errs.push(String(e)))
        await page.goto(srv.url); const t = (id) => page.getByTestId(id)
        const text = async (id) => (await t(id).first().innerText()).trim()
        await t('menu-ลาเต้').click(); await t('opt-size-L').click(); await t('opt-milk-โอ๊ต').click(); await t('opt-sweetness-50%').click(); await t('add-line').click()
        await t('menu-ครัวซองต์เนย').click(); await t('add-line').click()
        await t('balance-input').fill('100'); await t('redeem-input').fill('30'); await t('cash-input').fill('200')
        await page.waitForTimeout(150)
        const got = { lines: await t('bill-line').count(), subtotal: n(await text('subtotal')), discount: n(await text('discount')), total: n(await text('total')), change: n(await text('change')), earned: n(await text('points-earned')) }
        await t('redeem-input').fill('999'); await page.waitForTimeout(150); const over = { discount: n(await text('discount')), total: n(await text('total')) }
        await t('redeem-input').fill('30'); await t('cash-input').fill('100'); await page.waitForTimeout(150); const short = await text('change')
        const ok = got.lines === 2 && got.subtotal === 179 && got.discount === 30 && got.total === 149 && got.change === 51 && got.earned === 5 && over.discount === 100 && over.total === 79 && /เงินไม่พอ/.test(short) && !errs.length
        return { ok, hint: `บิล ${JSON.stringify(got)} (ต้อง 2/179/30/149/51/5) · ขอใช้ 999 แต้มมี 100 → ลด ${over.discount} สุทธิ ${over.total} (ต้อง 100/79) · เงิน 100 → "${short}" · console error: ${errs.slice(0, 2).join(' | ') || 'ไม่มี'}` }
      } finally { await browser.close(); srv.close() }
    },
  },
  {
    part: 'extra', name: 'เปลือก Tauri: tauri.conf.json ถูก (ชื่อ Story Cafe POS, identifier th.example.storycafe.pos, frontendDist ../dist, หน้าต่าง ≥ 1000 px) · ไม่เพิ่ม permission เกินจำเป็น · cargo check ผ่าน',
    run: () => {
      if (!exists('pos/src-tauri/tauri.conf.json')) return { ok: false, hint: 'ไม่มี pos/src-tauri/tauri.conf.json' }
      const c = JSON.parse(read('pos/src-tauri/tauri.conf.json')), w = c.app?.windows?.[0] ?? {}
      const caps = walk('pos/src-tauri/capabilities').map((f) => read(f)).join('\n')
      const perms = [...caps.matchAll(/"([a-z-]+:[a-z-]+)"/g)].map((m) => m[1]).filter((p) => /^(fs|shell|http|opener|process):/.test(p))
      const conf = c.productName === 'Story Cafe POS' && c.identifier === 'th.example.storycafe.pos' && c.build?.frontendDist === '../dist' && (w.width ?? 0) >= 1000
      if (!existsSync(join(root, 'pos/dist/index.html'))) spawnSync('npm', ['run', 'build', '--silent'], { cwd: join(root, 'pos'), encoding: 'utf8', timeout: 170000 })
      const r = spawnSync('cargo', ['check', '--quiet'], { cwd: join(root, 'pos/src-tauri'), encoding: 'utf8', env: cargoEnv(), timeout: 600000 })
      return { ok: conf && !perms.length && r.status === 0, hint: `conf ถูก=${conf} (${c.productName}/${c.identifier}/${c.build?.frontendDist}/${w.width}) · permission เกินจำเป็น=${perms.join(',') || 'ไม่มี'} · cargo check exit ${r.status} ${(r.stderr ?? '').slice(-200)}` }
    },
  },
]
