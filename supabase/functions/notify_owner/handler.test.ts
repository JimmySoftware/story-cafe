// test ของ notify_owner: ยิงกับ LINE จำลอง (tools/fakes/line.mjs) · คิวจำลองในหน่วยความจำทำตามกติกาเดียวกับ migration
// (ของจริงทดสอบใน supabase/tests/11_notify_queue.sql)
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error ไฟล์ .mjs ไม่มี type
import { startFakeLine } from '../../../tools/fakes/line.mjs'
import handler, { type Deps } from './handler.ts'

const OWNER = 'U0123456789abcdef0123456789abcdef'
type Q = { id: string; kind: string; payload: unknown; retry_key: string; status: string; attempts: number; last_error: string | null }

function fakeDb(rows: Q[]) {
  const db = {
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn === 'claim_notifications') return { data: rows.filter((r) => r.status === 'pending').slice(0, a.p_limit as number), error: null }
      if (fn === 'finish_notification') {
        const r = rows.find((x) => x.id === a.p_id)!
        if (a.p_outcome === 'sent') r.status = 'sent'
        else if (a.p_outcome === 'failed') r.status = 'failed'
        else { r.attempts++; r.status = r.attempts >= 5 ? 'dead' : 'pending' }
        r.last_error = a.p_error ? String(a.p_error).slice(0, 300) : null
        return { data: null, error: null }
      }
      throw new Error(`rpc ที่ไม่รู้จัก ${fn}`)
    },
  }
  return db as unknown as Deps['db']
}
const row = (n: number, over: Partial<Q> = {}): Q => ({ id: `id-${n}`, kind: 'order_placed', payload: { code: `SC-000${n}`, total: 130, source: 'preorder' }, retry_key: `00000000-0000-4000-8000-00000000000${n}`, status: 'pending', attempts: 0, last_error: null, ...over })
const call = (deps: Deps, method = 'POST') => handler(new Request('http://x/notify_owner', { method }), deps)
const pushes = (fake: { log: { path: string }[] }) => fake.log.filter((l) => l.path === '/v2/bot/message/push') as { auth: string; retryKey: string; body: string; result: number }[]

async function withLine(fn: (fake: Awaited<ReturnType<typeof startFakeLine>>) => Promise<void>) {
  const fake = await startFakeLine()
  try { await fn(fake) } finally { await fake.close() }
}
const envOf = (fake: { url: string; token: string }, o: Record<string, string> = {}) => ({ LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token, LINE_OWNER_USER_ID: OWNER, ...o })

test('ส่ง push ข้อความไทยมีเลขออเดอร์และยอด พร้อม retry key ของแถว → sent', () => withLine(async (fake) => {
  const rows = [row(1)]
  const res = await call({ env: envOf(fake), fetch, db: fakeDb(rows) })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { sent: 1, retry: 0, failed: 0 })
  const [p] = pushes(fake)
  const body = JSON.parse(p.body)
  assert.equal(p.auth, `Bearer ${fake.token}`)
  assert.equal(p.retryKey, rows[0].retry_key)
  assert.equal(body.to, OWNER)
  assert.match(body.messages[0].text, /ออเดอร์ใหม่ SC-0001 · ยอด 130 บาท/)
  assert.equal(rows[0].status, 'sent')
}))

test('เรียกซ้ำเมื่อไม่มีแถวค้าง → ไม่ส่งซ้ำ', () => withLine(async (fake) => {
  const deps = { env: envOf(fake), fetch, db: fakeDb([row(1)]) }
  await call(deps); await call(deps)
  assert.equal(pushes(fake).length, 1)
}))

test('LINE ล่ม 500 / 429 / timeout → retry เก็บรหัสสถานะ แล้วส่งใหม่ด้วย retry key เดิมได้', () => withLine(async (fake) => {
  const rows = [row(1)]
  const deps = { env: envOf(fake), fetch, db: fakeDb(rows) }
  fake.setMode('500'); assert.deepEqual(await (await call(deps)).json(), { sent: 0, retry: 1, failed: 0 })
  assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].attempts, 1); assert.match(rows[0].last_error!, /500/)
  fake.setMode('429'); await call(deps); assert.match(rows[0].last_error!, /429/)
  fake.setMode('ok'); await call(deps)
  assert.equal(rows[0].status, 'sent')
  assert.equal(new Set(pushes(fake).map((p) => p.retryKey)).size, 1)
  assert.equal(pushes(fake).length, 3)
}))

