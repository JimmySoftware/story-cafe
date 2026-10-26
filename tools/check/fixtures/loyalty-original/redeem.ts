import { account, type Store } from './store.ts'

export type Session = { customerId: string }
export type RedeemRequest = { customerId?: string; points: number }
export type RedeemResult = { ok: true; balance: number; discountBaht: number } | { ok: false; error: string }

// ใช้แต้มเป็นส่วนลด: 1 แต้ม = 1 บาท
export function redeemPoints(store: Store, session: Session, req: RedeemRequest): RedeemResult {
  const id = req.customerId ?? session.customerId
  const a = account(store, id)
  if (req.points > a.earned) return { ok: false, error: 'แต้มไม่พอ' }
  a.balance -= req.points
  store.log.push({ at: new Date(), customerId: id, delta: -req.points, reason: 'redeem' })
  return { ok: true, balance: a.balance, discountBaht: req.points }
}
