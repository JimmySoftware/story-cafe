// โปรโมชัน: วันเสาร์ แต้มคูณ 2
export function isDoublePointsDay(when: Date): boolean {
  // เวลาไทย = UTC+7 ไม่มี DST เลื่อนเวลาแล้วอ่านวันแบบ UTC
  return new Date(when.getTime() + 7 * 60 * 60 * 1000).getUTCDay() === 6
}
