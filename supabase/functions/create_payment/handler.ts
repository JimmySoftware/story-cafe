// create_payment — สร้าง Stripe PaymentIntent (PromptPay) ให้ออเดอร์ที่ยัง pending (briefs/payment.md)
// ห้าม import อะไรตอนรัน: ใช้เฉพาะ Web API มาตรฐาน (รันได้ทั้ง Node ตอนทดสอบและ Deno ตอน deploy)
import type { SupabaseClient } from '@supabase/supabase-js'

export type Deps = { env: Record<string, string | undefined>; fetch: typeof fetch; db: SupabaseClient }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default async function handler(req: Request, deps: Deps): Promise<Response> {
  const { env, db } = deps
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // ปฏิเสธ key ที่ไม่ใช่โหมดทดสอบก่อนทำอย่างอื่น (ไม่เรียก Stripe เลย)
  const key = env.STRIPE_SECRET_KEY ?? ''
  if (!key.startsWith('sk_test_')) return json(500, { error: 'server_misconfigured' })

  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!jwt) return json(401, { error: 'unauthorized' })
  const { data: auth, error: authErr } = await db.auth.getUser(jwt)
  if (authErr || !auth?.user) return json(401, { error: 'unauthorized' })

  let code: unknown
  try { code = ((await req.json()) as { order_code?: unknown })?.order_code } catch { /* ตกไปที่ 400 */ }
  if (typeof code !== 'string' || !code) return json(400, { error: 'bad_request' })

  // ยอดมาจากฐานข้อมูลเท่านั้น (ไม่อ่าน amount ที่ลูกค้าส่งมา)
  const { data: order, error: orderErr } = await db.from('shop_orders').select('id,status,total')
    .eq('code', code).eq('user_id', auth.user.id).maybeSingle()
  if (orderErr) return json(500, { error: 'server_error' })
  if (!order) return json(404, { error: 'order_not_found' })
  if (order.status !== 'pending') return json(409, { error: 'order_not_pending' })

  const form = new URLSearchParams({ amount: String(order.total * 100), currency: 'thb', 'metadata[order_code]': code })
  form.append('payment_method_types[]', 'promptpay')
  let pi: { id?: unknown; client_secret?: unknown }
  try {
    const base = (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '')
    const res = await deps.fetch(`${base}/v1/payment_intents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `order-${code}` },
      body: form,
    })
    if (!res.ok) return json(502, { error: 'payment_provider_error' })
    pi = await res.json()
  } catch {
    return json(502, { error: 'payment_provider_error' })
  }
  if (typeof pi?.id !== 'string' || typeof pi.client_secret !== 'string') return json(502, { error: 'payment_provider_error' })

  // กดซ้ำได้ PaymentIntent เดิมจาก Stripe → upsert ตาม order_id ไม่เกิดแถวซ้ำ
  const { error: saveErr } = await db.from('payments').upsert(
    { order_id: order.id, provider_ref: pi.id, amount: order.total, status: 'created' },
    { onConflict: 'order_id', ignoreDuplicates: true },
  )
  if (saveErr) return json(500, { error: 'server_error' })

  return json(200, { payment_intent_id: pi.id, client_secret: pi.client_secret, amount_thb: order.total })
}
