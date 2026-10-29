// ตัวตรวจบท 22: แอปเจ้าของร้าน (PWA) — sales_summary ตัวเดียวทุกช่องทาง · สต็อกตัดตามสูตรรวมตัวเลือก (stock_history) · PWA (manifest, service worker, ออฟไลน์เปิดเปลือกได้)
import { spawnSync } from 'node:child_process'
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { exists, read, run, walk, root, lines } from './lib.mjs'
import { rows, scalar, sql, dbUp } from './db.mjs'
import { api, env, rpc, newUser, delUser } from './api.mjs'
import { ref, catalog } from './lesson-20.mjs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const PHONE = '0900000022', DAY = '2026-03-03'
const BEANS = 'เมล็ดกาแฟ Story House Blend'

// ---------- ข้อมูลตัวอย่างของตัวตรวจ ----------
const POS = [
  { at: '2026-03-03T08:15:00+07:00', lines: [{ item: 'ลาเต้', qty: 1, options: { size: 'L', milk: 'โอ๊ต' } }] },
  { at: '2026-03-03T08:50:00+07:00', lines: [{ item: 'เอสเปรสโซ', qty: 2 }, { item: 'ครัวซองต์เนย', qty: 1 }] },
  { at: '2026-03-03T14:30:00+07:00', lines: [{ item: 'ดริปกาแฟ เอธิโอเปีย', qty: 1 }] },
  { at: '2026-03-03T23:30:00+07:00', lines: [{ item: 'อเมริกาโน่', qty: 1 }] },
  { at: '2026-03-02T17:30:00Z', lines: [{ item: 'ชามะนาว', qty: 1 }], hour: 0 },            // 00:30 ไทยของวันที่ 3 (ยังเป็นวันที่ 2 ใน UTC)
  { at: '2026-03-03T17:30:00Z', lines: [{ item: 'ลาเต้', qty: 1 }], out: true },             // 00:30 ไทยของวันที่ 4 → ไม่นับ
  { at: '2026-03-02T16:59:00Z', lines: [{ item: 'ลาเต้', qty: 1 }], out: true },             // 23:59 ไทยของวันที่ 2 → ไม่นับ
]
const PRE = [ // [created_at, status, total, cups]
  ['2026-03-03 09:20:00+07', 'placed', 200, 2], ['2026-03-03 09:30:00+07', 'cancelled', 999, 1], ['2026-03-03 14:10:00+07', 'picked_up', 150, 1], ['2026-03-04 00:10:00+07', 'placed', 77, 1],
]
const SHOP = [['2026-03-03 10:00:00+07', 'paid', 300], ['2026-03-03 10:10:00+07', 'pending', 500], ['2026-03-03 14:05:00+07', 'shipped', 120]]
const hourOf = (iso) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)))

function expected() {
  const cat = catalog(), cu = Object.fromEntries((rows('select name,cup_units from menu_items') ?? []).map(([n, c]) => [n, Number(c)]))
  const ev = [] // {src,hour,revenue,cups}
  for (const b of POS) { if (b.out) continue; const t = ref({ lines: b.lines, at: b.at }, cat).ok; ev.push({ src: 'pos', hour: hourOf(b.at), revenue: t.total, cups: b.lines.reduce((a, l) => a + l.qty * cu[l.item], 0) }) }
  for (const [at, st, total, cups] of PRE) if (['placed', 'picked_up'].includes(st) && at.startsWith(DAY)) ev.push({ src: 'preorder', hour: hourOf(at.replace(' ', 'T').replace(/\+07$/, '+07:00')), revenue: total, cups })
  for (const [at, st, total] of SHOP) if (['paid', 'shipped'].includes(st)) ev.push({ src: 'shop', hour: hourOf(at.replace(' ', 'T').replace(/\+07$/, '+07:00')), revenue: total, cups: 0 })
  const sum = (a) => ({ bills: a.length, revenue: a.reduce((x, e) => x + e.revenue, 0), cups: a.reduce((x, e) => x + e.cups, 0) })
  const by_hour = {}; for (const e of ev) (by_hour[e.hour] ??= []).push(e)
  return { ...sum(ev), by_hour: Object.fromEntries(Object.entries(by_hour).map(([h, a]) => [h, sum(a)])), by_source: Object.fromEntries(['pos', 'preorder', 'shop'].map((s) => [s, sum(ev.filter((e) => e.src === s))])) }
}

