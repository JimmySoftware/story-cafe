// e2e ทั้งระบบของ Story Cafe (บท 24 "เปิดร้านจริง") — ไฟล์สำเร็จ ผู้เรียนรันเองเพื่อดูว่าทุกชิ้นต่อกันได้
// ใช้: node tools/e2e/run.mjs [--json] · ต้องมี Supabase ในเครื่องรันอยู่ (npx supabase start + db reset) · ใช้ Stripe/LINE จำลอง ไม่แตะบริการจริง
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { rows, scalar, sql, dbUp } from '../check/db.mjs'
import { api, rpc, newUser, delUser, env } from '../check/api.mjs'
import { serve, post } from '../check/fn.mjs'
import { startFakeLine } from '../fakes/line.mjs'
import { startFakeStripe } from '../fakes/stripe.mjs'
import { exists } from '../check/lib.mjs'

const OWNER = 'U0123456789abcdef0123456789abcdef', WH = 'whsec_e2ee2ee2ee2e'
const tmr = (h) => `((now() at time zone 'Asia/Bangkok')::date + 1 + time '${h}') at time zone 'Asia/Bangkok'`
const S = {}                      // สถานะที่ส่งต่อระหว่างขั้น
const cleanup = []

export const stages = [
  ['ฐานข้อมูลในเครื่องพร้อม', async () => { if (!dbUp()) throw new Error('ติดต่อฐานข้อมูลไม่ได้ — npx supabase start && npx supabase db reset'); S.staff = await newUser('e2e', { appMetadata: { role: 'staff' } }); S.cust = await newUser('e2ec'); cleanup.push(() => delUser(S.staff.id), () => delUser(S.cust.id)); return 'ok' }],
  ['พรีออเดอร์ (ลูกค้าเว็บ → place_preorder → เข้าคิวแจ้งเตือน)', async () => {
    sql("update notify_queue set status='sent' where status='pending'")
    const r = await rpc('place_preorder', { p_name: 'e2e', p_phone: '0900000099', p_pickup: scalar(`select ${tmr('16:30')}`), p_items: [{ menu_item_id: scalar("select id from menu_items where name='ลาเต้'"), qty: 1, options: [] }] })
    if (!r.ok) throw new Error(`place_preorder ${r.status}: ${r.text.slice(0, 120)}`)
    S.code = r.body.code; cleanup.push(() => { sql("delete from notify_queue where payload->>'code' in (select code from orders where phone='0900000099')"); sql("delete from orders where phone='0900000099'"); sql('delete from pickup_slots where slot_start not in (select pickup_at from orders)') })
    const q = scalar(`select status from notify_queue where dedupe_key='order_placed:${S.code}'`); if (q !== 'pending') throw new Error(`คิวแจ้งเตือนของ ${S.code} = ${q}`)
    return S.code
  }],
  ['แจ้งเจ้าของร้านทาง LINE (notify_owner → LINE จำลอง ส่งครั้งเดียว)', async () => {
    const fake = await startFakeLine(); const s = await serve('notify_owner', { LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token, LINE_OWNER_USER_ID: OWNER })
    try { const r = await post(s.url, {}); const p = fake.log.filter((l) => l.path === '/v2/bot/message/push'); if (r.status !== 200 || p.length !== 1 || !p[0].body.includes(S.code)) throw new Error(`notify ${r.status} push ${p.length}`); return 'ส่ง 1 ข้อความ' } finally { s.stop(); await fake.close() }
  }],
  ['จ่ายเงินออนไลน์ (create_order → create_payment → Stripe จำลองยิง webhook ลงนาม → paid)', async () => {
    const o = await rpc('create_order', { p_items: [{ sku: 'beans-250', qty: 1 }], p_ship: { name: 'e2e', phone: '0900000099', address: 'ที่อยู่สมมติ' } }, S.cust.token); if (!o.ok) throw new Error(`create_order ${o.status}: ${o.text.slice(0, 100)}`)
    cleanup.push(() => { sql("delete from payment_slips where order_id in (select id from shop_orders where ship_phone='0900000099')"); sql("delete from payments where order_id in (select id from shop_orders where ship_phone='0900000099')"); sql("delete from notify_queue where payload->>'code' in (select code from shop_orders where ship_phone='0900000099')"); sql("delete from shop_orders where ship_phone='0900000099'"); sql("delete from stripe_events where id like 'evt_fake_%'") })
    const fake = await startFakeStripe({ webhookSecret: WH }); const e = { STRIPE_API_BASE: fake.url, STRIPE_SECRET_KEY: fake.secretKey, STRIPE_WEBHOOK_SECRET: WH }
    const cp = await serve('create_payment', e), wh = await serve('payment_webhook', e)
    try {
      const p = await post(cp.url, { order_code: o.body.code }, { authorization: `Bearer ${S.cust.token}` }); if (p.status !== 200) throw new Error(`create_payment ${p.status}`)
      const f = await (await fetch(`${fake.url}/__fire`, { method: 'POST', body: JSON.stringify({ payment_intent: p.json.payment_intent_id, type: 'payment_intent.succeeded', url: wh.url }) })).json()
      const st = scalar(`select status from shop_orders where code='${o.body.code}'`); if (f.delivered_status !== 200 || st !== 'paid') throw new Error(`webhook ${f.delivered_status} สถานะ ${st}`); return `${o.body.code} paid`
    } finally { cp.stop(); wh.stop(); await fake.close(); sql("update products set stock = stock + 1 where sku='beans-250'") }
  }],
  ['POS: ปิดบิลตอนเน็ตหลุดแล้วส่งซ้ำตอนเน็ตกลับ → มีบิลเดียว (client_order_id)', async () => {
    S.cid = crypto.randomUUID()
    const args = { p_client_order_id: S.cid, p_lines: [{ item: 'ลาเต้', qty: 2, options: { milk: 'โอ๊ต', extra_shots: 1 } }, { item: 'ครัวซองต์เนย', qty: 1 }], p_cash_received: 500, p_at: new Date().toISOString(), p_customer_phone: '0900000099' }
    const a = await rpc('pos_record_bill', args, S.staff.token), b = await rpc('pos_record_bill', args, S.staff.token)
    if (!a.ok || !b.ok) throw new Error(`pos_record_bill ${a.status}/${b.status}: ${(a.ok ? b : a).text.slice(0, 120)}`)
    S.bill = a.body; cleanup.push(() => { sql("delete from stock_history where source_id in (select id from pos_bills where customer_phone='0900000099')"); sql("delete from pos_bills where customer_phone='0900000099'") })
    const n = Number(scalar(`select count(*) from pos_bills where client_order_id='${S.cid}'`)); if (n !== 1 || b.body.id !== a.body.id) throw new Error(`บิลซ้ำ ${n} แถว`)
    return `${a.body.code ?? a.body.id} ยอด ${a.body.total}`
  }],
  ['เจ้าของร้านเห็นยอด: sales_summary รวมทุกช่องทางในฟังก์ชันเดียว', async () => {
    const r = await rpc('sales_summary', { p_day: scalar("select (now() at time zone 'Asia/Bangkok')::date::text") }, S.staff.token); if (!r.ok) throw new Error(`sales_summary ${r.status}: ${r.text.slice(0, 100)}`)
    if (!(r.body.revenue >= S.bill.total) || !(r.body.bills >= 1)) throw new Error(`ยอดรวม ${r.body.revenue} น้อยกว่าบิล ${S.bill.total}`)
    return `ยอดวันนี้ ${r.body.revenue} บาท ${r.body.bills} บิล`
  }],
  ['สต็อกตัดตามสูตร (stock_history ของบิลนี้ ไม่ตัดซ้ำเมื่อส่งซ้ำ)', async () => {
    const n = Number(scalar(`select count(*) from stock_history where source_id='${S.bill.id}'`)); if (n < 1) throw new Error('ไม่มี stock_history ของบิลนี้')
    const d = Number(scalar(`select count(*) from (select ingredient_id from stock_history where source_id='${S.bill.id}' group by 1 having count(*) > 1) x`)); if (d) throw new Error('ตัดสต็อกซ้ำ')
    return `${n} รายการ`
  }],
  ['สำรองข้อมูลแล้วกู้คืนทดสอบได้ (tools/backup.sh → tools/restore-check.sh)', async () => {
    if (!exists('tools/backup.sh') || !exists('tools/restore-check.sh')) throw new Error('ยังไม่มี tools/backup.sh หรือ tools/restore-check.sh')
    const d = mkdtempSync(join(tmpdir(), 'cafe-e2e-bk-')); cleanup.push(() => rmSync(d, { recursive: true, force: true }))
    const b = spawnSync('bash', ['tools/backup.sh'], { encoding: 'utf8', env: { ...process.env, CAFE_BACKUP_DIR: d }, timeout: 300000 }); if (b.status !== 0) throw new Error(`backup exit ${b.status}: ${(b.stdout + b.stderr).slice(-150)}`)
    const f = (b.stdout.match(/(\S+\.sql(?:\.gz)?)/) ?? [])[1]; if (!f) throw new Error('backup.sh ต้องพิมพ์ชื่อไฟล์ .sql')
    const r = spawnSync('bash', ['tools/restore-check.sh', f.startsWith('/') ? f : join(process.cwd(), f)], { encoding: 'utf8', timeout: 600000 }); if (r.status !== 0) throw new Error(`restore-check exit ${r.status}: ${(r.stdout + r.stderr).slice(-200)}`)
    return 'กู้คืนตรงกับของจริง'
  }],
  ['rls_audit ว่าง (ทุกตารางเปิด RLS · ไม่มีสิทธิ์เขียนของ anon)', async () => {
    const r = await api('/rest/v1/rpc/rls_audit', { key: env().SUPABASE_SECRET_KEY, body: {} }); if (!r.ok) throw new Error(`rls_audit ${r.status}: ${r.text.slice(0, 100)}`)
    const f = Array.isArray(r.body) ? r.body : []; if (f.length) throw new Error(`พบ ${f.length} จุด: ${JSON.stringify(f).slice(0, 160)}`); return 'ไม่พบจุดรั่ว'
  }],
]

const results = []
for (const [name, fn] of stages) {
  try { results.push({ name, ok: true, hint: await fn() }) } catch (e) { results.push({ name, ok: false, hint: String(e.message ?? e) }); if (name.startsWith('ฐานข้อมูล')) break }
}
for (const c of cleanup.reverse()) { try { await c() } catch { /* ล้างไม่ได้ก็ข้าม */ } }
if (process.argv.includes('--json')) console.log(JSON.stringify(results))
else { for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.hint ? ` — ${r.hint}` : ''}`); console.log(results.every((r) => r.ok) ? '\nทั้งระบบต่อกันได้ 🎉' : `\nตก ${results.filter((r) => !r.ok).length} ขั้น`) }
process.exit(results.every((r) => r.ok) ? 0 : 1)
