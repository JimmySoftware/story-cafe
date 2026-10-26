import { account, type Store } from './store.ts'
import { isDoublePointsDay } from './promo.ts'

// ซื้อ 25 บาทได้ 1 แต้ม
export function pointsFor(amountBaht: number, when: Date): number {
  const base = Math.floor(amountBaht / 25)
  return isDoublePointsDay(when) ? base * 2 : base
}

export function earnPoints(store: Store, customerId: string, amountBaht: number, when: Date = new Date()): number {
  const p = pointsFor(amountBaht, when)
  const a = account(store, customerId)
  a.balance += p
  a.earned += p
  store.log.push({ at: when, customerId, delta: p, reason: 'earn' })
  return p
}

export const balanceOf = (store: Store, customerId: string): number => account(store, customerId).balance
