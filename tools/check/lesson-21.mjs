// ตัวตรวจบท 21: POS ตอนเน็ตหลุด — คิวฝั่ง client · API ฝั่งฐานข้อมูล idempotent คิดราคาเอง · ใบเสร็จ · หน้าจอออฟไลน์จริง (Playwright)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, createReadStream, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { exists, read, run, walk, root } from './lib.mjs'
import { rows, scalar, sql, dbUp } from './db.mjs'
import { api, env, rpc, newUser, delUser } from './api.mjs'
import { ref, catalog } from './lesson-20.mjs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const has = (f) => exists(`pos/src/${f}`)
const PHONE = '0900000021'
const MON = '2026-10-26T10:00:00+07:00'

function tsRun(code) {
  const d = mkdtempSync(join(tmpdir(), 'cafe-ts-')), f = join(d, 'run.mts'); writeFileSync(f, code)
  const r = spawnSync('node', ['--import', 'tsx', f], { cwd: root, encoding: 'utf8', timeout: 90000 })
  rmSync(d, { recursive: true, force: true })
  if (r.status !== 0) return { error: `${r.stdout}${r.stderr}`.slice(-500) }
  try { return { out: JSON.parse(r.stdout.trim().split('\n').pop()) } } catch { return { error: `อ่านผลไม่ได้: ${r.stdout.slice(0, 200)}` } }
}
const QIMP = `import { createBillQueue } from ${JSON.stringify(resolve(root, 'pos/src/queue.ts'))}
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m } }
const bill = (n) => ({ lines: [{ item: 'ลาเต้', qty: 1 }], cash_received: 100 + n })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
`
const NOQ = { ok: false, hint: 'ต้องมี pos/src/queue.ts ส่งออก createBillQueue ตาม briefs/offline.md' }

