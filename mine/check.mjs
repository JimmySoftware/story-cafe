// ตัวตรวจสูตร mine/recipe.md (รายงานสิ้นเดือน monthly_sales) — ตรวจกับ Supabase ในเครื่อง
// ใช้: node mine/check.mjs → พิมพ์ ✓/✗ เป็นภาษาไทย · ผ่านทั้งหมด exit 0 ไม่งั้น exit 1 · ข้อมูลทดลอง rollback ทุกครั้ง
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const project = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"(.*)"/m)?.[1]
const container = process.env.DB_CONTAINER ?? `supabase_db_${project}`

// รัน SQL ใน transaction ที่ rollback เสมอ · คืน { ok, out }
function sql(body) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq'], {
    input: `begin;\n${body}\nrollback;`, encoding: 'utf8',
  })
  return { ok: r.status === 0, out: (r.stdout ?? '').trim().split('\n').pop(), err: (r.stderr ?? '').trim() }
}
const staff = `select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","app_metadata":{"role":"staff"}}', true);`
const fakeStaff = `select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9","role":"authenticated","user_metadata":{"role":"staff"}}', true);`

const up = sql('select 1')
if (!up.ok) {
  console.log('✗ ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset ก่อน')
  process.exit(1)
}

const checks = [
  ['มีฟังก์ชัน monthly_sales(date) และตั้ง search_path', () => {
    const r = sql(`select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'monthly_sales' and pg_get_function_identity_arguments(oid) = 'p_month date' and array_to_string(proconfig, ',') like '%search_path%';`)
    return r.out === '1' ? null : 'ยังไม่มี public.monthly_sales(p_month date) ที่ตั้ง search_path (ทำใน migration ใหม่)'
  }],
  ['anon เรียกไม่ได้ และลูกค้าที่ตั้ง user_metadata.role = staff เองถูกปฏิเสธ', () => {
    const anon = sql(`set local role anon; select public.monthly_sales('2031-05-10');`)
    if (anon.ok) return 'anon เรียก monthly_sales ได้'
    const cust = sql(`insert into auth.users (id, aud, role, email) values ('00000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated', 'mine-check@test.local');
      set local role authenticated; ${fakeStaff} select public.monthly_sales('2031-05-10');`)
    return !cust.ok && /forbidden:/.test(cust.err) ? null : `ลูกค้าที่ตั้ง role เองต้องได้ forbidden (ได้: ${cust.err.slice(0, 120) || 'เรียกผ่าน'})`
  }],
  ['พนักงานเรียกแล้วยอดเดือนถูก: ขอบวัน/เดือนตามเวลาไทย · ไม่นับเดือนอื่น · เท่าผลรวมรายวัน', () => {
    const r = sql(`insert into auth.users (id, aud, role, email) values ('00000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated', 'mine-check@test.local');
      insert into public.pos_bills (client_order_id, subtotal, discount, total, points_earned, points_redeemed, at) values
        (gen_random_uuid(), 100, 0, 100, 0, 0, '2031-05-01 00:00:00+07'), (gen_random_uuid(), 50, 0, 50, 0, 0, '2031-05-31 23:59:59+07'),
        (gen_random_uuid(), 7, 0, 7, 0, 0, '2031-06-01 00:00:00+07'), (gen_random_uuid(), 9, 0, 9, 0, 0, '2031-04-30 23:59:59+07');
      set local role authenticated; ${staff}
      select concat_ws(',', m ->> 'revenue', m ->> 'bills', m ->> 'days', jsonb_array_length(m -> 'by_day'),
        (select sum((e ->> 'revenue')::int) from jsonb_array_elements(m -> 'by_day') e), m -> 'by_day' -> 0 ->> 'revenue', m -> 'by_day' -> 30 ->> 'revenue')
      from (select public.monthly_sales('2031-05-17') m) x;`)
    if (!r.ok) return `เรียกในฐานะพนักงานไม่ได้: ${r.err.slice(0, 160)}`
    return r.out === '150,2,31,31,150,100,50' ? null : `ได้ "${r.out}" แต่ต้องเป็น "150,2,31,31,150,100,50" (ยอด,บิล,วัน,แถวรายวัน,ผลรวมรายวัน,วันที่ 1,วันที่ 31)`
  }],
  ['กุมภาพันธ์ปีอธิกสุรทิน 29 วัน และ p_month = null คือเดือนนี้ (เวลาไทย)', () => {
    const r = sql(`insert into auth.users (id, aud, role, email) values ('00000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated', 'mine-check@test.local');
      set local role authenticated; ${staff}
      select concat_ws(',', public.monthly_sales('2032-02-10') ->> 'days', public.monthly_sales(null) ->> 'month' = to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM'));`)
    return r.ok && r.out === '29,t' ? null : `ได้ "${r.out}" ${r.err.slice(0, 120)} แต่ต้องเป็น "29,t"`
  }],
  ['ข้อมูลทดลองไม่ทิ้งอะไรไว้ในฐาน', () => {
    const r = sql(`select count(*) from public.pos_bills where at >= '2031-04-01' and at < '2031-07-01';`)
    return r.out === '0' ? null : `เหลือบิลทดลอง ${r.out} แถวในฐาน`
  }],
]

let bad = 0
for (const [name, run] of checks) {
  const why = run()
  if (why) { bad++; console.log(`✗ ${name}\n    → ${why}`) } else console.log(`✓ ${name}`)
}
console.log(bad ? `ตก ${bad} จาก ${checks.length} ข้อ` : 'ผ่านทั้งหมด')
process.exit(bad ? 1 : 0)
