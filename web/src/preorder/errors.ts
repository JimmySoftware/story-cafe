// แปลงรหัส error จากฐานข้อมูล (ข้อความขึ้นต้นด้วยรหัส) เป็นข้อความภาษาไทยสำหรับลูกค้า — ไม่แสดง stack trace
const messages: Record<string, string> = {
  empty_order: 'ยังไม่ได้เลือกเมนู กรุณาเพิ่มอย่างน้อย 1 รายการ',
  bad_slot: 'เวลารับไม่ถูกต้อง กรุณาเลือกจากช่องเวลาที่แสดง',
  outside_hours: 'เวลานี้อยู่นอกเวลาเปิดร้าน กรุณาเลือกช่องอื่น',
  too_far: 'สั่งล่วงหน้าได้เฉพาะวันนี้และพรุ่งนี้เท่านั้น',
  too_late: 'ช่องนี้ใกล้ถึงเวลาแล้ว สั่งไม่ทัน กรุณาเลือกช่องที่หลังกว่านี้',
  slot_full: 'ช่องนี้เต็มแล้ว (หรือแก้วไม่พอสำหรับออเดอร์นี้) กรุณาเลือกช่องอื่น',
  bad_option: 'ตัวเลือกที่เลือกใช้ไม่ได้ (ตัวเลือกใช้กับเครื่องดื่มเท่านั้น และเลือกได้อย่างละ 1 หมวด)',
  bad_item: 'มีเมนูในตะกร้าที่ไม่พบหรือจำนวนไม่ถูกต้อง กรุณาเปิดหน้านี้ใหม่แล้วเลือกอีกครั้ง',
  bad_customer: 'กรุณาใส่ชื่อและเบอร์โทร',
  not_found: 'ไม่พบออเดอร์ หรือเบอร์โทรไม่ตรง',
  too_late_to_cancel: 'เลยเวลายกเลิกแล้ว',
  not_cancellable: 'ออเดอร์นี้ยกเลิกไม่ได้แล้ว',
}

export const fallbackError = 'สั่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือติดต่อร้านทาง LINE'

export function thaiError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : (raw as { message?: unknown } | null)?.message
  if (typeof text !== 'string') return fallbackError
  const code = /^([a-z_]+)(?::|\s|$)/.exec(text.trim())?.[1]
  if (code && messages[code]) return messages[code]
  if (/fetch|network|failed to/i.test(text)) return 'เชื่อมต่อร้านไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'
  return fallbackError
}