async function forged() {
  const e = env(), email = `check-forged22-${Date.now()}@example.invalid`
  const c = await api('/auth/v1/admin/users', { key: e.SUPABASE_SECRET_KEY, body: { email, password: 'Check-pass-123', email_confirm: true, user_metadata: { role: 'staff' } } })
  const s = await api('/auth/v1/token?grant_type=password', { body: { email, password: 'Check-pass-123' } })
  return { id: c.body.id, token: s.body.access_token }
}
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
const stockSnap = () => Object.fromEntries((rows('select name,stock from ingredients') ?? []).map(([n, s]) => [n, Number(s)]))
const hasTable = (t) => scalar(`select to_regclass('public.${t}') is not null`) === 't'

let bills = []
async function seed(staff) {
  bills = []
  for (const b of POS) { const r = await rpc('pos_record_bill', { p_client_order_id: crypto.randomUUID(), p_lines: b.lines, p_at: b.at, p_customer_phone: PHONE }, staff.token); if (!r.ok) throw new Error(`pos_record_bill ล้ม (${r.status}): ${r.text.slice(0, 160)}`); bills.push(r.body.id) }
  const lat = "(select id from menu_items where name='ลาเต้')"
  PRE.forEach(([at, st, total, cups], i) => { sql(`insert into orders(code,customer_name,phone,pickup_at,status,total,created_at) values ('SC-T22-${i}','ทดสอบ','${PHONE}','${at}','${st}',${total},'${at}')`); sql(`insert into order_items(order_id,menu_item_id,qty,unit_price,cups) select id,${lat},${cups},${Math.round(total / Math.max(cups, 1))},${cups} from orders where code='SC-T22-${i}'`) })
  SHOP.forEach(([at, st, total], i) => sql(`insert into shop_orders(code,user_id,status,total,ship_name,ship_phone,ship_address,created_at) values ('SH-T22-${i}','${staff.id}','${st}',${total},'ทดสอบ','${PHONE}','ที่อยู่สมมติ','${at}')`))
}
function cleanup(snap) {
  sql("delete from notify_queue where dedupe_key like 'order_placed:SC-T22-%' or dedupe_key like 'order_placed:SH-T22-%'")
  sql(`delete from orders where phone='${PHONE}'`); sql(`delete from shop_orders where ship_phone='${PHONE}'`)
  if (hasTable('stock_history')) sql(`delete from stock_history where source_id in (select id from pos_bills where customer_phone='${PHONE}')`)
  sql(`delete from pos_bills where customer_phone='${PHONE}'`)
  if (snap) for (const [n, s] of Object.entries(snap)) sql(`update ingredients set stock=${s} where name='${n}'`)
}
async function withStaff(fn) {
  const snap = stockSnap(), staff = await newUser('o22', { appMetadata: { role: 'staff' } })
  try { cleanup(); return await fn(staff) } finally { cleanup(snap); await delUser(staff.id) }
}
const norm = (body) => {
  const g = (o) => ({ bills: Number(o?.bills), revenue: Number(o?.revenue), cups: Number(o?.cups) })
  const hrs = {}; for (const h of body.by_hour ?? []) if (Number(h.bills) > 0) hrs[Number(h.hour)] = g(h)
  return { ...g(body), by_hour: hrs, by_source: Object.fromEntries(['pos', 'preorder', 'shop'].map((s) => [s, g(body.by_source?.[s])])) }
}

