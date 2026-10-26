// Stripe จำลองสำหรับทดสอบในเครื่อง (ไม่ใช่ Stripe จริง · ไม่สมัครอะไร) — ใช้อัลกอริทึมลงนาม webhook ตามเอกสารทางการ
// https://docs.stripe.com/webhooks (ตรวจ 26 ต.ค. 2026): header `Stripe-Signature: t=<unix>,v1=<hex>` · signed_payload = `${t}.${raw body}` · HMAC-SHA256 กุญแจ = whsec_…
//
// ใช้เป็นเซิร์ฟเวอร์:  node tools/fakes/stripe.mjs --port 12111 [--secret sk_test_fake] [--webhook-secret whsec_fake]
//   แล้วตั้ง STRIPE_API_BASE=http://127.0.0.1:12111  STRIPE_SECRET_KEY=sk_test_fake  STRIPE_WEBHOOK_SECRET=whsec_fake
//   POST /v1/payment_intents (form) · GET /v1/payment_intents/:id · GET /__log (คำขอที่ได้รับ)
//   POST /__fire  {"payment_intent":"pi_…","type":"payment_intent.succeeded","url":"http://…/payment_webhook","event_id":"evt_…"}  ยิง webhook ที่ลงนามแล้ว
import { createServer } from 'node:http'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export function signStripe(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex')
  return `t=${t},v1=${v1}`
}
// ตรวจแบบเดียวกับที่ฝั่งรับต้องทำ (ใช้ในเทสต์ของเครื่องมือเอง)
export function verifyStripe(payload, header, secret, toleranceSec = 300, now = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).map(([k, ...v]) => [k, v.join('=')]))
  if (!parts.t || !parts.v1) return false
  const exp = createHmac('sha256', secret).update(`${parts.t}.${payload}`, 'utf8').digest()
  const got = Buffer.from(parts.v1, 'hex')
  return got.length === exp.length && timingSafeEqual(got, exp) && Math.abs(now - Number(parts.t)) <= toleranceSec
}

export function startFakeStripe({ port = 0, secretKey = 'sk_test_fakefakefakefake', webhookSecret = 'whsec_fakefakefakefake' } = {}) {
  const intents = new Map(), idem = new Map(), log = []
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8'); const url = new URL(req.url, 'http://x')
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    log.push({ method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, idempotencyKey: req.headers['idempotency-key'] ?? null, body: raw })
    if (url.pathname === '/__log') return send(200, log)
    if (url.pathname === '/v1/payment_intents' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${secretKey}`) return send(401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } })
      const key = req.headers['idempotency-key']
      if (key && idem.has(key)) return send(200, idem.get(key))
      const f = new URLSearchParams(raw)
      const amount = Number(f.get('amount'))
      if (!Number.isInteger(amount) || amount < 1 || f.get('currency') !== 'thb' || !f.getAll('payment_method_types[]').includes('promptpay'))
        return send(400, { error: { type: 'invalid_request_error', message: 'Invalid amount/currency/payment_method_types' } })
      const id = `pi_fake_${randomBytes(6).toString('hex')}`
      const metadata = Object.fromEntries([...f.entries()].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))
      const pi = { id, object: 'payment_intent', amount, currency: 'thb', status: 'requires_payment_method', client_secret: `${id}_secret_${randomBytes(6).toString('hex')}`, payment_method_types: ['promptpay'], metadata }
      intents.set(id, pi); if (key) idem.set(key, pi)
      return send(200, pi)
    }
    const m = url.pathname.match(/^\/v1\/payment_intents\/([\w]+)$/)
    if (m && req.method === 'GET') return intents.has(m[1]) ? send(200, intents.get(m[1])) : send(404, { error: { message: 'No such payment_intent' } })
    if (url.pathname === '/__fire' && req.method === 'POST') {
      const o = JSON.parse(raw); const pi = intents.get(o.payment_intent)
      if (!pi) return send(404, { error: 'no such intent' })
      const status = /failed/.test(o.type) ? 'requires_payment_method' : 'succeeded'
      const evt = { id: o.event_id ?? `evt_fake_${randomBytes(6).toString('hex')}`, object: 'event', type: o.type ?? 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), data: { object: { ...pi, status, amount_received: status === 'succeeded' ? (o.amount_received ?? pi.amount) : 0 } } }
      const body = JSON.stringify(evt)
      const r = await fetch(o.url, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signStripe(body, webhookSecret, o.t) }, body })
      return send(200, { event_id: evt.id, delivered_status: r.status, delivered_body: await r.text() })
    }
    send(404, { error: { message: 'unknown route' } })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, secretKey, webhookSecret, log, intents, close: () => new Promise((r) => server.close(r)) })))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), get = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d)
  const s = await startFakeStripe({ port: Number(get('--port', 12111)), secretKey: get('--secret', 'sk_test_fakefakefakefake'), webhookSecret: get('--webhook-secret', 'whsec_fakefakefakefake') })
  console.log(`Stripe จำลองพร้อมที่ ${s.url} (secret ${s.secretKey}, webhook secret ${s.webhookSecret}) — ไม่ใช่ Stripe จริง`)
}