export const checks = [
  {
    part: 'win', name: 'คิวบิล: ปิด 3 บิลตอนเน็ตหลุด (send ล้ม) → id ไม่ซ้ำเป็น UUID, บันทึกลง storage ทันที, flush ไม่ส่งสำเร็จสักใบ แต่ไม่ทำบิลหาย · เปิดแอปใหม่ (คิวใหม่บน storage เดิม) เห็น 3 บิล id เดิม · เน็ตกลับ → ส่งครบ 3 ตามลำดับ ใบละครั้ง · flush ซ้ำไม่ส่งอีก',
    run: () => {
      if (!has('queue.ts')) return NOQ
      const r = tsRun(`${QIMP}
const kv = mem(); let up = false; const log = []
const send = async (b) => { log.push(b.client_order_id); if (!up) throw new Error('network'); }
const q = createBillQueue(kv, send)
const ids = [1, 2, 3].map((n) => q.enqueue(bill(n)))
const stored = [...kv.m.values()].join('|')
const f1 = await q.flush(); const p1 = q.pending().length
const q2 = createBillQueue(kv, send)
const again = q2.pending().map((b) => b.client_order_id)
up = true; log.length = 0
const f2 = await q2.flush(); const f3 = await q2.flush()
console.log(JSON.stringify({ ids: ids.map((b) => b.client_order_id), at: ids.map((b) => b.at), stored, f1, p1, again, f2, f3, log, left: q2.pending().length }))`)
      if (r.error) return { ok: false, hint: r.error }
      const o = r.out, id = o.ids
      const okIds = id.every((x) => UUID.test(x)) && new Set(id).size === 3 && o.at.every((a) => !Number.isNaN(Date.parse(a)))
      const persisted = id.every((x) => o.stored.includes(x))
      const ok = okIds && persisted && o.f1.sent === 0 && o.f1.failed >= 1 && o.f1.remaining === 3 && o.p1 === 3 && JSON.stringify(o.again) === JSON.stringify(id) &&
        o.f2.sent === 3 && o.f2.remaining === 0 && JSON.stringify(o.log) === JSON.stringify(id) && o.f3.sent === 0 && o.left === 0
      return { ok, hint: `id ถูก=${okIds} · บันทึกลง storage ทันที=${persisted} · flush ตอนเน็ตหลุด ${JSON.stringify(o.f1)} (ต้อง sent 0, failed ≥ 1, remaining 3) · เปิดใหม่เห็น id เดิม=${JSON.stringify(o.again) === JSON.stringify(id)} · เน็ตกลับ ${JSON.stringify(o.f2)} ส่งตามลำดับ=${JSON.stringify(o.log) === JSON.stringify(id)} · flush ซ้ำ ${JSON.stringify(o.f3)}` }
    },
  },
  {
    part: 'win', name: 'test ของคิว (pos/src/queue.test.ts) มีและผ่าน',
    run: () => {
      const t = walk('pos/src').filter((f) => /queue.*\.test\.ts$/.test(f))
      if (!t.length) return { ok: false, hint: 'ยังไม่มี pos/src/queue.test.ts' }
      const r = run('node', ['--import', 'tsx', '--test', ...t])
      return { ok: r.ok, hint: r.ok ? '' : r.out.slice(-400) }
    },
  },
  // ---- ลองพัง: คิว ----
  {
    part: 'break', name: 'คิว: flush พร้อมกัน 3 สาย → บิลละครั้งเดียว · ส่งล้มกลางคัน → ใบที่สำเร็จออกจากคิว ที่เหลืออยู่ตามลำดับ ส่งซ้ำด้วย id เดิม · error retryable:false → ไป dead() แล้วส่งใบถัดไปต่อ · ตอบ duplicate:true ถือว่าส่งแล้ว · enqueue ระหว่าง flush ไม่หาย',
    run: () => {
      if (!has('queue.ts')) return NOQ
      const r = tsRun(`${QIMP}
const out = {}
{ const kv = mem(); const sent = []; const q = createBillQueue(kv, async (b) => { await sleep(15); sent.push(b.client_order_id) })
  const ids = [1, 2, 3].map((n) => q.enqueue(bill(n)).client_order_id); await Promise.all([q.flush(), q.flush(), q.flush()])
  out.conc = { sent, ids, left: q.pending().length } }
{ const kv = mem(); const tries = {}; let failOnce = true; const q = createBillQueue(kv, async (b) => { tries[b.client_order_id] = (tries[b.client_order_id] ?? 0) + 1; if (b.cash_received === 102 && failOnce) { failOnce = false; throw new Error('network') } })
  const ids = [1, 2, 3].map((n) => q.enqueue(bill(n)).client_order_id); const a = await q.flush(); const mid = q.pending().map((b) => b.client_order_id); const b = await q.flush()
  out.mid = { a, mid, b, ids, tries, left: q.pending().length } }
{ const kv = mem(); const q = createBillQueue(kv, async (b) => { if (b.cash_received === 102) throw Object.assign(new Error('bad_qty: จำนวนผิด'), { retryable: false }) })
  const ids = [1, 2, 3].map((n) => q.enqueue(bill(n)).client_order_id); const a = await q.flush()
  out.dead = { a, ids, dead: q.dead().map((d) => ({ id: d.bill.client_order_id, error: d.error })), left: q.pending().length } }
{ const kv = mem(); const sent = []; const q = createBillQueue(kv, async (b) => { sent.push(b.client_order_id); return { duplicate: true } })
  const id = q.enqueue(bill(1)).client_order_id; const a = await q.flush(); out.dup = { a, id, sent, left: q.pending().length } }
{ const kv = mem(); const sent = []; let late = null; const q = createBillQueue(kv, async (b) => { sent.push(b.client_order_id); await sleep(30) })
  const id1 = q.enqueue(bill(1)).client_order_id; const p = q.flush(); await sleep(10); late = q.enqueue(bill(2)).client_order_id; await p; await q.flush()
  out.late = { sent, id1, late, left: q.pending().length } }
console.log(JSON.stringify(out))`)
      if (r.error) return { ok: false, hint: r.error }
      const { conc, mid, dead, dup, late } = r.out; const bad = []
      if (JSON.stringify([...conc.sent].sort()) !== JSON.stringify([...conc.ids].sort()) || conc.left) bad.push(`flush พร้อมกัน: ส่ง ${conc.sent.length} ครั้ง (ต้อง 3 id ละครั้ง) เหลือ ${conc.left}`)
      if (!(mid.a.sent === 1 && mid.mid.length === 2 && mid.mid[0] === mid.ids[1] && mid.mid[1] === mid.ids[2] && mid.b.sent === 2 && mid.left === 0 && mid.tries[mid.ids[1]] === 2 && mid.tries[mid.ids[0]] === 1)) bad.push(`ล้มกลางคัน: ${JSON.stringify(mid.a)} คิวที่เหลือ ${mid.mid.length} ส่งครั้งที่ 2 ${JSON.stringify(mid.b)} ครั้งส่งของใบที่ล้ม ${mid.tries[mid.ids[1]]}`)
      if (!(dead.a.sent === 2 && dead.a.dead === 1 && dead.dead.length === 1 && dead.dead[0].id === dead.ids[1] && /bad_qty/.test(dead.dead[0].error) && dead.left === 0)) bad.push(`dead: ${JSON.stringify(dead.a)} dead()=${dead.dead.length} เหลือ ${dead.left}`)
      if (!(dup.a.sent === 1 && dup.left === 0 && dup.sent.length === 1)) bad.push(`duplicate: ${JSON.stringify(dup.a)}`)
      if (!(late.sent.length === 2 && new Set(late.sent).size === 2 && late.left === 0 && late.sent.includes(late.late))) bad.push(`enqueue ระหว่าง flush: ส่ง ${late.sent.length} เหลือ ${late.left}`)
      return { ok: !bad.length, hint: bad.join(' · ') }
    },
  },
  // ---- ลองพัง: ฐานข้อมูล ----
  {
    part: 'break', name: 'API pos_record_bill: บิลเดียวกันส่งซ้ำ = 1 แถว (duplicate:true id เดิม) · ส่งพร้อมกัน 10 สายด้วย id เดียว = 1 แถว ไม่มี error · 10 บิลต่าง id พร้อมกัน code ไม่ซ้ำ รูปแบบ PB-YYYYMMDD-NNNN',
    run: async () => {
      const n = need(); if (n) return n
      const staff = await newUser('pos21', { appMetadata: { role: 'staff' } })
      try {
        const body = (id, extra = {}) => ({ p_client_order_id: id, p_lines: [{ item: 'ลาเต้', qty: 1, options: { size: 'M' } }], p_cash_received: 100, p_at: MON, p_customer_phone: PHONE, ...extra })
        const id = crypto.randomUUID(); const a = await rpc('pos_record_bill', body(id), staff.token), b = await rpc('pos_record_bill', body(id), staff.token)
        if (a.status !== 200) return { ok: false, hint: `เรียกครั้งแรกไม่ผ่าน (${a.status}): ${a.text.slice(0, 200)}` }
        const one = Number(scalar(`select count(*) from pos_bills where client_order_id='${id}'`))
        const id2 = crypto.randomUUID(); const par = await Promise.all(Array.from({ length: 10 }, () => rpc('pos_record_bill', body(id2), staff.token)))
        const one2 = Number(scalar(`select count(*) from pos_bills where client_order_id='${id2}'`)), okAll = par.every((r) => r.status === 200), dups = par.filter((r) => r.body?.duplicate === true).length
        const ids3 = Array.from({ length: 10 }, () => crypto.randomUUID()); const par3 = await Promise.all(ids3.map((i) => rpc('pos_record_bill', body(i), staff.token)))
        const codes = par3.map((r) => r.body?.code), fmt = codes.every((c) => /^PB-20261026-\d{4}$/.test(c ?? '')), uniq = new Set(codes).size === 10
        const items = Number(scalar(`select count(*) from pos_bill_items where bill_id='${a.body.id}'`))
        return { ok: b.body?.duplicate === true && a.body?.duplicate === false && b.body?.id === a.body?.id && one === 1 && one2 === 1 && okAll && dups === 9 && fmt && uniq && items === 1,
          hint: `ซ้ำ: duplicate=${b.body?.duplicate}/${a.body?.duplicate} id เดิม=${b.body?.id === a.body?.id} แถว ${one} · พร้อมกัน: แถว ${one2} สถานะ ${par.map((r) => r.status).join(',')} duplicate ${dups}/9 · code ${codes.slice(0, 3).join(',')} รูปแบบ=${fmt} ไม่ซ้ำ=${uniq} · รายการใน pos_bill_items ${items}` }
      } finally { sql(`delete from pos_bills where customer_phone='${PHONE}'`); await delUser(staff.id) }
    },
  },
  {
    part: 'break', name: 'API คิดเองฝั่งเซิร์ฟเวอร์: บิลสุ่ม 40 ใบ (ตัวเลือก แต้ม เงินรับ วันเสาร์/ข้ามเที่ยงคืน UTC) ได้ยอด/ลด/ทอน/แต้มตรงสูตรอ้างอิง · ข้อมูลผิด error code เดียวกับ bill.ts · ส่งยอดรวมมาเองไม่ได้',
    run: async () => {
      const n = need(); if (n) return n
      const staff = await newUser('pos21b', { appMetadata: { role: 'staff' } }); const cat = catalog()
      let s = 2121; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, pick = (a) => a[Math.floor(rnd() * a.length)]
      const lab = (k) => cat.options.filter((o) => o.kind === k).map((o) => o.label)
      const days = [MON, '2026-10-24T10:00:00+07:00', '2026-10-23T18:30:00Z', '2026-10-24T17:30:00Z']
      const cases = Array.from({ length: 40 }, () => {
        const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => { const it = pick(cat.items); const o = {}
          if (it.is_drink) { if (rnd() < 0.7) o.size = pick(lab('size')); if (rnd() < 0.5) o.milk = pick(lab('milk')); if (rnd() < 0.5) o.sweetness = pick(lab('sweetness')); if (rnd() < 0.3) o.extra_shots = Math.floor(rnd() * 5) }
          return { item: it.name, qty: 1 + Math.floor(rnd() * 4), ...(Object.keys(o).length ? { options: o } : {}) } })
        const c = { lines, at: pick(days) }; if (rnd() < 0.7) { c.points_balance = Math.floor(rnd() * 200); c.redeem_points = Math.floor(rnd() * 300) }; if (rnd() < 0.6) c.cash_received = 200 + Math.floor(rnd() * 800); return c
      })
      cases.push({ lines: [{ item: 'ลาเต้', qty: 1 }], at: MON, cash_received: 10 }, { lines: [{ item: 'ลาเต้ส้ม', qty: 1 }], at: MON }, { lines: [{ item: 'ลาเต้', qty: 0 }], at: MON }, { lines: [{ item: 'ครัวซองต์เนย', qty: 1, options: { size: 'L' } }], at: MON }, { lines: [{ item: 'ลาเต้', qty: 1 }], at: MON, redeem_points: -3, points_balance: 5 }, { lines: [], at: MON })
      const bad = []
      try {
        for (const [i, c] of cases.entries()) {
          const r = await rpc('pos_record_bill', { p_client_order_id: crypto.randomUUID(), p_lines: c.lines, p_redeem_points: c.redeem_points ?? 0, p_points_balance: c.points_balance ?? 0, p_cash_received: c.cash_received ?? null, p_at: c.at, p_customer_phone: PHONE }, staff.token)
          const w = ref(c, cat)
          if (w.throws) { if (r.ok || !String(r.body?.message ?? '').startsWith(`${w.throws}:`)) bad.push(`#${i} ควร ${w.throws} ได้ ${r.status} ${String(r.body?.message ?? '').slice(0, 50)}`) }
          else { const o = w.ok, g = r.body; if (!r.ok || g.subtotal !== o.subtotal || g.discount !== o.discount || g.total !== o.total || (g.change ?? null) !== o.change || g.points_earned !== o.points_earned || g.points_redeemed !== o.points_redeemed) bad.push(`#${i} ควร ${o.subtotal}/${o.discount}/${o.total}/${o.change}/${o.points_earned} ได้ ${r.ok ? [g.subtotal, g.discount, g.total, g.change, g.points_earned].join('/') : r.text.slice(0, 80)}`) }
        }
        const tamper = await rpc('pos_record_bill', { p_client_order_id: crypto.randomUUID(), p_lines: [{ item: 'ลาเต้', qty: 1 }], p_total: 1 }, staff.token)
        if (tamper.ok) bad.push('ส่ง p_total มาเองแล้วยังผ่าน (ต้องไม่รับยอดรวมจาก client)')
        const sat = scalar(`select points_earned from pos_bills where customer_phone='${PHONE}' and at='2026-10-23T18:30:00Z' limit 1`)
        return { ok: !bad.length, hint: bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … (ผิด ${bad.length}/${cases.length + 1})` : '') + (sat === null ? '' : '') }
      } finally { sql(`delete from pos_bills where customer_phone='${PHONE}'`); await delUser(staff.id) }
    },
  },
  {
    part: 'break', name: 'สิทธิ์: anon / ลูกค้า / ลูกค้าที่ตั้ง user_metadata.role=staff เอง เรียก pos_record_bill ไม่ได้ · เขียน pos_bills ตรง ๆ ไม่ได้แม้เป็นพนักงาน · ลูกค้าและ anon อ่านบิลไม่ได้ · พนักงานอ่านได้ · test SQL ของ pos_bills มีและ npm run test:db ผ่าน',
    run: async () => {
      const n = need(); if (n) return n
      const staff = await newUser('pos21c', { appMetadata: { role: 'staff' } }), cust = await newUser('pos21d')
      const e = env(), email = `check-forged21-${Date.now()}@example.invalid`
      const c = await api('/auth/v1/admin/users', { key: e.SUPABASE_SECRET_KEY, body: { email, password: 'Check-pass-123', email_confirm: true, user_metadata: { role: 'staff' } } })
      const forged = (await api('/auth/v1/token?grant_type=password', { body: { email, password: 'Check-pass-123' } })).body.access_token
      try {
        const call = (tok) => rpc('pos_record_bill', { p_client_order_id: crypto.randomUUID(), p_lines: [{ item: 'ลาเต้', qty: 1 }], p_customer_phone: PHONE, p_at: MON }, tok)
        const rs = { anon: await call(undefined), cust: await call(cust.token), forged: await call(forged) }
        const okCall = await call(staff.token)
        const ins = await api('/rest/v1/pos_bills', { token: staff.token, body: { client_order_id: crypto.randomUUID(), subtotal: 1, discount: 0, total: 1, points_earned: 0, points_redeemed: 0, at: MON } })
        const rd = async (tok) => { const r = await api('/rest/v1/pos_bills?select=id', { token: tok }); return Array.isArray(r.body) ? r.body.length : -1 }
        const seen = { anon: await rd(undefined), cust: await rd(cust.token), forged: await rd(forged), staff: await rd(staff.token) }
        const t = walk('supabase/tests').filter((f) => /pos_bills/i.test(f))
        const db = t.length ? run('bash', ['tools/dbtest.sh']) : { ok: false, out: 'ยังไม่มี supabase/tests/*pos_bills*.sql' }
        const ok = !rs.anon.ok && !rs.cust.ok && !rs.forged.ok && okCall.ok && !ins.ok && seen.anon <= 0 && seen.cust <= 0 && seen.forged <= 0 && seen.staff >= 1 && db.ok
        return { ok, hint: `เรียก: anon ${rs.anon.status} ลูกค้า ${rs.cust.status} ปลอมเป็นพนักงาน ${rs.forged.status} (ต้องไม่ผ่านทั้งหมด) พนักงาน ${okCall.status} · INSERT ตรงโดยพนักงาน ${ins.status} (ต้องถูกปฏิเสธ) · เห็นบิล: ${JSON.stringify(seen)} (anon/ลูกค้า/ปลอม ต้อง 0, พนักงานเห็น) · test:db ${db.ok ? 'ผ่าน' : db.out.slice(-250)}` }
      } finally { sql(`delete from pos_bills where customer_phone='${PHONE}'`); await delUser(staff.id); await delUser(cust.id); await delUser(c.body.id) }
    },
  },
  // ---- ต่อยอด: ใบเสร็จ + หน้าจอ ----
  {
    part: 'extra', name: 'ใบเสร็จ renderReceipt: ทุกบรรทัดกว้าง ≤ 32 คอลัมน์ (ไม่นับสระบน/วรรณยุกต์) แม้ชื่อร้านและรายการยาว · มีชื่อร้าน เลขบิล วันเวลาไทย รายการ ยอด ทอน แต้ม ขอบคุณ · ไม่มี undefined/NaN · ไม่ฝังชื่อร้านในโค้ด',
    run: () => {
      if (!has('receipt.ts') || !has('bill.ts')) return { ok: false, hint: 'ต้องมี pos/src/receipt.ts (renderReceipt) และ bill.ts' }
      const r = tsRun(`import { renderReceipt } from ${JSON.stringify(resolve(root, 'pos/src/receipt.ts'))}
import { computeBill } from ${JSON.stringify(resolve(root, 'pos/src/bill.ts'))}
const cat = ${JSON.stringify(catalog())}
const b1 = computeBill({ lines: [{ item: 'ลาเต้', qty: 2, options: { size: 'L', milk: 'โอ๊ต', sweetness: '50%', extra_shots: 2 } }, { item: 'ครัวซองต์เนย', qty: 1 }], redeem_points: 30, points_balance: 100, cash_received: 500, at: '2026-10-26T03:30:00Z' }, cat)
const b2 = computeBill({ lines: [{ item: 'เอสเปรสโซ', qty: 1 }], at: '2026-10-26T03:30:00Z' }, cat)
const a = renderReceipt(b1, { shop_name: 'ร้านกาแฟเรื่องเล่าเมืองเก่า สาขาริมน้ำ', bill_no: 'PB-20261026-0001', at: '2026-10-26T03:30:00Z' })
const b = renderReceipt(b2, { shop_name: 'Story Cafe', bill_no: 'PB-20261026-0002', at: '2026-10-26T03:30:00Z' })
console.log(JSON.stringify({ a, b, b1, b2 }))`)
      if (r.error) return { ok: false, hint: r.error }
      const { a, b, b1, b2 } = r.out; const w = (s) => [...s].filter((c) => !/[ัิ-ฺ็-๎]/.test(c)).length
      const all = [...a, ...b], okType = Array.isArray(a) && a.every((l) => typeof l === 'string') && Array.isArray(b)
      const wide = okType ? all.filter((l) => w(l) > 32) : []
      const A = a.join('\n'), B = b.join('\n')
      const hasAll = A.includes('PB-20261026-0001') && A.includes('26/10/2026 10:30') && A.includes(String(b1.total)) && A.includes(String(b1.change)) && A.includes('ขอบคุณ') && A.includes('เมืองเก่า') && A.includes(String(b1.lines[0].line_total)) && B.includes('Story Cafe') && B.includes(String(b2.total)) && B.includes('ขอบคุณ')
      const clean = !/undefined|NaN|null/.test(A + B)
      const hard = /Story Cafe/.test(read('pos/src/receipt.ts'))
      return { ok: okType && !wide.length && hasAll && clean && !hard, hint: `บรรทัดกว้างเกิน 32: ${wide.slice(0, 2).map((l) => `"${l}"`).join(' ') || 'ไม่มี'} · ข้อมูลครบ=${hasAll} · ไม่มี undefined/NaN=${clean} · ฝังชื่อร้านในโค้ด=${hard}` }
    },
  },
  {
    part: 'extra', name: 'หน้าจอจริง (build + Playwright + Supabase ในเครื่อง): ล็อกอินพนักงาน → ปิดเน็ต → บันทึก 3 บิลได้ (pending-count 1,2,3, ใบเสร็จขึ้นพร้อมชื่อร้านจาก settings, คิวอยู่ใน localStorage) → เปิดเน็ต → pending-count 0 ใน 20 วินาที, ฐานข้อมูลมี 3 แถวพอดี ไม่ซ้ำ · bundle ไม่มี secret key',
    run: async () => {
      const n = need(); if (n) return n
      if (!walk('pos/src').some((f) => /\.tsx$/.test(f) && !/main\.tsx$/.test(f)) && /ยังไม่ได้ทำ/.test(read('pos/src/main.tsx'))) return { ok: false, hint: 'ยังไม่มีหน้าจอ POS' }
      const E = env()
      const b = spawnSync('npm', ['run', 'build', '--silent'], { cwd: join(root, 'pos'), encoding: 'utf8', timeout: 170000, env: { ...process.env, VITE_SUPABASE_URL: E.SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: E.SUPABASE_PUBLISHABLE_KEY } })
      if (b.status !== 0) return { ok: false, hint: `npm run build (pos/) ไม่ผ่าน: ${(b.stdout + b.stderr).slice(-300)}` }
      const leak = walk('pos/dist').some((f) => /\.(js|html)$/.test(f) && read(f).includes(E.SUPABASE_SECRET_KEY))
      const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' }
      const dir = join(root, 'pos/dist')
      const srv = await new Promise((res) => { const s = createServer((q, a) => { let p = join(dir, decodeURIComponent(q.url.split('?')[0])); if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html'); a.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); createReadStream(p).pipe(a) }); s.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() })) })
      const staff = await newUser('pos21ui', { appMetadata: { role: 'staff' } })
      const { chromium } = await import('playwright'); const browser = await chromium.launch(); const shop = (scalar("select value #>> '{}' from settings where key='shop_name'") ?? '').trim()
      try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); const t = (id) => page.getByTestId(id)
        await page.goto(srv.url); await t('login-email').fill(staff.email); await t('login-password').fill('Check-pass-123'); await t('login-submit').click()
        await t('menu-เอสเปรสโซ').waitFor({ timeout: 15000 })
        await ctx.setOffline(true)
        const counts = [], receipts = []
        for (let i = 1; i <= 3; i++) {
          await t('menu-เอสเปรสโซ').click(); await t('add-line').click(); await t('cash-input').fill('100'); await page.waitForTimeout(100)
          await t('save-bill').click(); await page.waitForTimeout(400)
          counts.push(Number((await t('pending-count').innerText()).trim())); receipts.push(await t('receipt').innerText())
        }
        const stored = await page.evaluate(() => Object.values(localStorage).join('|')); const ids = new Set(stored.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])
        const inDb0 = Number(scalar(`select count(*) from pos_bills where staff='${staff.id}'`))
        await ctx.setOffline(false)
        let left = -1; for (let i = 0; i < 40; i++) { left = Number((await t('pending-count').innerText()).trim()); if (left === 0) break; await page.waitForTimeout(500) }
        await page.waitForTimeout(1500)
        const inDb = Number(scalar(`select count(*) from pos_bills where staff='${staff.id}'`)), distinct = Number(scalar(`select count(distinct client_order_id) from pos_bills where staff='${staff.id}'`))
        await page.reload(); await page.waitForTimeout(2500); await page.waitForTimeout(3500)
        const inDb2 = Number(scalar(`select count(*) from pos_bills where staff='${staff.id}'`))
        const okCounts = JSON.stringify(counts) === '[1,2,3]', okRec = receipts.every((r) => r.includes('เอสเปรสโซ') && (!shop || r.includes(shop)) && !/NaN|undefined/.test(r))
        return { ok: okCounts && okRec && ids.size >= 3 && inDb0 === 0 && left === 0 && inDb === 3 && distinct === 3 && inDb2 === 3 && !leak,
          hint: `pending-count ตอนออฟไลน์ ${JSON.stringify(counts)} (ต้อง [1,2,3]) · ใบเสร็จมีชื่อร้าน "${shop}" และรายการ=${okRec} · id ใน localStorage ${ids.size} · แถวใน DB ก่อนเน็ตกลับ ${inDb0} (ต้อง 0) · หลังเน็ตกลับ pending=${left} แถว ${inDb} (ไม่ซ้ำ ${distinct}) · หลังรีโหลด ${inDb2} (ต้อง 3) · secret key ใน bundle=${leak}` }
      } finally { await browser.close(); srv.close(); sql(`delete from pos_bills where staff='${staff.id}'`); await delUser(staff.id) }
    },
  },
]
