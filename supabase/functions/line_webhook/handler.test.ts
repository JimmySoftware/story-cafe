// test ของ line_webhook: ยิงกับ LINE จำลอง (tools/fakes/line.mjs) ลงนามด้วย signLine · ฐานข้อมูลจำลองทำตามกติกาเดียวกับ migration
// (ของจริงทดสอบใน supabase/tests/12_morning_summary.sql)
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error ไฟล์ .mjs ไม่มี type
import { startFakeLine, signLine } from '../../../tools/fakes/line.mjs'
import handler, { type Deps } from './handler.ts'

const OWNER = 'U0123456789abcdef0123456789abcdef'
const STRANGER = 'Uffffffffffffffffffffffffffffffff'
const SECRET = '0123456789abcdef0123456789abcdef'

function fakeDb(orders: Record<string, string>, opts: { eventsFail?: boolean } = {}) {
  const seen = new Set<string>(); const calls: string[] = []
  const db = {
    rpc: async (fn: string, a: Record<string, string>) => {
      calls.push(fn)
      if (fn === 'record_line_event') {
        if (opts.eventsFail) return { data: null, error: { message: 'boom' } }
        const fresh = !seen.has(a.p_id); seen.add(a.p_id); return { data: fresh, error: null }
      }
      if (fn === 'confirm_preorder') {
        const st = orders[a.p_code]
        if (st === undefined) return { data: null, error: { message: 'not_found' } }
        if (st === 'confirmed') return { data: { already: true }, error: null }
        if (st !== 'placed') return { data: null, error: { message: 'bad_status' } }
        orders[a.p_code] = 'confirmed'
        return { data: { code: a.p_code, status: 'confirmed' }, error: null }
      }
      throw new Error(`rpc ที่ไม่รู้จัก ${fn}`)
    },
    from: () => ({ select: () => ({ eq: (_c: string, code: string) => ({ maybeSingle: async () => ({ data: orders[code] ? { status: orders[code] } : null, error: null }) }) }) }),
  }
  return Object.assign(db as unknown as Deps['db'], { calls })
}
const evt = (id: string, userId: string, text: string, extra: Record<string, unknown> = {}) => ({
  type: 'message', webhookEventId: id, mode: 'active', timestamp: Date.now(), source: { type: 'user', userId },
  replyToken: `rt-${id}`, deliveryContext: { isRedelivery: false }, message: { type: 'text', id: '1', text }, ...extra,
})
const envOf = (fake: { url: string; token: string }, o: Record<string, string> = {}) => ({ LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token, LINE_CHANNEL_SECRET: SECRET, LINE_OWNER_USER_ID: OWNER, ...o })
const send = (deps: Deps, body: string, headers: Record<string, string> = {}) =>
  handler(new Request('http://x/line_webhook', { method: 'POST', headers, body }), deps)
const hook = (deps: Deps, events: unknown[], headerName = 'x-line-signature') => {
  const body = JSON.stringify({ destination: 'Udest', events })
  return send(deps, body, { [headerName]: signLine(body, SECRET) })
}
const replies = (fake: { log: { path: string }[] }) => fake.log.filter((l) => l.path === '/v2/bot/message/reply') as { auth: string; body: string }[]
const texts = (fake: Parameters<typeof replies>[0]) => replies(fake).map((r) => JSON.parse(r.body).messages[0].text as string)
const pushes = (fake: { log: { path: string }[] }) => fake.log.filter((l) => l.path === '/v2/bot/message/push')

async function withLine(fn: (fake: Awaited<ReturnType<typeof startFakeLine>>) => Promise<void>) {
  const fake = await startFakeLine({ channelSecret: SECRET })
  try { await fn(fake) } finally { await fake.close() }
}

test('ลายเซ็นผิด / กุญแจผิด / ไม่มี header / base64 เพี้ยน / body ขยะ → 401 ไม่แตะฐานข้อมูล ไม่ตอบกลับ', () => withLine(async (fake) => {
  const orders = { 'SC-1234': 'placed' }; const db = fakeDb(orders); const deps = { env: envOf(fake), fetch, db }
  const ev = [evt('e1', OWNER, 'ยืนยัน SC-1234')]; const body = JSON.stringify({ events: ev })
  const cases: Response[] = [
    await send(deps, body, { 'x-line-signature': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }),
    await send(deps, body, { 'x-line-signature': signLine(body, 'ffffffffffffffffffffffffffffffff') }),
    await send(deps, body),
    await send(deps, body, { 'x-line-signature': 'deadbeef!!' }),
    await send(deps, body, { 'x-line-signature': '' }),
    await send(deps, '<<<ไม่ใช่ json>>>', { 'x-line-signature': 'AAAA' }),
    await send(deps, '<<<ไม่ใช่ json>>>'),
    await send(deps, body + ' ', { 'x-line-signature': signLine(body, SECRET) }), // body ถูกแก้หลังลงนาม
  ]
  for (const [i, r] of cases.entries()) {
    assert.equal(r.status, 401, `กรณีที่ ${i}`)
    assert.deepEqual(await r.json(), { error: 'bad_signature' })
  }
  assert.equal(orders['SC-1234'], 'placed')
  assert.deepEqual(db.calls, [])
  assert.equal(fake.log.length, 0)
}))

