// ตัวตรวจบท 19: subagent `reviewer` (สิทธิ์จำกัด, context สะอาด) จับ RLS รั่วใน exercise/rls-leak/ · แก้ใน session หลัก · test ฐานข้อมูล
import { exists, read, run, walk } from './lib.mjs'
import { rows, scalar, sql, dbUp } from './db.mjs'
import { api, env, rpc, newUser, delUser } from './api.mjs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const AGENT = '.claude/agents/reviewer.md'
const R1 = 'docs/review-staff-notes.md', R2 = 'docs/review-staff-notes-2.md'

export function frontmatter(t) {
  const m = t.match(/^---\n([\s\S]*?)\n---/); if (!m) return null
  const o = {}; for (const l of m[1].split('\n')) { const k = l.match(/^([A-Za-z_-]+):\s*(.*)$/); if (k) o[k[1]] = k[2].trim() }
  return o
}
const toolList = (v) => (v ?? '').replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)

const migFiles = () => walk('supabase/migrations').filter((f) => /staff_notes/i.test(read(f)) && /create table[^;]*staff_notes/i.test(read(f)))
const CANARY = 'CANARY-19-ห้ามรั่ว'

async function forged() { // ผู้ใช้ที่ตั้ง user_metadata.role='staff' ให้ตัวเอง (ทำได้จริงตอนสมัคร) — ต้องไม่ได้สิทธิ์พนักงาน
  const e = env(), email = `check-forged-${Date.now()}@example.invalid`, password = 'Check-pass-123'
  const c = await api('/auth/v1/admin/users', { key: e.SUPABASE_SECRET_KEY, body: { email, password, email_confirm: true, user_metadata: { role: 'staff' } } })
  const s = await api('/auth/v1/token?grant_type=password', { body: { email, password } })
  return { id: c.body.id, token: s.body.access_token }
}
async function withUsers(fn) {
  const staff = await newUser('staff19', { appMetadata: { role: 'staff' } }), cust = await newUser('cust19'), fake = await forged()
  sql("delete from staff_notes where customer_phone='0900000019'")
  sql(`insert into staff_notes(customer_phone,note) values ('0900000019','${CANARY}')`)
  try { return await fn({ staff, cust, fake }) } finally { sql("delete from staff_notes where customer_phone like '09000000%'"); await delUser(staff.id); await delUser(cust.id); await delUser(fake.id) }
}
const read_ = async (token) => { const r = await api('/rest/v1/staff_notes?select=note', { token }); return { status: r.status, n: Array.isArray(r.body) ? r.body.length : 0, leaked: r.text.includes(CANARY) } }
const ins = async (token) => { const r = await api('/rest/v1/staff_notes', { token, body: { customer_phone: '0900000019', note: 'จดโดยตัวตรวจ' } }); return r.status }


