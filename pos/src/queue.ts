// คิวบิลฝั่ง client — เก็บลง storage ทันทีที่บันทึก ส่งทีละใบตามลำดับ ไม่ผูกกับเบราว์เซอร์
import type { BillLine } from './bill'

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type PendingBill = { client_order_id: string; lines: BillLine[]; redeem_points?: number; points_balance?: number; cash_received?: number; at: string; customer_phone?: string }
type DeadBill = { bill: PendingBill; error: string }
type State = { pending: PendingBill[]; dead: DeadBill[] }
type FlushResult = { sent: number; failed: number; dead: number; remaining: number }

export function createBillQueue(
  storage: KV,
  send: (b: PendingBill) => Promise<{ duplicate?: boolean } | void>,
  opts: { key?: string; newId?: () => string } = {},
) {
  const key = opts.key ?? 'pos_bill_queue'
  const newId = opts.newId ?? (() => crypto.randomUUID())

  const load = (): State => {
    try {
      const raw = storage.getItem(key)
      const parsed = raw ? JSON.parse(raw) : null
      return { pending: Array.isArray(parsed?.pending) ? parsed.pending : [], dead: Array.isArray(parsed?.dead) ? parsed.dead : [] }
    } catch {
      return { pending: [], dead: [] }
    }
  }
  const save = (s: State) => storage.setItem(key, JSON.stringify(s))

  let running: Promise<FlushResult> | null = null

  const run = async (): Promise<FlushResult> => {
    const result = { sent: 0, failed: 0, dead: 0, remaining: 0 }
    for (;;) {
      const bill = load().pending[0]
      if (!bill) break
      try {
        await send(bill)
        const s = load()
        s.pending = s.pending.filter((b) => b.client_order_id !== bill.client_order_id)
        save(s)
        result.sent++
      } catch (e) {
        if ((e as { retryable?: boolean } | null)?.retryable === false) {
          const s = load()
          s.pending = s.pending.filter((b) => b.client_order_id !== bill.client_order_id)
          s.dead.push({ bill, error: e instanceof Error ? e.message : String(e) })
          save(s)
          result.dead++
        } else {
          result.failed = 1
          break
        }
      }
    }
    result.remaining = load().pending.length
    return result
  }

  return {
    enqueue(input: Omit<PendingBill, 'client_order_id' | 'at'> & { at?: string }): PendingBill {
      const bill: PendingBill = { ...input, client_order_id: newId(), at: input.at ?? new Date().toISOString() }
      const s = load()
      s.pending.push(bill)
      save(s)
      return bill
    },
    pending: (): PendingBill[] => load().pending,
    dead: (): DeadBill[] => load().dead,
    flush(): Promise<FlushResult> {
      running ??= run().finally(() => { running = null })
      return running
    },
  }
}
