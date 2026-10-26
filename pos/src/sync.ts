// คิวบิลของ POS บน localStorage + ส่งผ่าน rpc pos_record_bill
import { createBillQueue, type PendingBill } from './queue.ts'
import { supabase } from './supabase.ts'

// error ที่เซิร์ฟเวอร์ปฏิเสธเพราะตัวบิลผิด (ส่งกี่ครั้งก็ไม่ผ่าน) ขึ้นต้นข้อความด้วย '<code>: ' ตาม briefs/offline.md
// เน็ตหลุด / 5xx / token หมดอายุ / ไม่ใช่พนักงาน (forbidden) = ลองใหม่ได้ ไม่ทิ้งบิล
const REJECTED = /^(unknown_item|bad_qty|bad_option|bad_points|empty_bill|cash_short|bad_at|bad_request): /

async function send(b: PendingBill): Promise<{ duplicate?: boolean }> {
  const { data, error } = await supabase.rpc('pos_record_bill', {
    p_client_order_id: b.client_order_id,
    p_lines: b.lines,
    p_redeem_points: b.redeem_points ?? 0,
    p_points_balance: b.points_balance ?? 0,
    p_cash_received: b.cash_received ?? null,
    p_at: b.at,
    p_customer_phone: b.customer_phone ?? null,
  })
  if (error) throw Object.assign(new Error(error.message), { retryable: !REJECTED.test(error.message) })
  return { duplicate: (data as { duplicate?: boolean } | null)?.duplicate }
}

export const queue = createBillQueue(localStorage, send, { key: 'pos_bill_queue' })
