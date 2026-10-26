// morning_summary — cron เรียกทุกเช้า 07:00 เวลาไทย แล้วส่ง push "สรุปเช้า" หาเจ้าของร้านทาง LINE (briefs/morning.md)
// ความลับ (token, owner id) อยู่ใน env เท่านั้น · คำตอบและ error ไม่มี token
// retry key คำนวณจากวันที่ → cron รันซ้ำวันเดียวกัน LINE ตอบ 409 ไม่ส่งข้อความซ้ำ · ไม่ retry เองในฟังก์ชัน (ให้ cron เป็นฝ่ายลองใหม่)
// ห้าม import อะไรตอนรัน: ใช้เฉพาะ Web API มาตรฐาน
import type { SupabaseClient } from '@supabase/supabase-js'

export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: SupabaseClient }

const TIMEOUT_MS = 5000
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Summary = {
  day: string
  orders: number
  cups: number
  first_pickup: string | null
  last_pickup: string | null
  low_stock: { name: string; stock: number; unit: string; reorder_level: number }[]
}

// SHA-256 ของ "morning-YYYY-MM-DD" ใส่รูป UUID (วันเดียวกัน = key เดิมเสมอ)
export async function retryKeyForDay(day: string): Promise<string> {
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`morning-${day}`)))]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const thaiDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function summaryText(s: Summary): string {
  const lines = [`สรุปเช้า ${thaiDate(s.day)}`]
  if (s.orders > 0) {
    lines.push(`ออเดอร์วันนี้ ${s.orders} ออเดอร์ รวม ${s.cups} แก้ว`)
    lines.push(`รับตั้งแต่ ${s.first_pickup} ถึง ${s.last_pickup} น.`)
  } else {
    lines.push('วันนี้ยังไม่มีออเดอร์สั่งล่วงหน้า')
  }
  if (s.low_stock.length > 0) {
    lines.push('วัตถุดิบใกล้หมด:')
    for (const i of s.low_stock) lines.push(`• ${i.name} เหลือ ${i.stock} ${i.unit}`)
  }
  return lines.join('\n')
}

export default async function handler(req: Request, deps: Deps): Promise<Response> {
  const { env, db } = deps
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const token = env.LINE_CHANNEL_ACCESS_TOKEN ?? ''
  const owner = env.LINE_OWNER_USER_ID ?? ''
  if (!token || !owner) return json(500, { error: 'line_not_configured' })
  const base = (env.LINE_API_BASE || 'https://api.line.me').replace(/\/+$/, '')

  const data = await db.rpc('morning_summary_data')
  if (data.error || !data.data) return json(500, { error: 'server_error' })
  const summary = data.data as Summary

  let res: Response
  try {
    res = await deps.fetch(`${base}/v2/bot/message/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-line-retry-key': await retryKeyForDay(summary.day),
      },
      body: JSON.stringify({ to: owner, messages: [{ type: 'text', text: summaryText(summary) }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return json(502, { error: timedOut ? 'line_timeout' : 'line_network_error' })
  }
  await res.body?.cancel().catch(() => {})
  // 409 = LINE เคยรับ retry key นี้แล้ว → ถือว่าส่งแล้ว
  if (res.status === 200 || res.status === 409) return json(200, { sent: true, day: summary.day, duplicate: res.status === 409 })
  return json(502, { error: 'line_failed', status: res.status })
}
