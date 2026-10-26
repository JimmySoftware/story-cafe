// test ของ payment_webhook: ลองยิงของปลอมทุกแบบ — ต้องไม่ทำให้ออเดอร์กลายเป็น paid ผิด ๆ
// ฐานข้อมูลจำลองในหน่วยความจำทำตามกติกาเดียวกับ mark_order_paid / record_stripe_event ใน migration (ของจริงทดสอบใน supabase/tests/09_payment_webhook.sql)
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error ไฟล์ .mjs ไม่มี type
import { signStripe } from '../../../tools/fakes/stripe.mjs'
import handler, { type Deps } from './handler.ts'

const WH = 'whsec_unittestunittest01'
type Order = { code: string; status: string; total: number }
type Payment = { provider_ref: string; status: string }

function fakeDb(orders: Order[], payments: Payment[] = [], opts: { failMark?: boolean } = {}) {
  const events = new Set<string>()
  const db = {
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn === 'record_stripe_event') {
        if (events.has(a.p_id as string)) return { data: false, error: null }
        events.add(a.p_id as string); return { data: true, error: null }
      }
      if (fn === 'mark_order_paid') {
        if (opts.failMark) return { data: null, error: { message: 'connection reset' } }
        const o = orders.find((x) => x.code === a.p_code)
        if (!o) return { data: null, error: { message: 'not_found' } }
        if (o.status === 'paid') return { data: { already: true }, error: null }
        if (o.status !== 'pending') return { data: null, error: { message: 'not_pending' } }
        if (a.p_amount !== o.total) return { data: null, error: { message: 'amount_mismatch' } }
        o.status = 'paid'; for (const p of payments) if (p.provider_ref === a.p_ref) p.status = 'succeeded'
        return { data: { status: 'paid' }, error: null }
      }
      throw new Error(`rpc ที่ไม่รู้จัก ${fn}`)
    },
    from: (table: string) => ({
      delete: () => ({ eq: async (_: string, id: string) => { assert.equal(table, 'stripe_events'); events.delete(id); return { error: null } } }),
      update: (patch: { status: string }) => ({ eq: (_k: string, ref: string) => ({ eq: async (_k2: string, st: string) => { for (const p of payments) if (p.provider_ref === ref && p.status === st) p.status = patch.status; return { error: null } } }) }),
    }),
  }
  return { deps: { env: { STRIPE_WEBHOOK_SECRET: WH }, fetch, db: db as unknown as Deps['db'] } as Deps, events }
}

const evt = (id: string, type: string, code: string, amount = 38000, pi = 'pi_1') =>
  JSON.stringify({ id, object: 'event', type, created: 1, data: { object: { id: pi, object: 'payment_intent', amount, amount_received: type.endsWith('succeeded') ? amount : 0, currency: 'thb', metadata: { order_code: code } } } })
const send = (deps: Deps, body: string, sig: string | null) =>
  handler(new Request('http://x/payment_webhook', { method: 'POST', headers: sig === null ? {} : { 'stripe-signature': sig }, body }), deps)
const now = () => Math.floor(Date.now() / 1000)
const mk = () => fakeDb([{ code: 'SH-1111', status: 'pending', total: 380 }], [{ provider_ref: 'pi_1', status: 'created' }])

test('ลายเซ็นถูก → ออเดอร์ paid และ payments succeeded', async () => {
  const { deps } = mk(); const body = evt('evt_1', 'payment_intent.succeeded', 'SH-1111')
  const r = await send(deps, body, signStripe(body, WH))
  assert.equal(r.status, 200)
  const orders = (await deps.db.rpc('mark_order_paid', { p_code: 'SH-1111', p_ref: 'pi_1', p_amount: 380 })).data
  assert.deepEqual(orders, { already: true })
})