test('ลายเซ็นถูกแต่ body ไม่ใช่ JSON → 400 ไม่ใช่ 500', () => withLine(async (fake) => {
  const db = fakeDb({}); const deps = { env: envOf(fake), fetch, db }
  for (const raw of ['<<<ขยะ>>>', '{"destination":"U"}', '[]']) {
    const r = await send(deps, raw, { 'x-line-signature': signLine(raw, SECRET) })
    assert.equal(r.status, 400, raw)
  }
  assert.deepEqual(db.calls, [])
}))

test('เจ้าของพิมพ์ "ยืนยัน SC-…" → confirmed + ตอบด้วย reply API (ไม่ใช่ push) · header ตัวพิมพ์ต่างก็ได้', () => withLine(async (fake) => {
  const orders = { 'SC-1234': 'placed', 'SC-5678': 'placed' }; const deps = { env: envOf(fake), fetch, db: fakeDb(orders) }
  assert.equal((await hook(deps, [evt('e1', OWNER, 'ยืนยัน SC-1234')])).status, 200)
  assert.equal((await hook(deps, [evt('e2', OWNER, '  ยืนยัน   sc-5678 ')], 'X-Line-Signature')).status, 200)
  assert.deepEqual(orders, { 'SC-1234': 'confirmed', 'SC-5678': 'confirmed' })
  assert.deepEqual(texts(fake), ['ยืนยันออเดอร์ SC-1234 แล้ว', 'ยืนยันออเดอร์ SC-5678 แล้ว'])
  assert.equal(replies(fake)[0].auth, `Bearer ${fake.token}`)
  assert.equal(JSON.parse(replies(fake)[0].body).replyToken, 'rt-e1')
  assert.equal(pushes(fake).length, 0)
}))

test('events ว่าง (ปุ่ม Verify ของ LINE) → 200 ไม่ทำอะไร', () => withLine(async (fake) => {
  const db = fakeDb({}); const r = await hook({ env: envOf(fake), fetch, db }, [])
  assert.equal(r.status, 200)
  assert.deepEqual(db.calls, [])
  assert.equal(fake.log.length, 0)
}))

test('event ซ้ำ (webhookEventId เดิม / isRedelivery) → ไม่ทำซ้ำ ไม่ตอบซ้ำ', () => withLine(async (fake) => {
  const orders = { 'SC-1234': 'placed' }; const deps = { env: envOf(fake), fetch, db: fakeDb(orders) }
  await hook(deps, [evt('dup', OWNER, 'ยืนยัน SC-1234')])
  orders['SC-1234'] = 'placed' // ถ้า event ซ้ำทำงานซ้ำ จะกลับไป confirmed
  const r = await hook(deps, [evt('dup', OWNER, 'ยืนยัน SC-1234', { replyToken: 'rt-other', deliveryContext: { isRedelivery: true } })])
  assert.equal(r.status, 200)
  assert.equal(orders['SC-1234'], 'placed')
  assert.equal(replies(fake).length, 1)
  // event ซ้ำกันในคำขอเดียวก็ทำครั้งเดียว
  await hook(deps, [evt('same', OWNER, 'ยืนยัน SC-1234'), evt('same', OWNER, 'ยืนยัน SC-1234')])
  assert.equal(replies(fake).length, 2)
}))

test('คนที่ไม่ใช่เจ้าของพิมพ์ "ยืนยัน SC-…" → ออเดอร์ไม่เปลี่ยน ไม่ตอบ · ไม่มี userId ก็เช่นกัน', () => withLine(async (fake) => {
  const orders = { 'SC-1234': 'placed' }; const deps = { env: envOf(fake), fetch, db: fakeDb(orders) }
  const noUser = evt('s2', OWNER, 'ยืนยัน SC-1234', { source: { type: 'group' } })
  const r = await hook(deps, [evt('s1', STRANGER, 'ยืนยัน SC-1234'), noUser])
  assert.equal(r.status, 200)
  assert.equal(orders['SC-1234'], 'placed')
  assert.equal(replies(fake).length, 0)
}))