// ---------- static server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }
const serve = (dir) => new Promise((res) => { const s = createServer((q, a) => { let p = join(dir, decodeURIComponent(q.url.split('?')[0])); if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html'); a.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); createReadStream(p).pipe(a) }); s.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() })) })
const buildOwner = () => { const E = env(); return spawnSync('npm', ['run', 'build', '--silent'], { cwd: join(root, 'owner'), encoding: 'utf8', timeout: 170000, env: { ...process.env, VITE_SUPABASE_URL: E.SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: E.SUPABASE_PUBLISHABLE_KEY } }) }
const pngSize = (f) => { const b = readFileSync(f); return b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null }
const n = (t) => Number(String(t).replace(/[^\d.-]/g, ''))

const nonEmpty = (p) => lines(p).filter((l) => l.trim()).length
export const partNames = { compare: 'เทียบกับ prompt แรก' }

export const checks = [
  {
    part: 'win', name: 'sales_summary(วัน): ข้อมูลตัวอย่าง 3 ช่องทาง (POS 5 บิล + สั่งล่วงหน้า + ร้านออนไลน์) → จำนวนบิล ยอด แก้ว แก้วต่อชั่วโมง และแยกตามช่องทางตรงการคำนวณอิสระของตัวตรวจ · นับตามวันไทย (00:30 ไทยนับ, 23:59 ของเมื่อวานไม่นับ) · สถานะ cancelled/pending ไม่นับ · มีฟังก์ชันนี้ตัวเดียว',
    run: async () => {
      const n_ = need(); if (n_) return n_
      if (scalar("select to_regprocedure('public.sales_summary(date)') is not null") !== 't') return { ok: false, hint: 'ยังไม่มีฟังก์ชัน sales_summary(date)' }
      return withStaff(async (staff) => {
        await seed(staff)
        const r = await rpc('sales_summary', { p_day: DAY }, staff.token); if (!r.ok) return { ok: false, hint: `เรียกไม่ผ่าน (${r.status}): ${r.text.slice(0, 200)}` }
        const got = norm(r.body), want = expected(), bad = []
        for (const k of ['bills', 'revenue', 'cups']) if (got[k] !== want[k]) bad.push(`${k} ได้ ${got[k]} ควร ${want[k]}`)
        for (const h of new Set([...Object.keys(got.by_hour), ...Object.keys(want.by_hour)])) { const a = JSON.stringify(got.by_hour[h]), b = JSON.stringify(want.by_hour[h]); if (a !== b) bad.push(`ชั่วโมง ${h}: ได้ ${a} ควร ${b}`) }
        for (const s of ['pos', 'preorder', 'shop']) if (JSON.stringify(got.by_source[s]) !== JSON.stringify(want.by_source[s])) bad.push(`${s}: ได้ ${JSON.stringify(got.by_source[s])} ควร ${JSON.stringify(want.by_source[s])}`)
        const one = Number(scalar("select count(*) from pg_proc where proname like 'sales\\_summary%'")) === 1
        const dflt = await rpc('sales_summary', {}, staff.token)
        const today = scalar("select (now() at time zone 'Asia/Bangkok')::date")
        if (!(dflt.ok && String(dflt.body?.day).slice(0, 10) === today)) bad.push(`ไม่ส่งวัน ต้องเป็นวันนี้ไทย ${today} ได้ ${dflt.status} ${String(dflt.body?.day)}`)
        if (!one) bad.push('มีฟังก์ชัน sales_summary* มากกว่าหนึ่งตัว')
        return { ok: !bad.length, hint: bad.slice(0, 5).join(' | ') }
      })
    },
  },
  {
    part: 'win', name: 'sales_summary เฉพาะพนักงาน: anon, ลูกค้า และผู้ใช้ที่ตั้ง user_metadata.role=staff เองเรียกไม่ได้ · พนักงาน (app_metadata) เรียกได้',
    run: async () => {
      const n_ = need(); if (n_) return n_
      if (scalar("select to_regprocedure('public.sales_summary(date)') is not null") !== 't') return { ok: false, hint: 'ยังไม่มีฟังก์ชัน sales_summary(date)' }
      const staff = await newUser('o22a', { appMetadata: { role: 'staff' } }), cust = await newUser('o22b'), f = await forged()
      try {
        const c = (tok) => rpc('sales_summary', { p_day: DAY }, tok)
        const a = await c(undefined), b = await c(cust.token), d = await c(f.token), s = await c(staff.token)
        return { ok: !a.ok && !b.ok && !d.ok && s.ok, hint: `anon ${a.status} ลูกค้า ${b.status} ปลอมเป็นพนักงาน ${d.status} (ต้องถูกปฏิเสธ) พนักงาน ${s.status} (ต้อง 200)` }
      } finally { await delUser(staff.id); await delUser(cust.id); await delUser(f.id) }
    },
  },
  // ---------- ลองทดสอบหนัก ๆ: สต็อก ----------
  {
    part: 'break', name: 'สต็อกตามสูตรครบ: ลาเต้ธรรมดา + ชามะนาว + ครัวซองต์ → เมล็ด −18, นมวัว −180, ชา −3, มะนาว −1, น้ำเชื่อม −20 (ครัวซองต์ไม่ตัด) · stock_history บันทึกตรงกับ ingredients.stock',
    run: async () => {
      const n_ = need(); if (n_) return n_
      if (!hasTable('stock_history')) return { ok: false, hint: 'ยังไม่มีตาราง stock_history' }
      return withStaff(async (staff) => {
        const s0 = stockSnap()
        const r = await rpc('pos_record_bill', { p_client_order_id: crypto.randomUUID(), p_lines: [{ item: 'ลาเต้', qty: 1 }, { item: 'ชามะนาว', qty: 1 }, { item: 'ครัวซองต์เนย', qty: 1 }], p_customer_phone: PHONE }, staff.token)
        if (!r.ok) return { ok: false, hint: `pos_record_bill ไม่ผ่าน: ${r.text.slice(0, 150)}` }
        const s1 = stockSnap(), d = Object.fromEntries(Object.keys(s0).map((k) => [k, +(s1[k] - s0[k]).toFixed(3)]).filter(([, v]) => v !== 0))
        const want = { [BEANS]: -18, 'นมวัว': -180, 'ชาซีลอน': -3, 'มะนาว': -1, 'น้ำเชื่อม': -20 }
        const hist = Object.fromEntries((rows(`select i.name, sum(h.delta) from stock_history h join ingredients i on i.id=h.ingredient_id where h.source='pos_bill' and h.source_id='${r.body.id}' group by 1`) ?? []).map(([a, b]) => [a, Number(b)]))
        return { ok: same(d, want) && same(hist, want), hint: `stock เปลี่ยน ${JSON.stringify(d)} ควร ${JSON.stringify(want)} · stock_history ${JSON.stringify(hist)}` }
      })
    },
  },
  {
    part: 'break', name: 'ตัวเลือกที่แอบทำให้สูตรผิด: ลาเต้โอ๊ต + 2 ช็อต ×2 แก้ว → เมล็ด −108, นมโอ๊ต −360, นมวัว 0 · อเมริกาโน่ M + 1 ช็อต → เมล็ด −36 · ม็อคค่าโอ๊ต → เมล็ด −18, นมโอ๊ต −150, ซอส −30, นมวัว 0 · ลาเต้อัลมอนด์ → เมล็ด −18 ไม่ตัดนมใด ๆ',
    run: async () => {
      const n_ = need(); if (n_) return n_
      if (!hasTable('stock_history')) return { ok: false, hint: 'ยังไม่มีตาราง stock_history' }
      return withStaff(async (staff) => {
        const cases = [
          [[{ item: 'ลาเต้', qty: 2, options: { milk: 'โอ๊ต', extra_shots: 2 } }], { [BEANS]: -108, 'นมโอ๊ต': -360 }],
          [[{ item: 'อเมริกาโน่', qty: 1, options: { size: 'M', extra_shots: 1 } }], { [BEANS]: -36 }],
          [[{ item: 'ม็อคค่า', qty: 1, options: { milk: 'โอ๊ต' } }], { [BEANS]: -18, 'นมโอ๊ต': -150, 'ซอสช็อกโกแลต': -30 }],
          [[{ item: 'ลาเต้', qty: 1, options: { milk: 'อัลมอนด์' } }], { [BEANS]: -18 }],
          [[{ item: 'ลาเต้', qty: 1, options: { milk: 'นมวัว', sweetness: '50%', size: 'L' } }], { [BEANS]: -18, 'นมวัว': -180 }],
        ]
        const bad = []
        for (const [lines, want] of cases) {
          const s0 = stockSnap(); const r = await rpc('pos_record_bill', { p_client_order_id: crypto.randomUUID(), p_lines: lines, p_customer_phone: PHONE }, staff.token)
          if (!r.ok) { bad.push(`บิลไม่ผ่าน ${r.text.slice(0, 80)}`); continue }
          const s1 = stockSnap(), d = Object.fromEntries(Object.keys(s0).map((k) => [k, +(s1[k] - s0[k]).toFixed(3)]).filter(([, v]) => v !== 0))
          if (JSON.stringify(Object.entries(d).sort()) !== JSON.stringify(Object.entries(want).sort())) bad.push(`${JSON.stringify(lines[0].item)} ${JSON.stringify(lines[0].options)} ×${lines[0].qty}: ได้ ${JSON.stringify(d)} ควร ${JSON.stringify(want)}`)
        }
        return { ok: !bad.length, hint: bad.join(' | ') }
      })
    },
  },
  {
    part: 'break', name: 'ส่งบิลเดิมซ้ำ (client_order_id เดิม) ไม่ตัดสต็อกซ้ำ · stock_history ไม่ซ้ำแถว · ผลรวม stock_history = สต็อกที่เปลี่ยนจริง · ส่งพร้อมกัน 5 สายด้วย id เดียวตัดครั้งเดียว',
    run: async () => {
      const n_ = need(); if (n_) return n_
      if (!hasTable('stock_history')) return { ok: false, hint: 'ยังไม่มีตาราง stock_history' }
      return withStaff(async (staff) => {
        const s0 = stockSnap(), id = crypto.randomUUID(), body = { p_client_order_id: id, p_lines: [{ item: 'ลาเต้', qty: 1, options: { milk: 'โอ๊ต', extra_shots: 1 } }], p_customer_phone: PHONE }
        const a = await rpc('pos_record_bill', body, staff.token); const b = await rpc('pos_record_bill', body, staff.token)
        const id2 = crypto.randomUUID(); const par = await Promise.all(Array.from({ length: 5 }, () => rpc('pos_record_bill', { ...body, p_client_order_id: id2 }, staff.token)))
        const s1 = stockSnap(); const dBeans = +(s1[BEANS] - s0[BEANS]).toFixed(3)
        const rowsN = Number(scalar(`select count(*) from stock_history where source='pos_bill' and source_id='${a.body?.id}'`))
        const sums = rows("select i.name, sum(h.delta) from stock_history h join ingredients i on i.id=h.ingredient_id where h.source='pos_bill' and h.source_id in (select id from pos_bills where customer_phone='" + PHONE + "') group by 1") ?? []
        const consistent = sums.every(([nme, v]) => Math.abs(+(s1[nme] - s0[nme]).toFixed(3) - Number(v)) < 1e-6)
        return { ok: a.ok && b.body?.duplicate === true && par.every((r) => r.ok) && dBeans === -72 && rowsN === 2 && consistent, hint: `เมล็ดเปลี่ยน ${dBeans} (ต้อง −72 = 2 บิล × 36) · แถว stock_history ของบิลแรก ${rowsN} (ต้อง 2: เมล็ด นมโอ๊ต) · พร้อมกันสถานะ ${par.map((r) => r.status).join(',')} · ผลรวมประวัติ=สต็อกจริง ${consistent}` }
      })
    },
  },
  {
    part: 'break', name: 'สิทธิ์สต็อก: apply_stock_for_bill เรียกตรงไม่ได้ (anon/ลูกค้า/พนักงาน) · stock_history พนักงานอ่านได้ ลูกค้าและ anon อ่านไม่ได้ ไม่มีใครเขียนตรง · stock_low() เฉพาะพนักงาน และเห็นมะนาวเมื่อต่ำกว่าจุดสั่งซื้อ (ของที่ยังเหลือเยอะไม่ติด)',
    run: async () => {
      const n_ = need(); if (n_) return n_
      if (!hasTable('stock_history') || scalar("select to_regprocedure('public.stock_low()') is not null") !== 't') return { ok: false, hint: 'ยังไม่มี stock_history หรือ stock_low()' }
      return withStaff(async (staff) => {
        const cust = await newUser('o22c'); const f = await forged()
        try {
          const rb = await rpc('pos_record_bill', { p_client_order_id: crypto.randomUUID(), p_lines: [{ item: 'ลาเต้', qty: 1 }], p_customer_phone: PHONE }, staff.token)
          const direct = await Promise.all([undefined, cust.token, staff.token].map((t) => rpc('apply_stock_for_bill', { p_bill: rb.body.id }, t)))
          const rd = async (t) => { const r = await api('/rest/v1/stock_history?select=id', { token: t }); return Array.isArray(r.body) ? r.body.length : -1 }
          const seen = { anon: await rd(undefined), cust: await rd(cust.token), staff: await rd(staff.token) }
          const ins = await api('/rest/v1/stock_history', { token: staff.token, body: { ingredient_id: scalar("select id from ingredients limit 1"), delta: 1, source: 'x', source_id: crypto.randomUUID() } })
          sql("update ingredients set stock = reorder_level - 1 where name='มะนาว'")
          const low = async (t) => rpc('stock_low', {}, t); const ls = await low(staff.token), lc = await low(cust.token), la = await low(undefined), lf = await low(f.token)
          const names = (ls.body ?? []).map((x) => x.name), okLow = names.includes('มะนาว') && !names.includes('นมวัว') && ls.body?.[0] && ['name', 'unit', 'stock', 'reorder_level'].every((k) => k in ls.body[0])
          return { ok: direct.every((r) => !r.ok) && seen.anon <= 0 && seen.cust <= 0 && seen.staff >= 1 && !ins.ok && okLow && !lc.ok && !la.ok && !lf.ok, hint: `apply ตรง: ${direct.map((r) => r.status).join(',')} (ต้องถูกปฏิเสธ) · อ่านประวัติ ${JSON.stringify(seen)} · เขียนตรง ${ins.status} · stock_low พนักงาน ${ls.status} มีมะนาว=${names.includes('มะนาว')} (${names.join(',')}) ลูกค้า ${lc.status} anon ${la.status} ปลอม ${lf.status}` }
        } finally { await delUser(cust.id); await delUser(f.id) }
      })
    },
  },
  {
    part: 'break', name: 'test SQL ของ sales_summary และสต็อกมี (supabase/tests/*sales_summary*.sql, *stock*.sql) และ npm run test:db ผ่านทั้งหมด · ตัวเลือกสต็อกเก็บเป็นข้อมูลในตาราง option_ingredients',
    run: () => {
      const n_ = need(); if (n_) return n_
      const t = walk('supabase/tests'), a = t.some((f) => /sales_summary/i.test(f)), b = t.some((f) => /stock/i.test(f))
      if (!a || !b) return { ok: false, hint: `ต้องมี test SQL: sales_summary=${a} stock=${b}` }
      const opt = hasTable('option_ingredients') && Number(scalar('select count(*) from option_ingredients')) >= 3
      const r = run('bash', ['tools/dbtest.sh'])
      return { ok: r.ok && opt, hint: `test:db ${r.ok ? 'ผ่าน' : r.out.slice(-300)} · option_ingredients มีข้อมูล=${opt}` }
    },
  },
  // ---------- ต่อยอด: PWA ----------
  {
    part: 'extra', name: 'PWA: build ผ่าน · dist มี sw.js, manifest.webmanifest (name, short_name, start_url "/", display standalone, theme_color, ไอคอน 192 และ 512 ที่เป็น PNG ขนาดตรงจริง) · index.html ลิงก์ manifest + theme-color + viewport · service worker ไม่ cache คำขอ Supabase · ไม่มี secret key ใน bundle',
    run: () => {
      if (!walk('owner/src').some((f) => /\.tsx$/.test(f) && !/main\.tsx$/.test(f)) && /ยังไม่ได้ทำ/.test(read('owner/src/main.tsx'))) return { ok: false, hint: 'ยังไม่มีหน้าจอใน owner/src/' }
      const b = buildOwner(); if (b.status !== 0) return { ok: false, hint: `npm run build (owner/) ไม่ผ่าน: ${(b.stdout + b.stderr).slice(-300)}` }
      const d = join(root, 'owner/dist'); if (!existsSync(join(d, 'manifest.webmanifest')) || !existsSync(join(d, 'sw.js'))) return { ok: false, hint: 'dist/ ไม่มี manifest.webmanifest หรือ sw.js (วางไว้ใน owner/public/)' }
      let m; try { m = JSON.parse(readFileSync(join(d, 'manifest.webmanifest'), 'utf8')) } catch { return { ok: false, hint: 'manifest.webmanifest ไม่ใช่ JSON' } }
      const icon = (sz) => (m.icons ?? []).find((i) => String(i.sizes) === `${sz}x${sz}` && i.type === 'image/png')
      const sizes = [192, 512].map((s) => { const i = icon(s); if (!i) return `ไม่มีไอคอน ${s}`; const f = join(d, i.src.replace(/^\//, '')); const z = existsSync(f) ? pngSize(f) : null; return z && z[0] === s && z[1] === s ? null : `ไอคอน ${s} ไฟล์ไม่ตรง (${i.src} ${z})` }).filter(Boolean)
      const html = readFileSync(join(d, 'index.html'), 'utf8'), sw = readFileSync(join(d, 'sw.js'), 'utf8')
      const leak = walk('owner/dist').some((f) => /\.(js|html)$/.test(f) && read(f).includes(env().SUPABASE_SECRET_KEY))
      const okM = m.name && m.short_name && m.start_url === '/' && m.display === 'standalone' && m.theme_color && m.background_color
      const okH = /<link[^>]+rel=["']manifest["']/.test(html) && /<meta[^>]+name=["']theme-color["']/.test(html) && /<meta[^>]+name=["']viewport["']/.test(html)
      const swSafe = !/supabase|\/rest\/v1|\/auth\/v1|127\.0\.0\.1/.test(sw.replace(/\/\/.*$/gm, ''))
      return { ok: !!okM && okH && !sizes.length && swSafe && !leak, hint: `manifest ครบ=${!!okM} · index.html=${okH} · ${sizes.join('; ') || 'ไอคอนถูก'} · sw.js ไม่แตะ Supabase=${swSafe} · secret key ใน bundle=${leak}` }
    },
  },
  {
    part: 'extra', name: 'หน้าจอเจ้าของร้านจริง (Playwright + Supabase ในเครื่อง): ล็อกอินพนักงาน → today-total/today-bills/today-cups และ hour-bar-<ชั่วโมง> ตรงข้อมูลตัวอย่างวันที่ 2026-03-03 · stock-low-มะนาว ขึ้น · service worker ทำงาน แล้วปิดเน็ตรีโหลดยังเปิดเปลือกแอปได้',
    run: async () => {
      const n_ = need(); if (n_) return n_
      if (!existsSync(join(root, 'owner/dist/index.html'))) { const b = buildOwner(); if (b.status !== 0) return { ok: false, hint: `npm run build (owner/) ไม่ผ่าน: ${(b.stdout + b.stderr).slice(-300)}` } }
      return withStaff(async (staff) => {
        await seed(staff); sql("update ingredients set stock = reorder_level - 1 where name='มะนาว'")
        const want = expected(), srv = await serve(join(root, 'owner/dist')); const { chromium } = await import('playwright'); const browser = await chromium.launch()
        try {
          const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(), t = (id) => page.getByTestId(id)
          await page.goto(`${srv.url}/?day=${DAY}`); await t('login-email').fill(staff.email); await t('login-password').fill('Check-pass-123'); await t('login-submit').click()
          await t('today-total').waitFor({ timeout: 15000 }); await page.waitForTimeout(800)
          const got = { total: n(await t('today-total').innerText()), bills: n(await t('today-bills').innerText()), cups: n(await t('today-cups').innerText()) }
          const bad = []; if (got.total !== want.revenue || got.bills !== want.bills || got.cups !== want.cups) bad.push(`ตัวเลขบนจอ ${JSON.stringify(got)} ควร ${want.revenue}/${want.bills}/${want.cups}`)
          for (const [h, v] of Object.entries(want.by_hour)) { const el = t(`hour-bar-${h}`); if (!(await el.count())) { bad.push(`ไม่มีแท่ง hour-bar-${h}`); continue } const c = Number(await el.first().getAttribute('data-cups')); if (c !== v.cups) bad.push(`แท่ง ${h} data-cups ${c} ควร ${v.cups}`) }
          if (!(await t('stock-low-มะนาว').count())) bad.push('ไม่มี stock-low-มะนาว')
          const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return 'none'; const r = await navigator.serviceWorker.ready; return r.active ? 'active' : 'inactive' })
          await page.waitForTimeout(1500); await page.reload(); await page.waitForTimeout(1000)
          await ctx.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(1500)
          const shell = await page.evaluate(() => (document.getElementById('root')?.children.length ?? 0) > 0).catch(() => false)
          return { ok: !bad.length && sw === 'active' && shell, hint: `${bad.join(' | ') || 'ตัวเลขถูก'} · service worker=${sw} · ปิดเน็ตแล้วรีโหลดเห็นเปลือกแอป=${shell}` }
        } finally { await browser.close(); srv.close() }
      })
    },
  },
  {
    part: 'compare', name: 'มีใบเทียบ docs/เทียบ-22.md ที่บอกว่า prompt แรก (สั่งสั้น ๆ ก่อนมี brief) ทำให้ Claude ต้อง "เดา" อะไร และ brief เพิ่มอะไร',
    run: () => ({ ok: nonEmpty('docs/เทียบ-22.md') >= 5 && /เดา/.test(read('docs/เทียบ-22.md')), hint: 'ใบเทียบต้องมีอย่างน้อย 5 บรรทัดและใช้คำว่า "เดา" บอกว่ารอบแรก Claude ต้องเดาอะไร และ brief ที่ร้านส่งมาเพิ่มอะไร' }),
  },
]