// ของปลอมทุกแบบต้อง 400 และออเดอร์ยัง pending และ event ไม่ถูกบันทึก
const forgeries: [string, (body: string) => { body: string; sig: string | null }][] = [
  ['ลายเซ็นผิด (แก้ body หลังลงนาม)', (b) => ({ body: b.replace('38000', '1'), sig: signStripe(b, WH) })],
  ['กุญแจผิด', (b) => ({ body: b, sig: signStripe(b, 'whsec_other') })],
  ['timestamp เก่าเกิน 5 นาที', (b) => ({ body: b, sig: signStripe(b, WH, now() - 301) })],
  ['timestamp ล่วงหน้าเกิน 5 นาที', (b) => ({ body: b, sig: signStripe(b, WH, now() + 3600) })],
  ['ไม่มี header', (b) => ({ body: b, sig: null })],
  ['มีแต่ v0 ไม่มี v1', (b) => ({ body: b, sig: signStripe(b, WH).replace('v1=', 'v0=') })],
  ['v1 ไม่ใช่ hex / สั้นเกิน', (b) => ({ body: b, sig: `t=${now()},v1=zz` })],
  ['t ไม่ใช่ตัวเลข', (b) => ({ body: b, sig: signStripe(b, WH).replace(/t=\d+/, 't=abc') })],
  ['body ขยะ + ลายเซ็นมั่ว', () => ({ body: '<<<ไม่ใช่ json>>>', sig: 't=1,v1=00' })],
  ['body ขยะ + ลายเซ็นของ body จริง', (b) => ({ body: '<<<ไม่ใช่ json>>>', sig: signStripe(b, WH) })],
]
for (const [name, forge] of forgeries) {
  test(`ของปลอม: ${name} → 400 ออเดอร์ไม่ถูกแตะ`, async () => {
    const { deps, events } = mk(); const f = forge(evt('evt_f', 'payment_intent.succeeded', 'SH-1111'))
    const r = await send(deps, f.body, f.sig)
    assert.equal(r.status, 400)
    const text = await r.text()
    assert.doesNotMatch(text, /whsec_/)
    assert.equal(events.size, 0)
    assert.equal((await deps.db.rpc('mark_order_paid', { p_code: 'SH-1111', p_ref: 'x', p_amount: 1 })).error?.message, 'amount_mismatch') // ยัง pending (ถ้า paid จะได้ already)
  })
}

test('body ขยะแต่ลงนามถูก → 400 (ไม่ใช่ 500) และไม่บันทึก event', async () => {
  const { deps, events } = mk(); const body = '<<<ไม่ใช่ json>>>'
  const r = await send(deps, body, signStripe(body, WH))
  assert.equal(r.status, 400)
  assert.equal(events.size, 0)
})

test('มี v1 ผิดปนกับ v1 ถูก (ช่วงเปลี่ยนกุญแจของ Stripe) → ผ่านเพราะมีตัวที่ถูก', async () => {
  const { deps } = mk(); const body = evt('evt_2', 'payment_intent.succeeded', 'SH-1111'); const t = now()
  const good = signStripe(body, WH, t).split(',v1=')[1], bad = signStripe(body, 'whsec_other', t).split(',v1=')[1]
  assert.equal((await send(deps, body, `t=${t},v1=${bad},v1=${good}`)).status, 200)
})

test('event ซ้ำ → 200 duplicate ไม่ทำซ้ำ', async () => {
  const orders = [{ code: 'SH-1111', status: 'pending', total: 380 }]
  const { deps } = fakeDb(orders); const body = evt('evt_dup', 'payment_intent.succeeded', 'SH-1111'); const sig = signStripe(body, WH)
  assert.equal((await send(deps, body, sig)).status, 200)
  assert.equal(orders[0].status, 'paid')
  orders[0].status = 'pending' // ถ้า event ซ้ำทำงานซ้ำ ออเดอร์จะกลับไป paid
  const r = await send(deps, body, sig)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { duplicate: true })
  assert.equal(orders[0].status, 'pending')
})

