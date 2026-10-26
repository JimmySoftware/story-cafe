// คิดราคาใบเสนอราคาตามกฎใน briefs/quote.md — ราคามาจากเมนูที่ส่งเข้ามาเท่านั้น
import type { Item } from './catalog.ts'
import type { Order, Quote, QuoteLine } from './types.ts'

export function computeQuote(order: Order, catalog: Item[]): Quote {
  const lines: QuoteLine[] = order.lines.map(({ item, qty }) => {
    const found = catalog.find((c) => c.name === item)
    if (!found) throw new Error(`ไม่พบรายการ "${item}" ในเมนู — โปรดตรวจชื่อให้ตรงกับเมนู`)
    return { item, qty, unitPrice: found.price, amount: found.price * qty, isDrink: found.isDrink }
  })
  const subtotal = lines.reduce((s, l) => s + l.amount, 0)
  const cups = lines.filter((l) => l.isDrink).reduce((s, l) => s + l.qty, 0)
  const drinkTotal = lines.filter((l) => l.isDrink).reduce((s, l) => s + l.amount, 0)
  const discountPercent = cups >= 50 ? 15 : cups >= 30 ? 10 : 0
  const discount = Math.ceil((drinkTotal * discountPercent) / 100)
  const afterDiscount = subtotal - discount
  const delivery = order.delivery && afterDiscount < 1500 ? 100 : 0
  return { lines, subtotal, cups, discountPercent, discount, delivery, total: afterDiscount + delivery }
}
