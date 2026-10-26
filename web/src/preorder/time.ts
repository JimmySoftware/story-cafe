// วันที่/เวลาเป็นเวลาไทย (Asia/Bangkok) เสมอ ไม่ขึ้นกับเขตเวลาของเครื่องลูกค้า
const TZ = 'Asia/Bangkok'

/** วันที่ (YYYY-MM-DD) ของวันนี้ + offset วัน ตามเวลาไทย */
export function bangkokDay(offsetDays: number, now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now) // YYYY-MM-DD
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

export const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T00:00:00Z`))

export const dateTimeLabel = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
