import { exists, read, run, walk } from './lib.mjs'
import { rows, scalar, sql, asRole, dbUp, localEnv } from './db.mjs'
import { readdirSync } from 'node:fs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const ship = () => (exists('.claude/commands/ship.md') ? read('.claude/commands/ship.md') : exists('.claude/skills/ship/SKILL.md') ? read('.claude/skills/ship/SKILL.md') : '')
const migFiles = () => (exists('supabase/migrations') ? readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')) : [])

export const checks = [
  {
    part: 'win', name: '/ship: มี .claude/commands/ship.md พร้อม description ภาษาไทย และครบ 5 ขั้น (สำรวจ · แผน · ลงมือ · พิสูจน์ · commit)',
    run: () => {
      const t = ship(); if (!t) return { ok: false, hint: 'ยังไม่มี .claude/commands/ship.md' }
      const miss = []
      if (!/^---[\s\S]*?description:\s*\S[\s\S]*?---/.test(t) || !/description:.*[ก-๙]/.test(t)) miss.push('frontmatter description ภาษาไทย')
      if (!/git status/.test(t) || !/git diff/.test(t)) miss.push('ขั้นสำรวจ (git status/diff)')
      if (!/แผน/.test(t)) miss.push('ขั้นแผน')
      if (!/npm test/.test(t) || !/test:db/.test(t) || !/npm run build/.test(t)) miss.push('ขั้นพิสูจน์ (npm test · test:db · build)')
      if (!/rls-probe/.test(t)) miss.push('tools/rls-probe.mjs')
      if (!/commit/i.test(t) || !/ภาษาไทย/.test(t)) miss.push('commit ภาษาไทย')
      if (!/(ห้าม|ไม่)\s*push|push.{0,20}(ห้าม|ไม่)/.test(t)) miss.push('ห้าม push')
      if (!/(ไม่ได้ตรวจ|ตรวจไม่ได้)/.test(t)) miss.push('บอกสิ่งที่ตรวจไม่ได้')
      return { ok: miss.length === 0, hint: `ship.md ยังขาด: ${miss.join(', ')}` }
    },
  },
  { part: 'win', name: 'CLAUDE.md บอกว่ามีคำสั่ง /ship', run: () => ({ ok: /\/ship/.test(read('CLAUDE.md')), hint: 'เพิ่มบรรทัด /ship ใน CLAUDE.md' }) },
  {
    part: 'win', name: 'tools/rls-probe.mjs ยังอยู่และไม่ถูกแก้ให้ผ่านง่ายขึ้น (ยังตรวจ orders / order_items / pickup_slots / lookup_order)',
    run: () => { const t = read('tools/rls-probe.mjs'); return { ok: ['orders', 'order_items', 'pickup_slots', 'lookup_order', 'not_found'].every((k) => t.includes(k)), hint: 'ตัวช่วยตรวจถูกแก้ — ใช้ไฟล์เดิมของบท' } },
  },
  // ---- ลองทดสอบหนัก ๆ: RLS ----
  {
    part: 'break', name: 'ลูกค้า (anon) อ่าน orders / order_items / pickup_slots ตรง ๆ ไม่ได้ · เขียนไม่ได้ · ตารางอื่นเหมือนบท 9',
    run: () => {
      const n = need(); if (n) return n
      const cnt = (t) => { const r = asRole('anon', `select count(*) from ${t}`); return r.ok ? Number(r.out.trim().split('\n').pop()) : 0 }
      const seed = sql("select place_preorder('ตรวจ','0900000556',((now() at time zone 'Asia/Bangkok')::date + 1 + time '16:20') at time zone 'Asia/Bangkok', jsonb_build_array(jsonb_build_object('menu_item_id',(select id from menu_items where name='ลาเต้'),'qty',1,'options','[]'::jsonb)))")
      try {
        const bad = ['orders', 'order_items', 'pickup_slots'].filter((t) => cnt(t) > 0)
        const grants = (rows("select table_name from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public' and table_name in ('orders','order_items','pickup_slots') and privilege_type='SELECT'") ?? []).map((r) => r[0])
        const w = ["update orders set status='cancelled' returning 1", "delete from orders returning 1"].filter((q) => { const r = asRole('anon', q); return r.ok && r.out.trim() })
        const open = cnt('menu_items') >= 12 && cnt('options') === 12 && cnt('settings') >= 10 && cnt('ingredients') === 0
        return { ok: seed.ok && bad.length === 0 && grants.length === 0 && w.length === 0 && open,
          hint: `anon ยังอ่านได้: ${bad.join(', ') || '-'} · สิทธิ์ SELECT ที่ยังเหลือ: ${[...new Set(grants)].join(', ') || '-'} · เขียนได้: ${w.length} · เมนู/ตัวเลือก/settings ยังเปิด และ ingredients ปิด: ${open}${seed.ok ? '' : ' · สั่งทดสอบไม่ได้ (place_preorder ใช้ไม่ได้)'}` }
      } finally { sql("delete from orders where phone='0900000556'") }
    },
  },
  {
    part: 'break', name: 'lookup_order: รหัส+เบอร์ตรง → เห็นออเดอร์ตัวเอง · เบอร์ผิดหรือรหัสผิด → not_found เหมือนกันทุกตัวอักษร',
    run: () => {
      const n = need(); if (n) return n
      const t = "((now() at time zone 'Asia/Bangkok')::date + 1 + time '16:10') at time zone 'Asia/Bangkok'"
      const mk = `select set_config('app.c', (select place_preorder('ตรวจ','0900000557',${t}, jsonb_build_array(jsonb_build_object('menu_item_id',(select id from menu_items where name='ลาเต้'),'qty',2,'options','[]'::jsonb)))::jsonb->>'code'), true)`
      const code = "current_setting('app.c')"
      const as = (q) => sql(`begin; ${mk}; set local role anon; ${q}; rollback`)
      const good = as(`select lookup_order(${code},'0900000557')`)
      const wrongPhone = as(`select lookup_order(${code},'0999999999')`)
      const noCode = as("select lookup_order('SC-0000000','0900000557')")
      const msg = (r) => r.out.trim().split('\n').find((l) => /not_found/.test(l)) ?? ''
      return { ok: good.ok && /"code"/.test(good.out) && /"items"/.test(good.out) && /ลาเต้/.test(good.out) && !wrongPhone.ok && /not_found/.test(wrongPhone.out) && msg(wrongPhone).replace(/^.*?ERROR/, '') === msg(noCode).replace(/^.*?ERROR/, '') && !noCode.ok,
        hint: `ตรงกัน→เห็น=${good.ok} · เบอร์ผิด→not_found=${!wrongPhone.ok} · รหัสผิด→ข้อความเหมือนกัน=${msg(wrongPhone) === msg(noCode)}` }
    },
  },
  {
    part: 'break', name: 'node tools/rls-probe.mjs ผ่าน (ยิง API จริงในฐานะลูกค้า A และ B)',
    run: () => {
      const n = need(); if (n) return n
      const r = run('node', ['tools/rls-probe.mjs'], { env: { ...process.env, ...localEnv() } })
      return { ok: r.ok, hint: r.out.trim().split('\n').filter((l) => l.startsWith('✗')).join(' | ') || r.out.trim().split('\n').slice(-2).join(' | ') }
    },
  },
  {
    part: 'break', name: 'หน้าเว็บไม่อ่านตาราง orders / order_items ตรง ๆ แล้ว (ใช้ lookup_order) · มี test SQL ของ RLS · test:db กับ web build ผ่าน',
    run: () => {
      const src = walk('web/src').filter((p) => /\.(tsx?|js)$/.test(p)).map(read).join('\n')
      const direct = /from\(\s*['"`](orders|order_items)['"`]\s*\)|\/rest\/v1\/(orders|order_items)/.test(src)
      const files = exists('supabase/tests') ? readdirSync('supabase/tests').filter((f) => f.endsWith('.sql')) : []
      const rlsTest = files.some((f) => /set\s+(local\s+)?role\s+anon/i.test(read('supabase/tests/' + f)) && /lookup_order|orders/.test(read('supabase/tests/' + f)))
      const n = need(); if (n) return n
      const t = run('npm', ['run', 'test:db', '--silent'])
      const b = run('npm', ['run', 'build', '--silent'], { cwd: process.cwd() + '/web' })
      return { ok: !direct && rlsTest && t.ok && b.ok && migFiles().length >= 3,
        hint: `เว็บอ่านตารางตรง=${direct} · มี test RLS ในฐานะ anon=${rlsTest} · test:db=${t.ok} · build=${b.ok}` }
    },
  },
]
