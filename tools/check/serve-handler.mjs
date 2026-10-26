// serve-handler.mjs <ชื่อฟังก์ชัน> <พอร์ต> — เปิด supabase/functions/<ชื่อ>/handler.ts เป็นเซิร์ฟเวอร์ HTTP ในเครื่อง (Node + tsx) เพื่อให้ตัวตรวจยิงทดสอบ
// สัญญา: handler.ts ส่งออก default async function (req: Request, deps: { env, fetch, db }) => Response และไม่ import อะไรตอนรัน (ทุกอย่างมาทาง deps)
// env ของฟังก์ชันมาจากตัวแปรสภาพแวดล้อมของกระบวนการนี้ · db = supabase-js (secret key ของ Supabase ในเครื่อง)
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const [fn, port] = process.argv.slice(2)
const mod = await import(pathToFileURL(resolve(`supabase/functions/${fn}/handler.ts`)).href)
const handler = mod.default ?? mod.handler
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  const body = Buffer.concat(chunks)
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  try {
    const r = await handler(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { env: { ...process.env }, fetch, db })
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()))
  } catch (e) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(`handler threw: ${e?.message ?? e}`) }
})
server.listen(Number(port), '127.0.0.1', () => console.log('ready'))
