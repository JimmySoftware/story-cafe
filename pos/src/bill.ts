// คิดบิลหน้าร้าน — ฟังก์ชันล้วน ไม่มี side effect ราคาทุกตัวมาจาก catalog (data/menu.csv + data/options.csv)
export type Catalog = { items: { name: string; price: number; is_drink: boolean }[]; options: { kind: string; label: string; price_delta: number }[] }
export type BillLine = { item: string; qty: number; options?: { size?: 'S' | 'M' | 'L'; sweetness?: string; milk?: string; extra_shots?: number } }
export type BillInput = { lines: BillLine[]; redeem_points?: number; points_balance?: number; cash_received?: number; at?: string }
export type Bill = {
  lines: { item: string; qty: number; unit_price: number; line_total: number; label: string }[]
  subtotal: number; discount: number; total: number
  cash_received: number | null; change: number | null
  points_earned: number; points_redeemed: number
}

const fail = (code: string, message: string): never => {
  throw new Error(`${code}: ${message}`)
}

const findOption = (catalog: Catalog, kind: string, label: string) => {
  const found = catalog.options.find((o) => o.kind === kind && o.label === label)
  return found ?? fail('bad_option', `ไม่มีตัวเลือก "${label}" ในหมวด ${kind}`)
}

// วันเสาร์ตามเวลาไทย (Asia/Bangkok) ไม่ใช่ UTC — ไม่ระบุ at = ตอนนี้
const isSaturdayInBangkok = (at: string | undefined): boolean => {
  const date = at === undefined ? new Date() : new Date(at)
  if (Number.isNaN(date.getTime())) fail('bad_at', `เวลาของบิล "${at}" อ่านไม่ได้ ให้ใช้รูปแบบ ISO เช่น 2026-10-24T10:00:00+07:00`)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' }).format(date) === 'Sat'
}

export function computeBill(input: BillInput, catalog: Catalog): Bill {
  if (!input.lines || input.lines.length === 0) fail('empty_bill', 'ยังไม่มีรายการในบิล')

  const redeem = input.redeem_points ?? 0
  const balance = input.points_balance ?? 0
  for (const n of [redeem, balance]) {
    if (!Number.isInteger(n) || n < 0) fail('bad_points', 'แต้มต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป')
  }

  const lines = input.lines.map((line) => {
    const item = catalog.items.find((i) => i.name === line.item) ?? fail('unknown_item', `ไม่มีเมนู "${line.item}"`)
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 99) fail('bad_qty', `จำนวนของ "${line.item}" ต้องเป็นจำนวนเต็ม 1–99`)

    const opt = line.options ?? {}
    const shots = opt.extra_shots ?? 0
    if (!Number.isInteger(shots) || shots < 0 || shots > 4) fail('bad_option', 'จำนวนช็อตเพิ่มต้องเป็นจำนวนเต็ม 0–4')
    const hasOption = opt.size !== undefined || opt.sweetness !== undefined || opt.milk !== undefined || shots > 0
    if (hasOption && !item.is_drink) fail('bad_option', `"${line.item}" ไม่ใช่เครื่องดื่ม เลือกตัวเลือกไม่ได้`)

    let unit = item.price
    const parts = [item.name]
    if (opt.size !== undefined) {
      unit += findOption(catalog, 'size', opt.size).price_delta
      parts.push(opt.size)
    }
    if (opt.milk !== undefined) {
      unit += findOption(catalog, 'milk', opt.milk).price_delta
      parts.push(opt.milk)
    }
    if (opt.sweetness !== undefined) {
      findOption(catalog, 'sweetness', opt.sweetness)
      parts.push(`หวาน ${opt.sweetness}`)
    }
    if (shots > 0) {
      const extra = catalog.options.find((o) => o.kind === 'extra') ?? fail('bad_option', 'ไม่มีตัวเลือกช็อตเพิ่มในแคตตาล็อก')
      unit += shots * extra.price_delta
      parts.push(`+shot ×${shots}`)
    }
    return { item: item.name, qty: line.qty, unit_price: unit, line_total: unit * line.qty, label: parts.join(' ') }
  })

  const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0)
  const points_redeemed = Math.min(redeem, balance, subtotal)
  const total = subtotal - points_redeemed

  let cash_received: number | null = null
  let change: number | null = null
  if (input.cash_received !== undefined) {
    if (!(input.cash_received >= total)) fail('cash_short', `เงินที่รับ ${input.cash_received} บาท ไม่พอ ต้องจ่าย ${total} บาท`)
    cash_received = input.cash_received
    change = cash_received - total
  }

  const points_earned = Math.floor(total / 25) * (isSaturdayInBangkok(input.at) ? 2 : 1)
  return { lines, subtotal, discount: points_redeemed, total, cash_received, change, points_earned, points_redeemed }
}