export const checks = [
  {
    part: 'win', name: 'subagent reviewer ตั้งไว้ถูก: .claude/agents/reviewer.md มี name: reviewer, description ที่บอกว่าใช้เมื่อไหร่ และ tools เฉพาะ Read/Grep/Glob (ไม่มี Edit, Write, Bash)',
    run: () => {
      if (!exists(AGENT)) return { ok: false, hint: 'ยังไม่มี .claude/agents/reviewer.md' }
      const t = read(AGENT), f = frontmatter(t); if (!f) return { ok: false, hint: 'ไฟล์ต้องขึ้นต้นด้วย frontmatter --- ... ---' }
      const tools = toolList(f.tools), allowed = ['Read', 'Grep', 'Glob']
      const body = t.replace(/^---\n[\s\S]*?\n---/, '').trim()
      return { ok: f.name === 'reviewer' && (f.description ?? '').length >= 20 && tools.length > 0 && tools.every((x) => allowed.includes(x)) && body.length >= 80 && /ไม่แก้|ห้ามแก้|อ่านอย่างเดียว/.test(body),
        hint: `name=${f.name} · description ${(f.description ?? '').length} ตัวอักษร · tools=[${tools.join(',')}] (ต้องมีและเฉพาะ ${allowed.join('/')}) · เนื้อหา ${body.length} ตัวอักษร · มีกฎ "ไม่แก้ไฟล์"=${/ไม่แก้|ห้ามแก้|อ่านอย่างเดียว/.test(body)}` }
    },
  },
  {
    part: 'win', name: `เรียก reviewer ตรวจ exercise/rls-leak/: ${R1} ขึ้นต้น "ตรวจโดย: reviewer" และชี้ว่า staff_notes อ่านได้โดย anon เพราะ policy using (true) ระดับสูง`,
    run: () => {
      if (!exists(R1)) return { ok: false, hint: `ยังไม่มี ${R1}` }
      const t = read(R1)
      const first = /^\s*(?:#+\s*)?ตรวจโดย:\s*reviewer/i.test(t.split('\n').find((l) => l.trim()) ?? '')
      const table = /staff_notes/.test(t), who = /anon|ทุกคน|ไม่ได้ล็อกอิน|public/i.test(t), pol = /using\s*\(\s*true\s*\)|อ่านโน้ต/i.test(t), sev = /สูง|critical|high/i.test(t)
      return { ok: first && table && who && pol && sev, hint: `บรรทัดแรก "ตรวจโดย: reviewer"=${first} · ชี้ตาราง=${table} · ชี้ว่าใครอ่านได้=${who} · ชี้ policy=${pol} · ระดับสูง=${sev}` }
    },
  },
  {
    part: 'break', name: 'รายงานฉบับแรกจับครบทั้งสามจุด: (1) select using (true) (2) policy จดโน้ตเชื่อ user_metadata ที่ลูกค้าตั้งเองได้ (3) search_notes เป็น security definer ที่ข้าม RLS / ไม่ได้ตั้ง search_path',
    run: () => {
      const t = read(R1); if (!t) return { ok: false, hint: `ยังไม่มี ${R1}` }
      const a = /using\s*\(\s*true\s*\)|อ่านโน้ต/i.test(t), b = /user_metadata/.test(t), c = /search_notes/.test(t) && /security definer/i.test(t) && /(ข้าม|bypass|ไม่ผ่าน).{0,40}RLS|RLS.{0,40}(ข้าม|bypass)|search_path|ทุกคนเรียก|execute/i.test(t)
      return { ok: a && b && c, hint: `(1)=${a} (2) user_metadata=${b} (3) search_notes definer=${c}` }
    },
  },
  {
    part: 'break', name: 'แก้ใน session หลัก: มี migration ใหม่ staff_notes ใน supabase/migrations/ (ไม่แก้ไฟล์เก่า) · ตารางมีคอลัมน์ครบ · RLS เปิด · ไม่มี policy ที่ using (true) หรือ grant ให้ anon',
    run: () => {
      const n = need(); if (n) return n
      const f = migFiles(); if (!f.length) return { ok: false, hint: 'ยังไม่มี migration ที่สร้างตาราง staff_notes ใน supabase/migrations/' }
      const cols = (rows("select column_name from information_schema.columns where table_schema='public' and table_name='staff_notes'") ?? []).map((r) => r[0])
      const miss = ['id', 'customer_phone', 'note', 'author', 'created_at'].filter((c) => !cols.includes(c))
      const rls = scalar("select relrowsecurity from pg_class where relname='staff_notes'")
      const openPol = Number(scalar("select count(*) from pg_policies where tablename='staff_notes' and (qual='true' or with_check='true')") ?? 0)
      const anonGrant = Number(scalar("select count(*) from information_schema.role_table_grants where table_name='staff_notes' and grantee in ('anon','PUBLIC')") ?? 0)
      return { ok: !miss.length && rls === 't' && openPol === 0 && anonGrant === 0, hint: `migration: ${f.join(',')} · ขาดคอลัมน์ ${miss.join(',') || 'ไม่ขาด'} · RLS=${rls} · policy ที่เปิดโล่ง=${openPol} · grant ให้ anon/PUBLIC=${anonGrant}` }
    },
  },
  {
    part: 'break', name: 'พิสูจน์ด้วยผู้ใช้จริง: anon ไม่เห็นโน้ต · ลูกค้าทั่วไป และลูกค้าที่ตั้ง user_metadata.role=staff เอง อ่าน/จดไม่ได้ · พนักงานจริง (app_metadata) อ่านและจดได้',
    run: async () => {
      const n = need(); if (n) return n
      if (!migFiles().length) return { ok: false, hint: 'ยังไม่มีตาราง staff_notes' }
      return withUsers(async ({ staff, cust, fake }) => {
        const anon = await read_(undefined), c = await read_(cust.token), f = await read_(fake.token), s = await read_(staff.token)
        const ci = await ins(cust.token), fi = await ins(fake.token), ai = await ins(undefined), si = await ins(staff.token)
        const denied = (st) => st === 401 || st === 403 || st === 42501
        const ok = !anon.leaked && !c.leaked && !f.leaked && s.leaked && denied(ci) && denied(fi) && denied(ai) && si === 201
        return { ok, hint: `anon อ่านเห็น=${anon.leaked} (${anon.status}) · ลูกค้าเห็น=${c.leaked} · ลูกค้าปลอมเป็นพนักงานเห็น=${f.leaked} · พนักงานเห็น=${s.leaked} · จด: ลูกค้า ${ci} ปลอม ${fi} anon ${ai} พนักงาน ${si} (ต้อง 401/403 และ 201)` }
      })
    },
  },
  {
    part: 'break', name: 'search_notes: ถ้ายังมี ต้องเรียกโดย anon/ลูกค้าแล้วไม่ได้โน้ต และไม่ใช่ security definer ที่ไม่ตั้ง search_path (ลบทิ้งก็ผ่าน) · พนักงานยังค้นได้ถ้ายังมี',
    run: async () => {
      const n = need(); if (n) return n
      const exists_ = scalar("select count(*) from pg_proc where proname='search_notes'") === '1'
      if (!exists_) return { ok: true, hint: 'ลบ search_notes แล้ว' }
      const def = rows("select prosecdef, coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='search_notes'")?.[0]
      const unsafeDefiner = def?.[0] === 't' && !/search_path/.test(def?.[1] ?? '')
      return withUsers(async ({ staff, cust, fake }) => {
        const call = async (tok) => { const r = await rpc('search_notes', { p_phone: '0900000019' }, tok); return { st: r.status, leaked: r.text.includes(CANARY) } }
        const a = await call(undefined), c = await call(cust.token), f = await call(fake.token), s = await call(staff.token)
        return { ok: !unsafeDefiner && !a.leaked && !c.leaked && !f.leaked, hint: `definer ไม่ตั้ง search_path=${unsafeDefiner} · anon เห็น=${a.leaked} ลูกค้าเห็น=${c.leaked} ปลอมเห็น=${f.leaked} · พนักงานเห็น=${s.leaked}` }
      })
    },
  },
  {
    part: 'break', name: 'test SQL ของ staff_notes มี (supabase/tests/*staff_notes*.sql) และ npm run test:db ผ่านทั้งหมด',
    run: () => {
      const n = need(); if (n) return n
      const t = walk('supabase/tests').filter((f) => /staff_notes/i.test(f))
      if (!t.length) return { ok: false, hint: 'ยังไม่มีไฟล์ supabase/tests/13_staff_notes.sql' }
      const r = run('bash', ['tools/dbtest.sh'])
      return { ok: r.ok, hint: r.ok ? '' : r.out.slice(-500) }
    },
  },
  {
    part: 'extra', name: `ตรวจซ้ำด้วย reviewer ตัวใหม่: ${R2} ขึ้นต้น "ตรวจโดย: reviewer" บอกว่าไม่พบปัญหาระดับสูงเหลือ และอ้างถึง migration ที่แก้แล้ว (ไม่ใช่ exercise/)`,
    run: () => {
      if (!exists(R2)) return { ok: false, hint: `ยังไม่มี ${R2}` }
      const t = read(R2)
      const first = /^\s*(?:#+\s*)?ตรวจโดย:\s*reviewer/i.test(t.split('\n').find((l) => l.trim()) ?? '')
      const clean = /ไม่พบ(ปัญหา)?.{0,20}(ระดับ)?สูง|ไม่มี.{0,12}(ปัญหา|ช่องโหว่).{0,12}สูง|no (high|critical)/i.test(t)
      const ref = /supabase\/migrations\//.test(t) && /staff_notes/.test(t)
      return { ok: first && clean && ref, hint: `บรรทัดแรก=${first} · ไม่พบระดับสูง=${clean} · อ้าง supabase/migrations=${ref}` }
    },
  },
]