test('รหัสที่ไม่มี → ตอบ "ไม่พบ" · สถานะผิด → ตอบพร้อมสถานะ · ยืนยันซ้ำ → ตอบว่ายืนยันแล้ว', () => withLine(async (fake) => {
  const orders = { 'SC-0001': 'cancelled', 'SC-0002': 'confirmed' }; const deps = { env: envOf(fake), fetch, db: fakeDb(orders) }
  await hook(deps, [evt('n1', OWNER, 'ยืนยัน SC-9999'), evt('n2', OWNER, 'ยืนยัน SC-0001'), evt('n3', OWNER, 'ยืนยัน SC-0002')])
  assert.deepEqual(texts(fake), ['ไม่พบออเดอร์ SC-9999', 'ออเดอร์ SC-0001 ยืนยันไม่ได้ (สถานะ cancelled)', 'ยืนยันออเดอร์ SC-0002 แล้ว'])
  assert.equal(orders['SC-0001'], 'cancelled')
}))

test('ข้อความอื่นจากเจ้าของ → ตอบวิธีใช้ · event ที่ไม่ใช่ข้อความ/ไม่ใช่ text → เงียบ', () => withLine(async (fake) => {
  const orders = { 'SC-1234': 'placed' }; const deps = { env: envOf(fake), fetch, db: fakeDb(orders) }
  await hook(deps, [
    evt('o1', OWNER, 'สวัสดี'), evt('o2', OWNER, 'ยืนยัน'), evt('o3', OWNER, 'ยืนยัน SC-1234 แถมคำสั่งอื่น'),
    evt('o4', OWNER, '', { type: 'follow', message: undefined }), evt('o5', OWNER, '', { message: { type: 'image', id: '2' } }), { type: 'message' },
  ])
  assert.equal(replies(fake).length, 3)
  for (const t of texts(fake)) assert.match(t, /ยืนยัน SC-/)
  assert.equal(orders['SC-1234'], 'placed')
}))

test('reply ไป LINE ล้มเหลว (500 / ต่อไม่ได้) → ยังตอบ 200 และออเดอร์ยืนยันแล้ว', async () => {
  await withLine(async (fake) => {
    const orders = { 'SC-1234': 'placed' }; fake.setMode('500')
    const r = await hook({ env: envOf(fake), fetch, db: fakeDb(orders) }, [evt('f1', OWNER, 'ยืนยัน SC-1234')])
    assert.equal(r.status, 200); assert.equal(orders['SC-1234'], 'confirmed')
  })
  const orders = { 'SC-1234': 'placed' }
  const r = await hook({ env: { ...envOf({ url: 'http://127.0.0.1:1', token: 't' }) }, fetch, db: fakeDb(orders) }, [evt('f2', OWNER, 'ยืนยัน SC-1234')])
  assert.equal(r.status, 200); assert.equal(orders['SC-1234'], 'confirmed')
})

test('บันทึก event ไม่ได้ (ฐานข้อมูลล้ม) → 500 ให้ LINE ลองใหม่ · ไม่ยืนยันออเดอร์', () => withLine(async (fake) => {
  const orders = { 'SC-1234': 'placed' }; const db = fakeDb(orders, { eventsFail: true })
  const r = await hook({ env: envOf(fake), fetch, db }, [evt('x1', OWNER, 'ยืนยัน SC-1234')])
  assert.equal(r.status, 500)
  assert.equal(orders['SC-1234'], 'placed')
}))

test('ไม่ได้ตั้ง channel secret → 500 line_not_configured (ไม่ยอมรับทุกคำขอ) · GET → 405 · ไม่หลุดความลับ', () => withLine(async (fake) => {
  const db = fakeDb({}); const body = JSON.stringify({ events: [] })
  const r = await send({ env: envOf(fake, { LINE_CHANNEL_SECRET: '' }), fetch, db }, body, { 'x-line-signature': signLine(body, '') })
  assert.equal(r.status, 500)
  const text = await r.text()
  assert.deepEqual(JSON.parse(text), { error: 'line_not_configured' })
  assert.ok(!text.includes(SECRET) && !text.includes(fake.token))
  const g = await handler(new Request('http://x/line_webhook'), { env: envOf(fake), fetch, db })
  assert.equal(g.status, 405)
}))
