import { account, type Store } from './store.ts'

export type Session = { customerId: string }
export type RedeemRequest = { customerId?: string; points: number }
export type RedeemResult = { ok: true; balance: number; discountBaht: number } | { ok: false; error: string }

// ใช้แต้มเป็นส่วนลด: 1 แต้ม = 1 บาท
export function redeemPoints(store: Store, session: Session, req: RedeemRequest): RedeemResult {
  if (req.customerId !== undefined && req.customerId !== session.customerId) {
    return { ok: false, error: 'ใช้ได้เฉพาะแต้มของบัญชีที่ล็อกอินอยู่' }
  }
  const id = session.customerId
  const a = account(store, id)
  if (!Number.isInteger(req.points) || req.points < 1) return { ok: false, error: 'จำนวนแต้มต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' }
  if (req.points > a.balance) return { ok: false, error: 'แต้มไม่พอ' }
  a.balance -= req.points
  store.log.push({ at: new Date(), customerId: id, delta: -req.points, reason: 'redeem' })
  return { ok: true, balance: a.balance, discountBaht: req.points }
}