test('ยอดไม่ตรง → 400 amount_mismatch ออเดอร์ไม่เปลี่ยน', async () => {
  const { deps } = mk(); const body = evt('evt_m', 'payment_intent.succeeded', 'SH-1111', 100) // ออเดอร์ 380 บาท จ่ายมา 1 บาท
  const r = await send(deps, body, signStripe(body, WH))
  assert.equal(r.status, 400)
  assert.deepEqual(await r.json(), { error: 'amount_mismatch' })
  assert.equal((await deps.db.rpc('mark_order_paid', { p_code: 'SH-1111', p_ref: 'x', p_amount: 1 })).error?.message, 'amount_mismatch')
})

test('amount_received ไม่ใช่จำนวนบาทเต็ม / ไม่มีรหัสออเดอร์ → 400 ไม่เปลี่ยนออเดอร์', async () => {
  const { deps } = mk()
  for (const body of [evt('evt_a', 'payment_intent.succeeded', 'SH-1111', 38050), evt('evt_b', 'payment_intent.succeeded', '')]) {
    assert.equal((await send(deps, body, signStripe(body, WH))).status, 400)
  }
  assert.equal((await deps.db.rpc('mark_order_paid', { p_code: 'SH-1111', p_ref: 'x', p_amount: 1 })).error?.message, 'amount_mismatch')
})

test('ออเดอร์ที่ไม่มี → 400 order_not_found', async () => {
  const { deps } = mk(); const body = evt('evt_n', 'payment_intent.succeeded', 'SH-9999')
  const r = await send(deps, body, signStripe(body, WH))
  assert.equal(r.status, 400)
  assert.deepEqual(await r.json(), { error: 'order_not_found' })
})

test('payment_failed → payments failed ออเดอร์ยัง pending · event อื่น → 200 ข้าม', async () => {
  const payments = [{ provider_ref: 'pi_1', status: 'created' }]
  const { deps } = fakeDb([{ code: 'SH-1111', status: 'pending', total: 380 }], payments)
  const f = evt('evt_x', 'payment_intent.payment_failed', 'SH-1111')
  assert.equal((await send(deps, f, signStripe(f, WH))).status, 200)
  assert.equal(payments[0].status, 'failed')
  const o = evt('evt_y', 'charge.refunded', 'SH-1111')
  assert.equal((await send(deps, o, signStripe(o, WH))).status, 200)
  assert.equal((await deps.db.rpc('mark_order_paid', { p_code: 'SH-1111', p_ref: 'x', p_amount: 1 })).error?.message, 'amount_mismatch')
})

test('ฐานข้อมูลล้มระหว่างทำ → 500 และคืน event id ให้ Stripe ส่งซ้ำแล้วสำเร็จ ไม่ใช่ถูกข้ามเป็น duplicate', async () => {
  const orders = [{ code: 'SH-1111', status: 'pending', total: 380 }]
  const bad = fakeDb(orders, [], { failMark: true }); const body = evt('evt_r', 'payment_intent.succeeded', 'SH-1111'); const sig = signStripe(body, WH)
  const r = await send(bad.deps, body, sig)
  assert.equal(r.status, 500)
  assert.deepEqual(await r.json(), { error: 'server_error' }) // ไม่หลุดข้อความ error ดิบ
  assert.equal(bad.events.size, 0)
  const good = fakeDb(orders)
  assert.equal((await send(good.deps, body, sig)).status, 200)
  assert.equal(orders[0].status, 'paid')
})

test('ไม่ตั้ง STRIPE_WEBHOOK_SECRET → ไม่รับอะไรเลย (500) · ไม่ใช่ POST → 405', async () => {
  const { deps } = mk(); const body = evt('evt_s', 'payment_intent.succeeded', 'SH-1111')
  assert.equal((await send({ ...deps, env: {} }, body, signStripe(body, ''))).status, 500)
  assert.equal((await handler(new Request('http://x/', { method: 'GET' }), deps)).status, 405)
})
