// แปลง error ของร้านค้า (create_order + Supabase Auth) เป็นภาษาไทย — ไม่แสดง stack trace หรือข้อความดิบ
const orderMessages: Record<string, string> = {
  not_authenticated: 'กรุณาเข้าสู่ระบบก่อนสั่งซื้อ',
  empty_order: 'ตะกร้ายังว่าง กรุณาเลือกสินค้าอย่างน้อย 1 รายการ',
  bad_qty: 'จำนวนต้องเป็นเลข 1–10 ต่อรายการ',
  bad_product: 'มีสินค้าในตะกร้าที่ไม่พบหรือหยุดขายแล้ว กรุณาโหลดหน้าใหม่',
  out_of_stock: 'สินค้าบางรายการเหลือไม่พอ (อาจมีคนสั่งตัดหน้า) ไม่มีอะไรถูกสั่ง กรุณาตรวจจำนวนแล้วลองใหม่',
  bad_ship: 'กรุณากรอกชื่อ เบอร์โทร และที่อยู่จัดส่งให้ครบ',
}

const authMessages: Record<string, string> = {
  invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  user_already_exists: 'อีเมลนี้สมัครไว้แล้ว กรุณาเข้าสู่ระบบ',
  email_exists: 'อีเมลนี้สมัครไว้แล้ว กรุณาเข้าสู่ระบบ',
  weak_password: 'รหัสผ่านสั้นหรือเดาง่ายเกินไป (อย่างน้อย 6 ตัวอักษร)',
  email_not_confirmed: 'ยังไม่ได้ยืนยันอีเมล กรุณาเปิดอีเมลที่ร้านส่งให้',
  validation_failed: 'รูปแบบอีเมลไม่ถูกต้อง',
  over_request_rate_limit: 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
  over_email_send_rate_limit: 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
  signup_disabled: 'ตอนนี้ปิดรับสมัครสมาชิก',
}

export const fallback = 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือติดต่อร้านทาง LINE'
const network = 'เชื่อมต่อร้านไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'

export function thaiError(raw: unknown): string {
  const e = raw as { message?: unknown; code?: unknown } | null
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : e?.message
  if (typeof e?.code === 'string' && authMessages[e.code]) return authMessages[e.code]
  if (typeof text !== 'string') return fallback
  const code = /^([a-z_]+)(?::|\s|$)/.exec(text.trim())?.[1]
  if (code && orderMessages[code]) return orderMessages[code]
  if (/fetch|network|failed to/i.test(text)) return network
  return fallback
}
