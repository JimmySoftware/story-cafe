// payment_webhook — รับ event จาก Stripe แล้วเปลี่ยนสถานะออเดอร์ (briefs/payment.md)
// สถานะ "จ่ายแล้ว" เชื่อ webhook ที่ลายเซ็นถูกต้องเท่านั้น
// ห้าม import อะไรตอนรัน: ใช้เฉพาะ Web API มาตรฐาน (crypto.subtle, Request/Response)
import type { SupabaseClient } from '@supabase/supabase-js'

export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: SupabaseClient }

const TOLERANCE_SEC = 300
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const enc = new TextEncoder()

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16))
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…] · signed_payload = `${t}.${raw body}` · HMAC-SHA256 กุญแจ whsec_…
// ใช้เฉพาะ v1 · เทียบด้วย crypto.subtle.verify (constant-time) · t ห่างจากตอนนี้เกิน 300 วินาที → ไม่ผ่าน
async function verifySignature(raw: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header) return false
  let t = ''
  const v1: string[] = []
  for (const part of header.split(',')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim()
    if (k === 't') t = v
    else if (k === 'v1') v1.push(v)
  }
  if (!/^\d{1,12}$/.test(t) || v1.length === 0) return false
  if (Math.abs(nowSec - Number(t)) > TOLERANCE_SEC) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const data = enc.encode(`${t}.${raw}`)
  let ok = false
  for (const sig of v1) {
    const bytes = hexToBytes(sig)
    if (bytes && bytes.length === 32 && (await crypto.subtle.verify('HMAC', key, bytes, data))) ok = true
  }
  return ok
}

type StripeEvent = { id: string; type: string; data?: { object?: { id?: unknown; amount_received?: unknown; metadata?: { order_code?: unknown } } } }

export default async function handler(req: Request, deps: Deps): Promise<Response> {
  const { env, db } = deps
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const secret = env.STRIPE_WEBHOOK_SECRET ?? ''
  if (!secret) return json(500, { error: 'server_misconfigured' })

  // 1) ตรวจลายเซ็นกับตัวอักษรดิบก่อน parse JSON เสมอ
  const raw = await req.text()
  if (!(await verifySignature(raw, req.headers.get('stripe-signature'), secret))) return json(400, { error: 'bad_signature' })

  let evt: StripeEvent
  try { evt = JSON.parse(raw) } catch { return json(400, { error: 'bad_request' }) }
  if (!evt || typeof evt.id !== 'string' || !evt.id || typeof evt.type !== 'string') return json(400, { error: 'bad_request' })

  // 2) กันซ้ำด้วย event id
  const rec = await db.rpc('record_stripe_event', { p_id: evt.id, p_type: evt.type })
  if (rec.error) return json(500, { error: 'server_error' })
  if (rec.data === false) return json(200, { duplicate: true })

  // ประมวลผลไม่สำเร็จ → คืน event id เพื่อให้ Stripe ส่งซ้ำแล้วทำใหม่ได้ (ไม่ทำให้จ่ายเงินแล้วหาย)
  const fail = async (status: number, error: string) => {
    await db.from('stripe_events').delete().eq('id', evt.id)
    return json(status, { error })
  }

  const obj = evt.data?.object
  if (evt.type === 'payment_intent.succeeded') {
    const code = obj?.metadata?.order_code
    const received = obj?.amount_received
    if (typeof code !== 'string' || !code || typeof received !== 'number' || !Number.isInteger(received) || received < 0 || received % 100 !== 0) {
      return fail(400, 'bad_event')
    }
    const { error } = await db.rpc('mark_order_paid', { p_code: code, p_ref: String(obj?.id ?? ''), p_amount: received / 100 })
    if (error) {
      const m = error.message ?? ''
      if (m.includes('amount_mismatch')) return fail(400, 'amount_mismatch')
      if (m.includes('not_found')) return fail(400, 'order_not_found')
      if (m.includes('not_pending')) return fail(400, 'order_not_pending')
      return fail(500, 'server_error')
    }
  } else if (evt.type === 'payment_intent.payment_failed') {
    if (typeof obj?.id === 'string') {
      // ไม่ถอยสถานะที่จ่ายสำเร็จแล้ว · ออเดอร์ยัง pending
      const { error } = await db.from('payments').update({ status: 'failed' }).eq('provider_ref', obj.id).eq('status', 'created')
      if (error) return fail(500, 'server_error')
    }
  }
  // event ชนิดอื่น → ข้าม
  return json(200, { received: true })
}