test('LINE ช้าเกิน 5 วินาที → retry (ไม่ค้าง)', { timeout: 15000 }, () => withLine(async (fake) => {
  const rows = [row(1)]
  fake.setMode('timeout')
  const t0 = Date.now()
  const res = await call({ env: envOf(fake), fetch, db: fakeDb(rows) })
  assert.deepEqual(await res.json(), { sent: 0, retry: 1, failed: 0 })
  assert.ok(Date.now() - t0 < 8000)
  assert.equal(rows[0].last_error, 'line_timeout')
}))

test('409 (เคยรับ retry key นี้แล้ว) ถือว่าส่งสำเร็จ', () => withLine(async (fake) => {
  const rows = [row(1)]
  await fetch(`${fake.url}/v2/bot/message/push`, { method: 'POST', headers: { authorization: `Bearer ${fake.token}`, 'content-type': 'application/json', 'x-line-retry-key': rows[0].retry_key }, body: JSON.stringify({ to: OWNER, messages: [{ type: 'text', text: 'x' }] }) })
  const res = await call({ env: envOf(fake), fetch, db: fakeDb(rows) })
  assert.deepEqual(await res.json(), { sent: 1, retry: 0, failed: 0 })
  assert.equal(rows[0].status, 'sent')
  assert.equal(pushes(fake).filter((p) => p.result === 409).length, 1)
}))

test('token ผิด 401 → failed ไม่ลองซ้ำ และ last_error / response ไม่มี token', () => withLine(async (fake) => {
  const SECRET = 'wrong-token-SECRETVALUE-123456'
  const rows = [row(1)]
  const res = await call({ env: envOf(fake, { LINE_CHANNEL_ACCESS_TOKEN: SECRET }), fetch, db: fakeDb(rows) })
  const text = await res.text()
  assert.equal(rows[0].status, 'failed')
  assert.match(rows[0].last_error!, /401/)
  assert.ok(!rows[0].last_error!.includes('SECRETVALUE') && !text.includes('SECRETVALUE'))
}))

test('ไม่มี token หรือ owner id → failed line_not_configured โดยไม่เรียก LINE และไม่ crash', () => withLine(async (fake) => {
  const rows = [row(1), row(2)]
  const res = await call({ env: { LINE_API_BASE: fake.url }, fetch, db: fakeDb(rows) })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { sent: 0, retry: 0, failed: 2 })
  assert.equal(rows[0].last_error, 'line_not_configured')
  assert.equal(pushes(fake).length, 0)
}))

test('fetch โยน error (เน็ตล่ม) → retry และ error ไม่มี token', async () => {
  const rows = [row(1)]
  const boom = (async () => { throw new TypeError('connect ECONNREFUSED Bearer tok-SECRET') }) as unknown as typeof fetch
  const res = await call({ env: { LINE_CHANNEL_ACCESS_TOKEN: 'tok-SECRET', LINE_OWNER_USER_ID: OWNER }, fetch: boom, db: fakeDb(rows) })
  assert.deepEqual(await res.json(), { sent: 0, retry: 1, failed: 0 })
  assert.ok(!rows[0].last_error!.includes('SECRET'))
})

test('ไม่ใช่ POST → 405 · claim ล้มเหลว → 500 ข้อความสั้น', async () => {
  assert.equal((await call({ env: {}, fetch, db: fakeDb([]) }, 'GET')).status, 405)
  const bad = { rpc: async () => ({ data: null, error: { message: 'secret detail' } }) } as unknown as Deps['db']
  const res = await call({ env: {}, fetch, db: bad })
  assert.equal(res.status, 500)
  assert.ok(!(await res.text()).includes('secret detail'))
})

// ---- ลองพัง: LINE มีปัญหา แต่ออเดอร์ต้องไม่กระทบ และข้อความต้องไม่ซ้ำ ----

test('ลองพัง: LINE 500 หลายรอบแล้วกลับมา → ส่งสำเร็จข้อความเดียว ด้วย retry key เดิมทุกครั้ง · ออเดอร์ไม่ถูกแตะ', () => withLine(async (fake) => {
  const orders = [{ code: 'SC-0001', status: 'placed' }]
  const rows = [row(1)]
  const deps = { env: envOf(fake), fetch, db: fakeDb(rows) }
  fake.setMode('500')
  for (let i = 0; i < 3; i++) await call(deps)
  assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].attempts, 3)
  fake.setMode('ok')
  assert.deepEqual(await (await call(deps)).json(), { sent: 1, retry: 0, failed: 0 })
  assert.equal(rows[0].status, 'sent')
  const p = pushes(fake)
  assert.equal(p.length, 4)
  assert.equal(new Set(p.map((x) => x.retryKey)).size, 1)
  assert.equal(p.filter((x) => x.result === 200).length, 1, 'LINE ต้องรับข้อความสำเร็จเพียงครั้งเดียว')
  assert.equal(orders[0].status, 'placed')
}))

