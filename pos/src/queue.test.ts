import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBillQueue, type KV, type PendingBill } from './queue'

const memoryStorage = (): KV => {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}
const line = { item: 'ลาเต้', qty: 1 }
const counterId = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }

test('เน็ตหลุด: ปิด 3 บิล เปิดคิวใหม่ยังเห็นเดิม เน็ตกลับส่งครบตามลำดับใบละครั้ง flush ซ้ำไม่ส่งอีก', async () => {
  const storage = memoryStorage()
  const newId = counterId()
  let online = false
  const sent: string[] = []
  const send = async (b: PendingBill) => {
    if (!online) throw new Error('network down')
    sent.push(b.client_order_id)
  }

  const q1 = createBillQueue(storage, send, { newId })
  const bills = [1, 2, 3].map((n) => q1.enqueue({ lines: [{ ...line, qty: n }] }))
  assert.deepEqual(await q1.flush(), { sent: 0, failed: 1, dead: 0, remaining: 3 })

  const q2 = createBillQueue(storage, send, { newId })
  assert.deepEqual(q2.pending().map((b) => b.client_order_id), bills.map((b) => b.client_order_id))

  online = true
  assert.deepEqual(await q2.flush(), { sent: 3, failed: 0, dead: 0, remaining: 0 })
  assert.deepEqual(sent, bills.map((b) => b.client_order_id))
  assert.deepEqual(await q2.flush(), { sent: 0, failed: 0, dead: 0, remaining: 0 })
  assert.equal(sent.length, 3)
  assert.equal(createBillQueue(storage, send).pending().length, 0)
})

const ids = (bills: PendingBill[]) => bills.map((b) => b.client_order_id)
const nextTick = () => new Promise((r) => setTimeout(r, 0))

test('ส่งล้มกลางคัน: หยุดทันที บิลที่ส่งแล้วออกจากคิว ที่เหลืออยู่ตามลำดับเดิม ส่งใหม่ด้วย id เดิม', async () => {
  const storage = memoryStorage()
  const calls: string[] = []
  let failAt: string | null = null
  const send = async (b: PendingBill) => {
    calls.push(b.client_order_id)
    if (b.client_order_id === failAt) throw new Error('network down')
  }
  const q = createBillQueue(storage, send, { newId: counterId() })
  const [b1, b2, b3] = [1, 2, 3].map((n) => q.enqueue({ lines: [{ ...line, qty: n }] }))
  failAt = b2.client_order_id

  assert.deepEqual(await q.flush(), { sent: 1, failed: 1, dead: 0, remaining: 2 })
  assert.deepEqual(calls, [b1.client_order_id, b2.client_order_id]) // ไม่ลองใบที่ 3
  assert.deepEqual(ids(q.pending()), [b2.client_order_id, b3.client_order_id])

  failAt = null
  assert.deepEqual(await q.flush(), { sent: 2, failed: 0, dead: 0, remaining: 0 })
  assert.deepEqual(calls.slice(2), [b2.client_order_id, b3.client_order_id])
})

test('retryable:false → ย้ายไป dead() พร้อมข้อความ error แล้วส่งใบถัดไปต่อ', async () => {
  const storage = memoryStorage()
  const sent: string[] = []
  let bad = ''
  const send = async (b: PendingBill) => {
    if (b.client_order_id === bad) throw Object.assign(new Error('unknown_item: ไม่มีเมนู "X"'), { retryable: false })
    sent.push(b.client_order_id)
  }
  const q = createBillQueue(storage, send, { newId: counterId() })
  const [b1, b2, b3] = [1, 2, 3].map((n) => q.enqueue({ lines: [{ ...line, qty: n }] }))
  bad = b2.client_order_id

  assert.deepEqual(await q.flush(), { sent: 2, failed: 0, dead: 1, remaining: 0 })
  assert.deepEqual(sent, [b1.client_order_id, b3.client_order_id])
  assert.equal(q.dead().length, 1)
  assert.equal(q.dead()[0].bill.client_order_id, b2.client_order_id)
  assert.match(q.dead()[0].error, /unknown_item/)
  // dead คงอยู่หลังเปิดคิวใหม่ และไม่ถูกส่งซ้ำ
  const q2 = createBillQueue(storage, send)
  assert.equal(q2.dead().length, 1)
  assert.deepEqual(await q2.flush(), { sent: 0, failed: 0, dead: 0, remaining: 0 })
})

test('send ตอบ {duplicate:true} → นับเป็นส่งแล้ว เอาออกจากคิว', async () => {
  const q = createBillQueue(memoryStorage(), async () => ({ duplicate: true }), { newId: counterId() })
  q.enqueue({ lines: [line] })
  q.enqueue({ lines: [line] })
  assert.deepEqual(await q.flush(), { sent: 2, failed: 0, dead: 0, remaining: 0 })
  assert.equal(q.pending().length, 0)
})

test('flush ซ้อนกัน: ใช้งานเดียวกัน ไม่มีบิลถูกส่งสองครั้งพร้อมกัน', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const sent: string[] = []
  const send = async (b: PendingBill) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await nextTick()
    sent.push(b.client_order_id)
    inFlight--
  }
  const q = createBillQueue(memoryStorage(), send, { newId: counterId() })
  const bills = [1, 2, 3].map((n) => q.enqueue({ lines: [{ ...line, qty: n }] }))

  const [r1, r2, r3] = await Promise.all([q.flush(), q.flush(), q.flush()])
  assert.deepEqual(sent, ids(bills))
  assert.equal(maxInFlight, 1)
  assert.deepEqual(r1, { sent: 3, failed: 0, dead: 0, remaining: 0 })
  assert.deepEqual(r2, r1)
  assert.deepEqual(r3, r1)
  // จบรอบแล้ว flush ใหม่ได้ตามปกติ
  q.enqueue({ lines: [line] })
  assert.deepEqual(await q.flush(), { sent: 1, failed: 0, dead: 0, remaining: 0 })
})

test('enqueue ระหว่าง flush: บิลไม่หาย และถูกส่งในรอบเดียวกัน', async () => {
  const sent: string[] = []
  let q!: ReturnType<typeof createBillQueue>
  let late: PendingBill | undefined
  const send = async (b: PendingBill) => {
    if (!late) late = q.enqueue({ lines: [{ ...line, qty: 9 }] }) // แคชเชียร์ปิดบิลใหม่ตอนกำลังส่งใบแรก
    await nextTick()
    sent.push(b.client_order_id)
  }
  q = createBillQueue(memoryStorage(), send, { newId: counterId() })
  const first = q.enqueue({ lines: [line] })

  const res = await q.flush()
  assert.ok(late)
  assert.deepEqual(sent, [first.client_order_id, late.client_order_id])
  assert.deepEqual(res, { sent: 2, failed: 0, dead: 0, remaining: 0 })
  assert.equal(q.pending().length, 0)
})

test('enqueue ระหว่าง flush ที่ส่งล้ม: บิลใหม่ยังอยู่ท้ายคิว', async () => {
  let q!: ReturnType<typeof createBillQueue>
  let late: PendingBill | undefined
  const send = async () => {
    late = q.enqueue({ lines: [line] })
    throw new Error('network down')
  }
  q = createBillQueue(memoryStorage(), send, { newId: counterId() })
  const first = q.enqueue({ lines: [line] })
  assert.deepEqual(await q.flush(), { sent: 0, failed: 1, dead: 0, remaining: 2 })
  assert.deepEqual(ids(q.pending()), [first.client_order_id, late!.client_order_id])
})
