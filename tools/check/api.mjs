// ตัวช่วยตรวจที่คุยกับ Supabase ในเครื่องผ่าน HTTP (Auth + PostgREST) — ใช้ key ของเครื่องตัวเองเท่านั้น
import { localEnv } from './db.mjs'

let _env
export const env = () => (_env ??= localEnv())
const call = async (path, { key, token, body, method, headers = {} } = {}) => {
  const e = env()
  const r = await fetch(`${e.SUPABASE_URL}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { apikey: key ?? e.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token ?? key ?? e.SUPABASE_PUBLISHABLE_KEY}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text(); let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, ok: r.ok, body: json, text }
}
export const api = call
export const rpc = (name, args, token) => call(`/rest/v1/rpc/${name}`, { token, body: args ?? {} })
// สร้างผู้ใช้ทดสอบ (ยืนยันอีเมลแล้ว) แล้วล็อกอิน → { id, token, email }
export async function newUser(tag, { appMetadata } = {}) {
  const email = `check-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`, password = 'Check-pass-123'
  const c = await call('/auth/v1/admin/users', { key: env().SUPABASE_SECRET_KEY, body: { email, password, email_confirm: true, ...(appMetadata ? { app_metadata: appMetadata } : {}) } })
  if (!c.ok) throw new Error(`สร้างผู้ใช้ทดสอบไม่ได้ (${c.status}): ${c.text.slice(0, 120)}`)
  const s = await call('/auth/v1/token?grant_type=password', { body: { email, password } })
  if (!s.ok) throw new Error(`ล็อกอินผู้ใช้ทดสอบไม่ได้ (${s.status}): ${s.text.slice(0, 120)}`)
  return { id: c.body.id, token: s.body.access_token, email }
}
export const delUser = (id) => call(`/auth/v1/admin/users/${id}`, { key: env().SUPABASE_SECRET_KEY, method: 'DELETE' })
