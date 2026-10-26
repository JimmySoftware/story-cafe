// notify_owner — หยิบแถวจาก notify_queue แล้วส่ง push เข้า LINE เจ้าของร้าน (briefs/notify.md)
// ความลับ (token, owner id) อยู่ใน env เท่านั้น · last_error มีแค่รหัสสถานะ ไม่มี token หรือ header
// ห้าม import อะไรตอนรัน: ใช้เฉพาะ Web API มาตรฐาน
import type { SupabaseClient } from '@supabase/supabase-js'

export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: SupabaseClient }

const TIMEOUT_MS = 5000
const CHANNEL_LABEL: Record<string, string> = { store: 'หน้าร้าน', line: 'LINE', web: 'เว็บ', delivery: 'เดลิเวอรี' }
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Row = { id: string; kind: string; payload: { code?: unknown; total?: unknown; channel?: unknown } | null; retry_key: string }
type Outcome = { outcome: 'sent' | 'retry' | 'failed'; error?: string }

export default async function handler(req: Request, deps: Deps): Promise<Response> {
  const { env, db } = deps
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const claimed = await db.rpc('claim_notifications', { p_limit: 10 })
  if (claimed.error) return json(500, { error: 'server_error' })
  const rows = (claimed.data ?? []) as Row[]

  const token = env.LINE_CHANNEL_ACCESS_TOKEN ?? ''
  const owner = env.LINE_OWNER_USER_ID ?? ''
  const base = (env.LINE_API_BASE || 'https://api.line.me').replace(/\/+$/, '')

  const send = async (row: Row): Promise<Outcome> => {
    if (!token || !owner) return { outcome: 'failed', error: 'line_not_configured' }
    const code = row.payload?.code
    const total = row.payload?.total
    if (row.kind !== 'order_placed' || typeof code !== 'string' || !code) return { outcome: 'failed', error: 'bad_payload' }
    const channel = typeof row.payload?.channel === 'string' ? CHANNEL_LABEL[row.payload.channel] : undefined
    const text = `ออเดอร์ใหม่ ${code} · ยอด ${typeof total === 'number' ? total : '-'} บาท${channel ? ` · ช่องทาง ${channel}` : ''}`
    let res: Response
    try {
      res = await deps.fetch(`${base}/v2/bot/message/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-line-retry-key': row.retry_key },
        body: JSON.stringify({ to: owner, messages: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      return { outcome: 'retry', error: timedOut ? 'line_timeout' : 'line_network_error' }
    }
    await res.body?.cancel().catch(() => {})
    if (res.status === 200 || res.status === 409) return { outcome: 'sent' }
    if (res.status === 429 || res.status >= 500) return { outcome: 'retry', error: `HTTP ${res.status}` }
    if (res.status === 400 || res.status === 401 || res.status === 403) return { outcome: 'failed', error: `HTTP ${res.status}` }
    return { outcome: 'failed', error: `HTTP ${res.status}` }
  }

  const count = { sent: 0, retry: 0, failed: 0 }
  for (const row of rows) {
    const r = await send(row)
    count[r.outcome]++
    // บันทึกผลไม่สำเร็จ → แถวยังเป็น pending และ claim เลื่อนเวลาไว้ 5 นาที จะถูกหยิบใหม่ด้วย retry_key เดิม
    await db.rpc('finish_notification', { p_id: row.id, p_outcome: r.outcome, p_error: r.error ?? null })
  }
  return json(200, count)
}
