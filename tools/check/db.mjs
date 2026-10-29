// ตัวช่วยตรวจฐานข้อมูล Supabase ในเครื่อง — คุยกับ Postgres ผ่าน docker exec (ไม่ต้องติดตั้ง psql)
import { read, run, exists, lines } from './lib.mjs'

export const cfg = () => {
  const t = read('supabase/config.toml')
  return { id: t.match(/^project_id\s*=\s*"(.+?)"/m)?.[1], api: Number(t.match(/\[api\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1] ?? 54321) }
}
export const container = () => `supabase_db_${cfg().id}`

// รัน SQL (หลายคำสั่งได้) ในฐานะ postgres → { ok, out }
export function sql(q) {
  return run('docker', ['exec', '-i', container(), 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', q])
}
// ผลลัพธ์เป็นแถว (คอลัมน์คั่นด้วย |) · ถ้า SQL ผิดคืน null
export function rows(q) {
  const r = sql(q)
  return r.ok ? r.out.trim().split('\n').filter(Boolean).map((l) => l.split('|')) : null
}
export const scalar = (q) => rows(q)?.[0]?.[0] ?? null
// รัน SQL ในฐานะ role (anon / authenticated) แล้ว rollback ทุกอย่าง
export const asRole = (role, q) => sql(`begin; set local role ${role}; ${q}; rollback;`)

// ตัวตรวจทิ้งแถวในคิวแจ้งเตือน (notify_queue) ไว้ไม่ได้: test SQL ของผู้เรียนมักสมมติว่าคิวมีแต่แถวของตัวเอง
// queueMark() จดรหัสแถวที่มีอยู่ก่อนรันแต่ละข้อ · queueSweep() ลบเฉพาะแถวที่ข้อนั้นสร้างเพิ่ม (แถวเดิมของผู้เรียนไม่แตะ)
export function queueMark() {
  try {
    if (scalar("select to_regclass('public.notify_queue') is not null") !== 't') return null
    return new Set(rows('select id from public.notify_queue')?.map((r) => r[0]) ?? [])
  } catch { return null }
}
export function queueSweep(mark) {
  if (!mark) return
  try {
    const now = rows('select id from public.notify_queue')?.map((r) => r[0]) ?? []
    const mine = now.filter((id) => !mark.has(id))
    if (mine.length) sql(`delete from public.notify_queue where id in (${mine.map((i) => `'${i}'`).join(',')})`)
  } catch {}
}

export const dbUp = () => scalar('select 1') === '1'

// CSV แบบง่าย (ไม่มี quote) ของร้าน → [{หัว: ค่า}]
export function csv(path) {
  const [head, ...rest] = lines(path).filter((l) => l.trim())
  const cols = head.split(',')
  return rest.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])))
}

const DEMO_PUB = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const DEMO_SECRET = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
// URL + key ของ Supabase ในเครื่อง (จาก supabase status; ค่าเริ่มต้นของเครื่องมือถ้าอ่านไม่ได้)
export function localEnv() {
  const r = run('npx', ['--no-install', 'supabase', 'status', '-o', 'env'])
  const get = (k) => r.out.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1]
  const api = cfg().api
  return {
    SUPABASE_URL: get('API_URL') ?? `http://127.0.0.1:${api}`,
    SUPABASE_PUBLISHABLE_KEY: get('PUBLISHABLE_KEY') ?? get('ANON_KEY') ?? DEMO_PUB, // ค่าตายตัวของ Supabase ในเครื่องทุกโปรเจกต์
    SUPABASE_SECRET_KEY: get('SECRET_KEY') ?? get('SERVICE_ROLE_KEY') ?? DEMO_SECRET,
    DB_URL: get('DB_URL') ?? '',
  }
}
export const hasMigrations = () => exists('supabase/migrations')
