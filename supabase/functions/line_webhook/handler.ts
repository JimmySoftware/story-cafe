// line_webhook — LINE ยิงมาเมื่อเจ้าของร้านพิมพ์ในแชต · พิมพ์ "ยืนยัน SC-1234" เพื่อยืนยันออเดอร์สั่งล่วงหน้า (briefs/morning.md)
// ใครก็ยิงมาที่ URL นี้ได้ จึงตรวจลายเซ็น x-line-signature กับ body ดิบก่อนทุกอย่าง (ก่อน parse JSON)
// ความลับ (channel secret, token, owner id) อยู่ใน env เท่านั้น · ตอบกลับด้วย reply API (ไม่นับโควตา push)
// ห้าม import อะไรตอนรัน: ใช้เฉพาะ Web API มาตรฐาน
import type { SupabaseClient } from '@supabase/supabase-js'

export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: SupabaseClient }

const TIMEOUT_MS = 5000
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const HELP = 'พิมพ์ "ยืนยัน SC-1234" (ใส่เลขออเดอร์) เพื่อยืนยันออเดอร์สั่งล่วงหน้า'
const CONFIRM = /^ยืนยัน\s+(SC-[A-Za-z0-9]+)$/i

// Base64( HMAC-SHA256(channel secret, body ดิบ) ) เทียบกับ header · crypto.subtle.verify เทียบแบบ constant-time
async function validSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  let sig: Uint8Array
  try {
    sig = Uint8Array.from(atob(header), (c) => c.charCodeAt(0))
  } catch {
    return false
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(raw))
}

type LineEvent = {
  type?: unknown
  webhookEventId?: unknown
  replyToken?: unknown
  source?: { userId?: unknown }
  message?: { type?: unknown; text?: unknown }
}

export default async function handler(req: Request, deps: Deps): Promise<Response> {
  const { env, db } = deps
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const secret = env.LINE_CHANNEL_SECRET ?? ''
  const token = env.LINE_CHANNEL_ACCESS_TOKEN ?? ''
  const owner = env.LINE_OWNER_USER_ID ?? ''
  if (!secret || !owner) return json(500, { error: 'line_not_configured' })
  const base = (env.LINE_API_BASE || 'https://api.line.me').replace(/\/+$/, '')

  // 1) ตรวจลายเซ็นก่อน parse JSON
  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-line-signature'), secret))) return json(401, { error: 'bad_signature' })

  let events: LineEvent[]
  try {
    const body = JSON.parse(raw)
    if (!Array.isArray(body?.events)) throw new Error('no events')
    events = body.events
  } catch {
    return json(400, { error: 'bad_request' })
  }

  // ตอบกลับเจ้าของด้วย reply API · ล้มเหลวก็ไม่เป็นไร (ต้องตอบ 200 ไม่ให้ LINE ส่งซ้ำไม่รู้จบ)
  const reply = async (replyToken: unknown, text: string) => {
    if (typeof replyToken !== 'string' || !replyToken || !token) return
    try {
      const res = await deps.fetch(`${base}/v2/bot/message/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      await res.body?.cancel().catch(() => {})
    } catch {
      // ไม่ทำอะไร
    }
  }

  const confirm = async (code: string): Promise<string> => {
    const r = await db.rpc('confirm_preorder', { p_code: code })
    if (!r.error) return `ยืนยันออเดอร์ ${code} แล้ว`
    const msg = r.error.message ?? ''
    if (msg.includes('not_found')) return `ไม่พบออเดอร์ ${code}`
    if (msg.includes('bad_status')) {
      const o = await db.from('orders').select('status').eq('code', code).maybeSingle()
      return `ออเดอร์ ${code} ยืนยันไม่ได้ (สถานะ ${o.data?.status ?? 'ไม่ทราบ'})`
    }
    return 'ระบบขัดข้อง ยืนยันออเดอร์ไม่ได้ ลองใหม่อีกครั้ง'
  }

  for (const ev of events) {
    const id = ev?.webhookEventId
    if (typeof id !== 'string' || !id) continue
    // event ซ้ำ (LINE ส่งซ้ำ รวมถึง isRedelivery) → ข้าม · บันทึกไม่ได้ → 500 ให้ LINE ลองใหม่
    const seen = await db.rpc('record_line_event', { p_id: id })
    if (seen.error) return json(500, { error: 'server_error' })
    if (seen.data !== true) continue

    if (ev.type !== 'message' || ev.message?.type !== 'text' || typeof ev.message.text !== 'string') continue
    // คนอื่นที่ไม่ใช่เจ้าของพิมพ์อะไรก็ไม่ทำอะไร และไม่ตอบ
    if (ev.source?.userId !== owner) continue

    const m = CONFIRM.exec(ev.message.text.trim())
    await reply(ev.replyToken, m ? await confirm(m[1].toUpperCase()) : HELP)
  }
  return json(200, { ok: true })
}
