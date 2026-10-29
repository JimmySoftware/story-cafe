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

// ตัวตรวจต้องคืนฐานข้อมูลให้เหมือนที่เจอ (fix รอบ 2): test SQL ของผู้เรียนมักสมมติว่าตารางมีแต่แถวของตัวเอง
// (คิวแจ้งเตือน, ตัวนับเลขบิล, stock_history, pickup_slots, แต้มสะสม …) ถ้า probe ของข้อไหนทิ้งแถวไว้ test:db จะตกในบทหลัง ๆ
// dbMark() จดทุกแถวของทุกตารางใน schema public (เฉพาะตารางที่มี primary key) ก่อนรันแต่ละข้อ
// dbSweep() หลังรันข้อนั้น: ลบแถวที่เพิ่มมา และคืนค่าแถวเดิมที่ถูกแก้ (เช่น สต็อก, จำนวนแก้วในช่อง) — แถวของผู้เรียนที่มีอยู่ก่อนไม่ถูกแตะ
const PKS = `select c.relname || ':' || string_agg(quote_ident(a.attname), ',' order by k.ord)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_index i on i.indrelid = c.oid and i.indisprimary
  cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
  join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
  where n.nspname = 'public' and c.relkind = 'r' group by c.relname order by c.relname`
function dbSnap() {
  const pks = sql(PKS)
  if (!pks.ok) return null
  const tabs = pks.out.trim().split('\n').filter(Boolean).map((l) => { const [t, c] = l.split(':'); return { t, cols: c.split(',') } })
  if (!tabs.length) return { tabs: [], data: {} }
  const key = (cols) => `concat_ws('~', ${cols.map((c) => `x.${c}::text`).join(', ')})`
  const q = `select json_build_object(${tabs.map(({ t, cols }) => `'${t}', (select coalesce(json_object_agg(${key(cols)}, row_to_json(x)), '{}'::json) from public."${t}" x)`).join(', ')})::text`
  const r = run('docker', ['exec', '-i', container(), 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', q], { maxBuffer: 256 * 1024 * 1024 })
  if (!r.ok) return null
  try { return { tabs, data: JSON.parse(r.out.trim()) } } catch { return null }
}
export function dbMark() { try { return dbSnap() } catch { return null } }
export function dbSweep(mark) {
  if (!mark) return
  try {
    const now = dbSnap(); if (!now) return
    const lit = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::json`
    const del = [], upd = []
    for (const { t, cols } of mark.tabs) {
      const before = mark.data[t] ?? {}, after = now.data[t] ?? {}
      const where = (k, a = '') => { const v = k.split('~'); return cols.map((c, i) => `${a}${c}::text = '${(v[i] ?? '').replace(/'/g, "''")}'`).join(' and ') }
      for (const k of Object.keys(after)) {
        if (!(k in before)) del.push({ t, k, where: where(k) })
        else if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) upd.push({ t, k, row: before[k], where: where(k, 'x.') })
      }
    }
    for (const u of upd) {
      const cs = (rows(`select quote_ident(attname) from pg_attribute where attrelid = 'public."${u.t}"'::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attidentity <> 'a'`) ?? []).map((r) => r[0]).filter((c) => (c.replace(/"/g, '') in u.row))
      if (cs.length) sql(`update public."${u.t}" x set ${cs.map((c) => `${c} = r.${c}`).join(', ')} from json_populate_record(null::public."${u.t}", ${lit(u.row)}) r where ${u.where}`)
    }
    // ลบแบบรอบ ๆ: ตารางลูกก่อนตารางแม่ (ลบไม่ได้เพราะ foreign key ก็ลองใหม่รอบหน้า)
    let left = del
    for (let pass = 0; pass < 5 && left.length; pass++) {
      left = left.filter((d) => !sql(`delete from public."${d.t}" where ${d.where}`).ok)
    }
  } catch {}
}
export const queueMark = dbMark, queueSweep = dbSweep // ชื่อเดิม (fix รอบ 1) — เรียกตัวใหม่
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
