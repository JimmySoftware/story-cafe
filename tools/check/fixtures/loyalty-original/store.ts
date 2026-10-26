// ที่เก็บแต้มของลูกค้า (ในหน่วยความจำ — รุ่นนี้ยังไม่ต่อฐานข้อมูล)
export type Account = { balance: number; earned: number }
export type Entry = { at: Date; customerId: string; delta: number; reason: string }
export type Store = { accounts: Map<string, Account>; log: Entry[] }

export const makeStore = (): Store => ({ accounts: new Map(), log: [] })

export function account(store: Store, customerId: string): Account {
  let a = store.accounts.get(customerId)
  if (!a) {
    a = { balance: 0, earned: 0 }
    store.accounts.set(customerId, a)
  }
  return a
}
