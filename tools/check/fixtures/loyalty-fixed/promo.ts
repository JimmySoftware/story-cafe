// โปรโมชัน: วันเสาร์ (ตามเวลาไทย Asia/Bangkok) แต้มคูณ 2
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' })
export function isDoublePointsDay(when: Date): boolean {
  return fmt.format(when) === 'Sat'
}
