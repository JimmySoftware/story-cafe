import { account, type Store } from './store.ts'

export type Session = { customerId: string }
export type RedeemRequest = { customerId?: string; points: number }
export type RedeemResult = { ok: true; balance: number; discountBaht: number } | { ok: false; error: string }

// ใช้แต้มเป็นส่วนลด: 1 แต้ม = 1 บาท · ใช้ได้เฉพาะแต้มของคนที่ล็อกอิน · ต้องเป็นจำนวนเต็ม ≥ 1 และไม่เกินยอดคงเหลือ
export function redeemPoints(store: Store, session: Session, req: RedeemRequest): RedeemResult {
  if (req.customerId !== undefined && req.customerId !== session.customerId) return { ok: false, error: 'ไม่มีสิทธิ์ใช้แต้มของคนอื่น' }
  if (!Number.isInteger(req.points) || req.points < 1) return { ok: false, error: 'จำนวนแต้มต้องเป็นจำนวนเต็มตั้งแต่ 1' }
  const a = account(store, session.customerId)
  if (req.points > a.balance) return { ok: false, error: 'แต้มไม่พอ' }
  a.balance -= req.points
  store.log.push({ at: new Date(), customerId: session.customerId, delta: -req.points, reason: 'redeem' })
  return { ok: true, balance: a.balance, discountBaht: req.points }
}
