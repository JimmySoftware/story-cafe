// test ของ create_payment: Stripe จำลอง (tools/fakes/stripe.mjs) + ฐานข้อมูลจำลองในหน่วยความจำ ไม่ต้องเปิด Supabase
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error ไฟล์ .mjs ไม่มี type
import { startFakeStripe } from '../../../tools/fakes/stripe.mjs'
import handler, { type Deps } from './handler.ts'

type Order = { id: string; code: string; user_id: string; status: string; total: number }
const USER = 'user-1', OTHER = 'user-2'
let fake: Awaited<ReturnType<typeof startFakeStripe>>
before(async () => { fake = await startFakeStripe() })
after(async () => { await fake.close() })

function fakeDb(orders: Order[]) {
  const payments: Record<string, unknown>[] = []
  const db = {
    auth: { getUser: async (jwt: string) => (jwt === 'jwt-1' ? { data: { user: { id: USER } }, error: null } : jwt === 'jwt-2' ? { data: { user: { id: OTHER } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }) },
    from: (table: string) => {
      if (table === 'shop_orders') {
        const f: Record<string, string> = {}
        const q = { select: () => q, eq: (k: string, v: string) => ((f[k] = v), q), maybeSingle: async () => ({ data: orders.find((o) => o.code === f.code && o.user_id === f.user_id) ?? null, error: null }) }
        return q
      }
      return {
        upsert: async (row: Record<string, unknown>, opts: { onConflict: string; ignoreDuplicates: boolean }) => {
          assert.equal(opts.onConflict, 'order_id')
          if (!payments.some((p) => p.order_id === row.order_id)) payments.push(row)
          return { error: null }
        },
      }
    },
  }
  return { db: db as unknown as Deps['db'], payments }
}
const order = (o: Partial<Order> = {}): Order => ({ id: 'o-1', code: 'SH-1234', user_id: USER, status: 'pending', total: 380, ...o })
const env = (o: Record<string, string> = {}) => ({ STRIPE_API_BASE: fake.url, STRIPE_SECRET_KEY: fake.secretKey, ...o })
const call = (deps: Deps, body: unknown = { order_code: 'SH-1234' }, jwt: string | null = 'jwt-1') =>
  handler(new Request('http://x/create_payment', { method: 'POST', headers: { ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }), deps)
const stripeCalls = () => fake.log.filter((l: { path: string }) => l.path === '/v1/payment_intents')

test('ขอจ่ายสำเร็จ: ยอดจากฐานข้อมูล (สตางค์), ส่ง Stripe ครบ, เก็บ payments', async () => {
  const before = stripeCalls().length
  const { db, payments } = fakeDb([order()])
  const r = await call({ env: env(), fetch, db }, { order_code: 'SH-1234', amount: 1, total: 1 })
  const body = await r.json()
  assert.equal(r.status, 200)
  assert.equal(body.amount_thb, 380)
  assert.match(body.payment_intent_id, /^pi_/)
  assert.ok(body.client_secret)
  const sent = stripeCalls().slice(before)
  assert.equal(sent.length, 1)
  const f = new URLSearchParams(sent[0].body)
  assert.equal(f.get('amount'), '38000')
  assert.equal(f.get('currency'), 'thb')
  assert.deepEqual(f.getAll('payment_method_types[]'), ['promptpay'])
  assert.equal(f.get('metadata[order_code]'), 'SH-1234')
  assert.equal(sent[0].idempotencyKey, 'order-SH-1234')
  assert.equal(sent[0].auth, `Bearer ${fake.secretKey}`)
  assert.deepEqual(payments, [{ order_id: 'o-1', provider_ref: body.payment_intent_id, amount: 380, status: 'created' }])
})

test('กดซ้ำได้ PaymentIntent เดิมและมี payments แถวเดียว', async () => {
  const { db, payments } = fakeDb([order()])
  const a = await (await call({ env: env(), fetch, db })).json()
  const b = await (await call({ env: env(), fetch, db })).json()
  assert.equal(a.payment_intent_id, b.payment_intent_id)
  assert.equal(payments.length, 1)
})

test('ไม่มี/ผิด JWT → 401', async () => {
  const { db } = fakeDb([order()])
  assert.equal((await call({ env: env(), fetch, db }, undefined, null)).status, 401)
  assert.equal((await call({ env: env(), fetch, db }, undefined, 'junk')).status, 401)
})

test('ออเดอร์คนอื่นกับออเดอร์ที่ไม่มี → 404 ข้อความเดียวกัน', async () => {
  const { db } = fakeDb([order()])
  const other = await call({ env: env(), fetch, db }, undefined, 'jwt-2')
  const none = await call({ env: env(), fetch, db }, { order_code: 'SH-0000' })
  assert.equal(other.status, 404)
  assert.equal(none.status, 404)
  assert.equal(await other.text(), await none.text())
})

test('ออเดอร์ไม่ใช่ pending → 409 และไม่เรียก Stripe', async () => {
  const n = stripeCalls().length
  const { db } = fakeDb([order({ status: 'paid' })])
  assert.equal((await call({ env: env(), fetch, db })).status, 409)
  assert.equal(stripeCalls().length, n)
})

test('body ไม่ใช่ JSON หรือไม่มี order_code → 400', async () => {
  const { db } = fakeDb([order()])
  assert.equal((await call({ env: env(), fetch, db }, 'ไม่ใช่ json')).status, 400)
  assert.equal((await call({ env: env(), fetch, db }, {})).status, 400)
})

test('key sk_live_ → ปฏิเสธและไม่เรียก Stripe', async () => {
  const n = stripeCalls().length
  const { db } = fakeDb([order()])
  const r = await call({ env: env({ STRIPE_SECRET_KEY: 'sk_live_notrealnotreal' }), fetch, db })
  assert.equal(r.status, 500)
  assert.ok(!(await r.text()).includes('sk_live_'))
  assert.equal(stripeCalls().length, n)
})

test('Stripe ตอบ error → 502 ไม่หลุดข้อความหรือ key และไม่เก็บ payments', async () => {
  const { db, payments } = fakeDb([order()])
  const r = await call({ env: env({ STRIPE_SECRET_KEY: 'sk_test_wrongwrongwrong' }), fetch, db })
  const text = await r.text()
  assert.equal(r.status, 502)
  assert.deepEqual(JSON.parse(text), { error: 'payment_provider_error' })
  assert.doesNotMatch(text, /sk_test_|Invalid API Key|invalid_request_error/)
  assert.equal(payments.length, 0)
})

test('ต่อ Stripe ไม่ได้ (fetch throw) → 502', async () => {
  const { db } = fakeDb([order()])
  const r = await call({ env: env(), fetch: (async () => { throw new Error('boom sk_test_secret') }) as typeof fetch, db })
  assert.equal(r.status, 502)
  assert.doesNotMatch(await r.text(), /boom|sk_test_/)
})
