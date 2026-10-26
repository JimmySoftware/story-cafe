// LINE Messaging API จำลองสำหรับทดสอบในเครื่อง (ไม่ใช่ LINE จริง · ไม่สมัครอะไร)
// อัลกอริทึมตามเอกสารทางการ (ตรวจ 26 ต.ค. 2026): https://developers.line.biz/en/reference/messaging-api/
//  • ลายเซ็น webhook: header x-line-signature = Base64( HMAC-SHA256(channel secret, request body ดิบ) )
//  • push: POST /v2/bot/message/push (Authorization: Bearer <channel access token>) · header X-Line-Retry-Key = UUID → ถ้าเคยรับ key นี้แล้วตอบ 409 + x-line-accepted-request-id
//  • reply: POST /v2/bot/message/reply (replyToken ใช้ได้ครั้งเดียว)
//
// ใช้เป็นเซิร์ฟเวอร์:  node tools/fakes/line.mjs --port 12222 [--token fake-token] [--secret 0123…32 hex]
//   ตั้ง LINE_API_BASE=http://127.0.0.1:12222  LINE_CHANNEL_ACCESS_TOKEN=fake-token
//   GET /__log (ข้อความที่ได้รับ) · POST /__mode {"mode":"ok|500|429|401|timeout"} จำลอง LINE ล่ม
//   POST /__webhook {"url":"…","events":[…]} ยิง webhook ที่ลงนามแล้วไปที่ url
import { createServer } from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const signLine = (rawBody, channelSecret) => createHmac('sha256', channelSecret).update(rawBody).digest('base64')
export function verifyLine(rawBody, signature, channelSecret) {
  const exp = Buffer.from(signLine(rawBody, channelSecret)), got = Buffer.from(signature ?? '')
  return exp.length === got.length && timingSafeEqual(exp, got)
}

export function startFakeLine({ port = 0, token = 'fake-line-token', channelSecret = '0123456789abcdef0123456789abcdef' } = {}) {
  const log = [], retryKeys = new Map(), replyTokens = new Set(); let mode = 'ok'
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8'); const url = new URL(req.url, 'http://x')
    const send = (code, obj, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(obj)) }
    if (url.pathname === '/__log') return send(200, log)
    if (url.pathname === '/__mode') { mode = JSON.parse(raw).mode; return send(200, { mode }) }
    if (url.pathname === '/__webhook' && req.method === 'POST') {
      const o = JSON.parse(raw); const body = JSON.stringify({ destination: 'Ufake', events: o.events })
      const r = await fetch(o.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': o.badSignature ? 'AAAA' : signLine(body, channelSecret) }, body })
      return send(200, { status: r.status, body: await r.text() })
    }
    const entry = { method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, retryKey: req.headers['x-line-retry-key'] ?? null, body: raw, result: null }
    log.push(entry)
    if (!['/v2/bot/message/push', '/v2/bot/message/reply'].includes(url.pathname)) { entry.result = 404; return send(404, { message: 'unknown route' }) }
    if (mode === 'timeout') return // ไม่ตอบ
    if (mode === '500') { entry.result = 500; return send(500, { message: 'fake server error' }) }
    if (mode === '429') { entry.result = 429; return send(429, { message: 'fake rate limit' }) }
    if (mode === '401' || req.headers.authorization !== `Bearer ${token}`) { entry.result = 401; return send(401, { message: 'Authentication failed due to the following reason: invalid token' }) }
    let body; try { body = JSON.parse(raw) } catch { entry.result = 400; return send(400, { message: 'bad json' }) }
    if (!Array.isArray(body.messages) || !body.messages.length || (url.pathname.endsWith('push') && !body.to) || (url.pathname.endsWith('reply') && !body.replyToken)) { entry.result = 400; return send(400, { message: 'Failed to send messages' }) }
    const rid = randomUUID()
    if (url.pathname.endsWith('reply')) {
      if (replyTokens.has(body.replyToken)) { entry.result = 400; return send(400, { message: 'Invalid reply token' }) }
      replyTokens.add(body.replyToken)
    } else if (entry.retryKey) {
      if (retryKeys.has(entry.retryKey)) { entry.result = 409; return send(409, { message: 'The retry key is already accepted' }, { 'x-line-accepted-request-id': retryKeys.get(entry.retryKey) }) }
      retryKeys.set(entry.retryKey, rid)
    }
    entry.result = 200; send(200, { sentMessages: body.messages.map((_, i) => ({ id: `${Date.now()}${i}` })) }, { 'x-line-request-id': rid })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, port: server.address().port, token, channelSecret, log, setMode: (m) => { mode = m },
    close: () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)) },
  })))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), get = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d)
  const s = await startFakeLine({ port: Number(get('--port', 12222)), token: get('--token', 'fake-line-token'), channelSecret: get('--secret', '0123456789abcdef0123456789abcdef') })
  console.log(`LINE จำลองพร้อมที่ ${s.url} (token ${s.token}) — ไม่ใช่ LINE จริง`)
}
