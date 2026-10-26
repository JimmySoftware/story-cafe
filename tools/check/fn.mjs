// ตัวช่วยเปิด/ยิงฟังก์ชัน supabase/functions/<ชื่อ>/handler.ts ในเครื่อง (Node + tsx) — ใช้ในตัวตรวจบท 13, 15, 16
import { spawn } from 'node:child_process'
import { env } from './api.mjs'

let nextPort = 24100 + Math.floor(Math.random() * 400)

// เปิดฟังก์ชัน handler.ts เป็นเซิร์ฟเวอร์ Node แล้วคืน { url, stop }
export async function serve(fn, extraEnv) {
  const port = nextPort++
  const p = spawn('node', ['--import', 'tsx', 'tools/check/serve-handler.mjs', fn, String(port)], { env: { ...process.env, SUPABASE_URL: env().SUPABASE_URL, SUPABASE_SECRET_KEY: env().SUPABASE_SECRET_KEY, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''; p.stderr.on('data', (d) => (err += d))
  await new Promise((res, rej) => { p.stdout.on('data', (d) => /ready/.test(String(d)) && res()); p.on('exit', () => rej(new Error(`เปิด ${fn} ไม่ได้: ${err.slice(0, 300)}`))); setTimeout(() => rej(new Error(`เปิด ${fn} ไม่ทัน 20 วินาที: ${err.slice(0, 300)}`)), 20000) })
  return { url: `http://127.0.0.1:${port}`, stop: () => p.kill() }
}
export const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const text = await r.text(); let json; try { json = JSON.parse(text) } catch { json = null }
  return { status: r.status, text, json }
}