test('ลองพัง: LINE รับข้อความแล้วแต่ตอบไม่ถึงเรา (เน็ตหลุดหลังส่ง) → ส่งซ้ำด้วย key เดิมได้ 409 → sent ไม่ซ้ำข้อความ', () => withLine(async (fake) => {
  const rows = [row(1)]
  let first = true
  const lossy = (async (url: string, init: RequestInit) => {
    const r = await fetch(url, init)
    if (first) { first = false; await r.body?.cancel(); throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }
    return r
  }) as unknown as typeof fetch
  const deps = { env: envOf(fake), fetch: lossy, db: fakeDb(rows) }
  await call(deps); assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].last_error, 'line_timeout')
  await call(deps); assert.equal(rows[0].status, 'sent')
  const p = pushes(fake)
  assert.deepEqual(p.map((x) => x.result), [200, 409])
  assert.equal(p[0].retryKey, p[1].retryKey)
}))

test('ลองพัง: retry ครบ 5 ครั้งยังไม่สำเร็จ → dead ไม่ถูกหยิบอีก', () => withLine(async (fake) => {
  const rows = [row(1)]
  const deps = { env: envOf(fake), fetch, db: fakeDb(rows) }
  fake.setMode('500')
  for (let i = 0; i < 6; i++) await call(deps)
  assert.equal(rows[0].status, 'dead'); assert.equal(rows[0].attempts, 5)
  assert.equal(pushes(fake).length, 5)
}))

test('ลองพัง: last_error และ response ไม่มี token ในทุกรูปแบบที่ LINE พัง', { timeout: 30000 }, async () => {
  const SECRET = 'tok-SECRETVALUE-987654321'
  for (const mode of ['500', '429', '401', 'timeout', 'ok']) {
    await withLine(async (fake) => {
      const rows = [row(1)]
      fake.setMode(mode)
      const res = await call({ env: envOf(fake, { LINE_CHANNEL_ACCESS_TOKEN: SECRET }), fetch, db: fakeDb(rows) })
      const all = `${rows[0].last_error ?? ''} ${await res.text()}`
      assert.ok(!all.includes('SECRETVALUE') && !all.includes('Bearer'), `โหมด ${mode}: พบ token/header ใน error`)
      if (mode !== 'ok') assert.ok(rows[0].last_error, `โหมด ${mode}: ต้องมี last_error`)
    })
  }
})

test('ลองพัง: ไม่ตั้ง token เลย (หรือขาดเฉพาะ owner id) → failed line_not_configured ทุกแถว ไม่ crash ไม่เรียก LINE', () => withLine(async (fake) => {
  for (const env of [{ LINE_API_BASE: fake.url }, { LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token }, { LINE_API_BASE: fake.url, LINE_OWNER_USER_ID: OWNER, LINE_CHANNEL_ACCESS_TOKEN: '' }]) {
    const rows = [row(1)]
    const res = await call({ env, fetch, db: fakeDb(rows) })
    assert.equal(res.status, 200)
    assert.equal(rows[0].status, 'failed'); assert.equal(rows[0].last_error, 'line_not_configured')
  }
  assert.equal(pushes(fake).length, 0)
}))

test('ลองพัง: แถวแรกช้าเกิน 5 วินาที ไม่ทำให้ทั้งฟังก์ชันค้างหรือล้ม · ตอบ 200 พร้อมนับ retry', { timeout: 20000 }, () => withLine(async (fake) => {
  const rows = [row(1)]
  fake.setMode('timeout')
  const t0 = Date.now()
  const res = await call({ env: envOf(fake), fetch, db: fakeDb(rows) })
  const ms = Date.now() - t0
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { sent: 0, retry: 1, failed: 0 })
  assert.ok(ms >= 4500 && ms < 8000, `ใช้เวลา ${ms} ms`)
  assert.equal(rows[0].status, 'pending')
}))
