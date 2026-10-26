// usage-check.mjs — เตือนก่อนฐานข้อมูลเต็มลิมิตแผนฟรี (ลิมิตอ่านจาก data/free-tier.json ที่เดียว)
// ขนาดฐาน: pg_database_size ของ Supabase ในเครื่อง หรือ env CAFE_FAKE_DB_BYTES (ไว้ทดสอบ)
// ใช้: node tools/usage-check.mjs → exit 0 = ปกติ · exit 1 = ใกล้เต็ม (≥ 80%) หรือเต็มแล้ว (≥ 100%)
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const WARN_AT = 0.8 // เกณฑ์เตือนตาม brief: ใกล้เต็มเมื่อใช้ถึง 80% ของลิมิต
const limits = JSON.parse(readFileSync(new URL('../data/free-tier.json', import.meta.url), 'utf8'))
const limitMb = limits.db_mb
if (!Number.isFinite(limitMb) || limitMb <= 0) { console.error('ตรวจไม่ได้: data/free-tier.json ไม่มีค่า db_mb ที่ใช้ได้'); process.exit(1) }

function dbBytes() {
  const fake = process.env.CAFE_FAKE_DB_BYTES
  if (fake !== undefined && fake !== '') {
    const n = Number(fake)
    if (!Number.isFinite(n) || n < 0) { console.error(`ตรวจไม่ได้: CAFE_FAKE_DB_BYTES ต้องเป็นตัวเลขไบต์ (ได้ "${fake}")`); process.exit(1) }
    return n
  }
  const project = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"(.*)"/m)?.[1]
  const c = process.env.DB_CONTAINER ?? `supabase_db_${project}`
  const r = spawnSync('docker', ['exec', c, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'select pg_database_size(current_database())'], { encoding: 'utf8' })
  const n = Number(r.stdout?.trim())
  if (r.status !== 0 || !Number.isFinite(n)) { console.error(`ตรวจไม่ได้: ฐานข้อมูลในเครื่องยังไม่ทำงาน (container ${c}) — รัน npx supabase start ก่อน`); process.exit(1) }
  return n
}

const mb = dbBytes() / 1024 / 1024
const ratio = mb / limitMb
const pct = (ratio * 100).toFixed(1).replace(/\.0$/, '')
console.log(`ฐานข้อมูล: ${mb.toFixed(1).replace(/\.0$/, '')} MB จาก ${limitMb} MB (${pct}%)`)
if (ratio >= 1) { console.log('เต็มแล้ว: เกินลิมิตแผนฟรี ลบข้อมูลเก่าหรืออัปเกรดแผนก่อนที่ระบบจะหยุดเขียนข้อมูล'); process.exit(1) }
if (ratio >= WARN_AT) { console.log('ใกล้เต็ม: ใช้เกิน 80% ของลิมิตแผนฟรี วางแผนล้างข้อมูลเก่าหรืออัปเกรดแผน'); process.exit(1) }
console.log('ปกติ')
