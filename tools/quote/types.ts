export type OrderLine = { item: string; qty: number }
export type Order = { customer: string; date: string; delivery: boolean; lines: OrderLine[] }
export type QuoteLine = { item: string; qty: number; unitPrice: number; amount: number; isDrink: boolean }
export type Quote = {
  lines: QuoteLine[]
  subtotal: number // รวมก่อนลด
  cups: number // จำนวนแก้วเครื่องดื่มทั้งหมด
  discountPercent: number // 0 | 10 | 15
  discount: number // บาท (จำนวนเต็ม)
  delivery: number // ค่าส่ง
  total: number // ยอดสุทธิ
}
