// test ของ morning_summary: ยิงกับ LINE จำลอง (tools/fakes/line.mjs) · ฐานข้อมูลจำลองคืนผลสรุปตายตัว
// (กติกานับของ morning_summary_data ทดสอบจริงใน supabase/tests/12_morning_summary.sql)
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error ไฟล์ .mjs ไม่มี type
import { startFakeLine } from '../../../tools/fakes/line.mjs'
import handler, { retryKeyForDay, summaryText, type Deps } from './handler.ts'

const OWNER = 'U0123456789abcdef0123456789abcdef'
const SUMMARY = {
  day: '2026-10-26', orders: 3, cups: 7, first_pickup: '09:00', last_pickup: '14:30',
  low_stock: [{ name: 'นมวัว', stock: 100, unit: 'ml', reorder_level: 3000 }],
}
const fakeDb = (data: unknown = SUMMARY, error: unknown = null) =>
  ({ rpc: async (fn: string) => { assert.equal(fn, 'morning_summary_data'); return { data, error } } }) as unknown as Deps['db']
const call = (deps: Deps, method = 'POST') => handler(new Request('http://x/morning_summary', { method }), deps)
const pushes = (fake: { log: { path: string }[] }) => fake.log.filter((l) => l.path === '/v2/bot/message/push') as { auth: string; retryKey: string; body: string; result: number }[]
const envOf = (fake: { url: string; token: string }, o: Record<string, string> = {}) => ({ LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token, LINE_OWNER_USER_ID: OWNER, ...o })

async function withLine(fn: (fake: Awaited<ReturnType<typeof startFakeLine>>) => Promise<void>) {
  const fake = await startFakeLine()
  try { await fn(fake) } finally { await fake.close() }
}

test('ส่ง push ภาษาไทย: วันที่ · ออเดอร์/แก้ว · ช่วงเวลารับ · เฉพาะวัตถุดิบใกล้หมด', () => withLine(async (fake) => {
  const res = await call({ env: envOf(fake), fetch, db: fakeDb() })
  assert.equal(res.status, 200)
  const [p] = pushes(fake)
  const body = JSON.parse(p.body)
  assert.equal(p.auth, `Bearer ${fake.token}`)
  assert.equal(body.to, OWNER)
  const text: string = body.messages[0].text
  assert.match(text, /สรุปเช้า 26 ต\.ค\. 2026/)
  assert.match(text, /3 ออเดอร์ รวม 7 แก้ว/)
  assert.match(text, /09:00 ถึง 14:30/)
  assert.match(text, /นมวัว เหลือ 100 ml/)
  assert.doesNotMatch(text, /ชาซีลอน/)
}))

test('ไม่มีออเดอร์และไม่มีของใกล้หมด → ข้อความสั้น ไม่มีหัวข้อวัตถุดิบ', () => {
  const t = summaryText({ ...SUMMARY, orders: 0, cups: 0, first_pickup: null, last_pickup: null, low_stock: [] })
  assert.match(t, /ยังไม่มีออเดอร์/)
  assert.doesNotMatch(t, /ใกล้หมด|null/)
})

test('retry key เป็น UUID คำนวณจากวันที่ · วันเดียวกันเท่าเดิม วันอื่นต่างกัน', async () => {
  const a = await retryKeyForDay('2026-10-26')
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(a, await retryKeyForDay('2026-10-26'))
  assert.notEqual(a, await retryKeyForDay('2026-10-27'))
})

test('รันซ้ำวันเดียวกัน → retry key เดิม · LINE ตอบ 409 ยังตอบ 200', () => withLine(async (fake) => {
  const deps = { env: envOf(fake), fetch, db: fakeDb() }
  const r1 = await call(deps), r2 = await call(deps)
  assert.equal(r1.status, 200); assert.equal(r2.status, 200)
  assert.equal((await r2.json()).duplicate, true)
  const p = pushes(fake)
  assert.equal(p.length, 2)
  assert.equal(p[0].retryKey, p[1].retryKey)
  assert.deepEqual(p.map((x) => x.result), [200, 409])
}))

test('LINE ล่ม 500 / 429 / 401 / timeout → 502 · ไม่ส่งซ้ำเองในรอบเดียว · ลองใหม่ด้วย key เดิมแล้วสำเร็จ', () => withLine(async (fake) => {
  const deps = { env: envOf(fake), fetch, db: fakeDb() }
  for (const mode of ['500', '429', '401']) {
    fake.setMode(mode)
    const res = await call(deps)
    assert.equal(res.status, 502, mode)
    assert.equal((await res.json()).error, 'line_failed')
  }
  assert.equal(pushes(fake).length, 3) // 1 ครั้งต่อ 1 คำขอ
  fake.setMode('ok')
  assert.equal((await call(deps)).status, 200)
  const keys = new Set(pushes(fake).map((p) => p.retryKey))
  assert.equal(keys.size, 1)
}))

test('LINE ไม่ตอบ (timeout) → 502 line_timeout', () => withLine(async (fake) => {
  fake.setMode('timeout')
  const res = await call({ env: envOf(fake), fetch: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(100) }), db: fakeDb() })
  assert.equal(res.status, 502)
  assert.equal((await res.json()).error, 'line_timeout')
}))

test('เชื่อมต่อ LINE ไม่ได้ → 502 line_network_error', async () => {
  const res = await call({ env: { LINE_API_BASE: 'http://127.0.0.1:1', LINE_CHANNEL_ACCESS_TOKEN: 'secret-tok', LINE_OWNER_USER_ID: OWNER }, fetch, db: fakeDb() })
  assert.equal(res.status, 502)
  assert.equal((await res.json()).error, 'line_network_error')
})

test('ไม่มี token หรือ owner → 500 line_not_configured · ไม่ยิง LINE · ไม่หลุด token', () => withLine(async (fake) => {
  for (const o of [{ LINE_CHANNEL_ACCESS_TOKEN: '' }, { LINE_OWNER_USER_ID: '' }]) {
    const res = await call({ env: envOf(fake, o), fetch, db: fakeDb() })
    assert.equal(res.status, 500)
    const text = await res.text()
    assert.deepEqual(JSON.parse(text), { error: 'line_not_configured' })
    assert.ok(!text.includes(fake.token))
  }
  assert.equal(pushes(fake).length, 0)
}))

test('token ไม่หลุดในคำตอบตอน LINE ล้มเหลว', () => withLine(async (fake) => {
  fake.setMode('500')
  const res = await call({ env: envOf(fake), fetch, db: fakeDb() })
  assert.ok(!(await res.text()).includes(fake.token))
}))

test('ฐานข้อมูลผิดพลาด → 500 server_error ไม่ยิง LINE · GET → 405', () => withLine(async (fake) => {
  const res = await call({ env: envOf(fake), fetch, db: fakeDb(null, { message: 'boom' }) })
  assert.equal(res.status, 500)
  assert.deepEqual(await res.json(), { error: 'server_error' })
  assert.equal((await call({ env: envOf(fake), fetch, db: fakeDb() }, 'GET')).status, 405)
  assert.equal(pushes(fake).length, 0)
}))
