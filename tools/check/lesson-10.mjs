import { exists, read, run, walk } from './lib.mjs'
import { rows, scalar, sql, dbUp, container } from './db.mjs'
import { readdirSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)
const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const migFiles = () => (exists('supabase/migrations') ? readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')) : [])

// เวลา "พรุ่งนี้ HH:MM" (Asia/Bangkok) เป็น SQL — ตัวตรวจไม่ผูกกับนาฬิกา: พรุ่งนี้ 10:00 เป็นช่องที่เปิดและสั่งล่วงหน้าได้เสมอ
const day = (n, hhmm) => `(((now() at time zone 'Asia/Bangkok')::date + ${n} + time '${hhmm}') at time zone 'Asia/Bangkok')`
const tmr = (hhmm) => day(1, hhmm)
const item = (name, qty = 1, opts = []) => `jsonb_build_object('menu_item_id',(select id from menu_items where name='${name}'),'qty',${qty},'options',${opts.length ? `jsonb_build_array(${opts.map((o) => `'${o}'`).join(',')})` : "'[]'::jsonb"})`
const items = (...xs) => `jsonb_build_array(${xs.join(',')})`
const place = (pickup, its, phone = '0900000001', name = 'ผู้ทดสอบ') => `select place_preorder('${name}','${phone}',${pickup},${its})`
// แต่ละข้อเริ่มจากไม่มีออเดอร์ค้าง (ออเดอร์ "ลองสั่ง" ที่ทิ้งไว้ไม่ทำให้ตก) · ทั้งหมดอยู่ใน transaction ที่ rollback ข้อมูลของผู้เรียนจึงไม่เปลี่ยน
const tx = (...stmts) => sql(`begin; truncate order_items, orders cascade; update pickup_slots set cups_used = 0; ${stmts.join('; ')}; rollback`)
const tweak = (key, v) => `update settings set value='${v}'::jsonb where key='${key}'`
const err = (r, code) => !r.ok && new RegExp(code).test(r.out)
const LATTE = items(item('ลาเต้'))

export const checks = [
  {
    part: 'win', name: 'ตารางและคอลัมน์ตาม brief (pickup_slots, orders, order_items, menu_items.cup_units) เป็น migration ใหม่',
    run: () => {
      if (migFiles().length < 2) return { ok: false, hint: 'ต้องมี migration ใหม่เพิ่มจากบท 9' }
      const n = need(); if (n) return n
      const dbv = rows('select version from supabase_migrations.schema_migrations')?.map((r) => r[0]) ?? []
      const orphan = dbv.filter((v) => !migFiles().some((f) => f.startsWith(v + '_')))
      const want = { pickup_slots: ['slot_start', 'cups_used'], orders: ['id', 'code', 'customer_name', 'phone', 'pickup_at', 'status', 'total', 'created_at'], order_items: ['id', 'order_id', 'menu_item_id', 'qty', 'options', 'unit_price', 'cups'], menu_items: ['cup_units'] }
      const miss = []
      for (const [t, cols] of Object.entries(want)) {
        const have = (rows(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}'`) ?? []).map((r) => r[0])
        const m = cols.filter((c) => !have.includes(c)); if (m.length) miss.push(`${t}: ${have.length ? 'ขาด ' + m.join(', ') : 'ไม่มีตาราง'}`)
      }
      return { ok: !miss.length && !orphan.length, hint: miss.join(' · ') || `migration ในฐานข้อมูลที่ไม่มีไฟล์: ${orphan.join(', ')}` }
    },
  },
  {
    part: 'win', name: 'cup_units: ดริปเอธิโอเปีย = 2 · เบเกอรี่ = 0 · เมนูอื่น = 1 · ค่ากฎ 6 ตัวอยู่ใน settings',
    run: () => {
      const n = need(); if (n) return n
      const cu = Object.fromEntries((rows('select name,cup_units,is_drink from menu_items where active') ?? []).map((r) => [r[0], [Number(r[1]), r[2] === 't']]))
      const bad = Object.entries(cu).filter(([name, [v, drink]]) => v !== (/ดริป/.test(name) ? 2 : !drink ? 0 : 1)).map(([k, [v]]) => `${k}=${v}`)
      const want = { cups_per_slot: '6', slot_minutes: '10', min_lead_minutes: '15', cancel_cutoff_minutes: '30', expire_after_minutes: '30', preorder_days: '1' }
      const st = Object.fromEntries((rows("select key,value::text,is_public from settings") ?? []).map((r) => [r[0], r]))
      const badSet = Object.entries(want).filter(([k, v]) => !st[k] || st[k][1] !== v || st[k][2] !== 't').map(([k]) => k)
      return { ok: Object.keys(cu).length >= 12 && !bad.length && !badSet.length, hint: `cup_units ผิด: ${bad.join(', ') || '-'} · settings ขาด/ผิด: ${badSet.join(', ') || '-'}` }
    },
  },
  {
    part: 'win', name: 'สั่งลาเต้ L + นมโอ๊ต + เพิ่ม shot = 130 บาท ได้เลขออเดอร์ · ราคาคิดที่ฐานข้อมูล · เก็บแก้วในช่อง',
    run: () => {
      const n = need(); if (n) return n
      const r = tx(`${place(tmr('10:00'), items(item('ลาเต้', 1, ['L', 'โอ๊ต', 'เพิ่ม shot เอสเปรสโซ'])))} as r`, `select 'cups', cups_used from pickup_slots where slot_start=${tmr('10:00')}`, `select 'items', count(*), sum(unit_price) from order_items`, `select 'status', status, total from orders order by created_at desc limit 1`)
      const o = r.out
      const ok = r.ok && /"code": ?"[A-Z]+-?\d+/.test(o) && /"total": ?130/.test(o) && /cups\|1/.test(o) && /items\|1\|130/.test(o) && /status\|placed\|130/.test(o)
      return { ok, hint: r.ok ? `ผลไม่ตรง: ${o.trim().split('\n').slice(-4).join(' / ')}` : `สั่งไม่ผ่าน: ${o.trim().split('\n').slice(-2).join(' ')}` }
    },
  },
  {
    part: 'break', name: 'นับแก้ว: ดริป = 2 แก้ว · เบเกอรี่ไม่นับ · เต็ม 6 แก้วรับได้ แก้วที่ 7 → slot_full',
    run: () => {
      const n = need(); if (n) return n
      const t = tmr('10:10')
      const six = tx(place(t, items(item('ดริปกาแฟ เอธิโอเปีย'), item('ลาเต้', 4), item('ครัวซองต์เนย', 10)), '0900000002'), `select 'cups', cups_used from pickup_slots where slot_start=${t}`)
      const seven = tx(place(t, items(item('ดริปกาแฟ เอธิโอเปีย'), item('ลาเต้', 4)), '0900000003'), place(t, LATTE, '0900000004'))
      const two = tx(place(t, items(item('ลาเต้', 5)), '0900000005'), place(t, items(item('ดริปกาแฟ เอธิโอเปีย')), '0900000006'))
      return { ok: six.ok && /cups\|6/.test(six.out) && err(seven, 'slot_full') && err(two, 'slot_full'),
        hint: `6 แก้ว (ดริป+ลาเต้ 4+เบเกอรี่ 10) ต้องรับได้และ cups=6: ${six.ok ? six.out.trim().split('\n').pop() : six.out.trim().split('\n').pop()} · แก้วที่ 7 ต้อง slot_full: ${err(seven, 'slot_full')} · ลาเต้ 5 + ดริป 1 ต้อง slot_full: ${err(two, 'slot_full')}` }
    },
  },
  {
    part: 'break', name: 'กฎเวลา: เวลาไม่ตรงช่อง · นอกเวลาเปิด · เกินพรุ่งนี้ · สั่งช้ากว่า 15 นาที (ค่าอยู่ใน settings) · ออเดอร์ว่าง · ตัวเลือกผิด',
    run: () => {
      const n = need(); if (n) return n
      const cases = {
        bad_slot: tx(place(tmr('10:05'), LATTE)),
        outside_hours: tx(place(tmr('03:00'), LATTE), ),
        outside_closing: tx(place(tmr('17:00'), LATTE)),
        too_far: tx(place(day(2, '10:00'), LATTE)),
        too_late: tx(tweak('min_lead_minutes', '100000'), place(tmr('10:00'), LATTE)),
        empty_order: tx(place(tmr('10:00'), "'[]'::jsonb")),
        bad_option: tx(place(tmr('10:00'), items(item('ครัวซองต์เนย', 1, ['L'])))),
      }
      const bad = Object.entries(cases).filter(([k, r]) => !err(r, k === 'outside_closing' ? 'outside_hours' : k)).map(([k]) => k)
      const okSlot = tx(place(tmr('16:50'), LATTE, '0900000007')) // ช่องสุดท้ายต้องสั่งได้
      return { ok: !bad.length && okSlot.ok, hint: `ไม่ได้ error ที่ถูกต้อง: ${bad.join(', ') || '-'} · ช่อง 16:50 สั่งได้: ${okSlot.ok}` }
    },
  },
  {
    part: 'extra', name: 'ยกเลิก: ได้ก่อน 30 นาที คืนแก้ว · เบอร์ไม่ตรง → not_found · เลยเวลา → too_late_to_cancel (ค่าอยู่ใน settings)',
    run: () => {
      const n = need(); if (n) return n
      const t = tmr('11:00')
      const code = `(select code from orders where phone='0900000008')`
      const mk = `${place(t, items(item('ลาเต้', 2)), '0900000008')}`
      const ok = tx(mk, `select 'cups_before', cups_used from pickup_slots where slot_start=${t}`, `select cancel_preorder(${code},'0900000008')`, `select 'cups_after', cups_used from pickup_slots where slot_start=${t}`, `select 'status', status from orders where phone='0900000008'`)
      const wrong = tx(mk, `select cancel_preorder(${code},'0999999999')`)
      const late = tx(mk, tweak('cancel_cutoff_minutes', '100000'), `select cancel_preorder(${code},'0900000008')`)
      return { ok: ok.ok && /cups_before\|2/.test(ok.out) && /cups_after\|0/.test(ok.out) && /status\|cancelled/.test(ok.out) && err(wrong, 'not_found') && err(late, 'too_late_to_cancel'),
        hint: `ยกเลิกปกติผ่าน=${ok.ok && /cups_after\|0/.test(ok.out)} (${ok.out.trim().split('\n').slice(-2).join(' ')}) · เบอร์ผิด not_found=${err(wrong, 'not_found')} · เลยเวลา too_late_to_cancel=${err(late, 'too_late_to_cancel')}` }
    },
  },
  {
    part: 'win', name: 'ลูกค้า (anon) เขียนตารางตรง ๆ ไม่ได้ (เขียนผ่านฟังก์ชันเท่านั้น)',
    run: () => {
      const n = need(); if (n) return n
      const w = ["insert into orders(code,customer_name,phone,pickup_at,total) values ('X','x','x',now(),0)", "insert into pickup_slots(slot_start,cups_used) values (now(),0)", "update pickup_slots set cups_used=0 returning 1"]
      const wrote = w.filter((q) => { const r = sql(`begin; set local role anon; ${q}; rollback`); return r.ok && (!/returning/.test(q) || r.out.trim()) })
      return { ok: wrote.length === 0, hint: `anon เขียนได้: ${wrote.join(' ; ') || '-'}` }
    },
  },
  {
    part: 'extra', name: 'available_slots คืนช่องของพรุ่งนี้ครบ 57 ช่อง (07:30–16:50) และกดสั่งได้ทุกช่อง',
    run: () => {
      const n = need(); if (n) return n
      const s = sql(`select count(*), count(*) filter (where bookable) from available_slots((now() at time zone 'Asia/Bangkok')::date + 1)`)
      return { ok: /^57\|57$/m.test(s.out.trim()), hint: `available_slots(พรุ่งนี้): ${s.out.trim().split('\n').pop()} (ต้อง 57|57)` }
    },
  },
  {
    part: 'break', name: 'มี test SQL ครอบกฎของร้านใน supabase/tests/ และ npm run test:db ผ่าน',
    run: () => {
      const files = exists('supabase/tests') ? readdirSync('supabase/tests').filter((f) => f.endsWith('.sql')) : []
      const mentions = files.filter((f) => /place_preorder/.test(read('supabase/tests/' + f)))
      if (!mentions.length) return { ok: false, hint: 'ยังไม่มี test SQL ที่เรียก place_preorder' }
      const n = need(); if (n) return n
      const r = run('npm', ['run', 'test:db', '--silent'])
      return { ok: r.ok, hint: r.out.trim().split('\n').slice(-4).join(' | ') }
    },
  },
  // ---- ลองพัง: สั่งพร้อมกัน ----
  {
    part: 'break', name: 'สั่งพร้อมกัน 8 คนเข้าช่องที่เหลือแก้วเดียว → สำเร็จคนเดียว และแก้วในช่องไม่เกิน 6',
    run: async () => {
      const n = need(); if (n) return n
      const C = container()
      const psql = (q) => pexec('docker', ['exec', '-i', C, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-c', q], { timeout: 60000 }).then((r) => ({ ok: true, out: r.stdout }), (e) => ({ ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }))
      const t = tmr('16:40'), phone = '0900000099'
      const clean = () => sql(`delete from orders where phone='${phone}'; delete from pickup_slots where slot_start=${t}`)
      clean()
      try {
        const fill = await psql(place(t, items(item('ลาเต้', 5)), phone))
        if (!/"code"/.test(fill.out)) return { ok: false, hint: `เตรียมช่องไม่ได้: ${fill.out.trim().slice(0, 120)}` }
        // ตัวกั้น: ถือ advisory lock ไว้ 2.5 วินาที ให้ 8 คนมารอแล้วปล่อยพร้อมกัน
        const keeper = spawn('docker', ['exec', '-i', C, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-c', 'select pg_advisory_lock(424242); select pg_sleep(2.5); select pg_advisory_unlock(424242)'], { stdio: 'ignore' })
        await new Promise((r) => setTimeout(r, 700))
        const rs = await Promise.all(Array.from({ length: 8 }, () => psql(`select pg_advisory_lock(424242); select pg_advisory_unlock(424242); ${place(t, LATTE, phone)}`)))
        keeper.kill()
        const okN = rs.filter((r) => /"code"/.test(r.out)).length
        const full = rs.filter((r) => /slot_full/.test(r.out)).length
        const used = Number(scalar(`select cups_used from pickup_slots where slot_start=${t}`))
        const placed = Number(scalar(`select count(*) from orders where phone='${phone}' and status='placed'`) ?? 99)
        return { ok: okN === 1 && full === 7 && used === 6 && placed === 2, hint: `สำเร็จ ${okN} คน (ต้อง 1) · slot_full ${full} (ต้อง 7) · cups_used=${used} (ต้อง 6) · ออเดอร์ที่ถูกสร้าง ${placed} (ต้อง 2 = ที่เตรียมช่อง + ผู้ชนะ)` }
      } finally { clean() }
    },
  },
  {
    part: 'break', name: 'มี test ที่พิสูจน์การสั่งพร้อมกัน (ไฟล์ใน supabase/tests/ หรือ tools/ ที่พูดถึง concurrent/พร้อมกัน/race)',
    run: () => {
      const files = [...(exists('supabase/tests') ? walk('supabase/tests') : []), ...walk('tools', ['node_modules', 'check'])].filter((p) => /\.(sql|ts|mjs|sh)$/.test(p))
      const hit = files.filter((p) => /concurren|พร้อมกัน|race|advisory|pg_sleep|dblink/i.test(read(p)) && /place_preorder|slot/.test(read(p)))
      return { ok: hit.length > 0, hint: 'ยังไม่มีไฟล์ test ที่ทดสอบการสั่งพร้อมกัน' }
    },
  },
  // ---- ต่อยอด: หน้าเว็บ ----
  {
    part: 'extra', name: 'หน้าเว็บสั่งล่วงหน้า (#/preorder) เรียก place_preorder + available_slots ผ่าน supabase-js และ web build ผ่าน',
    run: () => {
      const src = walk('web/src').filter((p) => /\.(tsx?|css)$/.test(p)).map(read).join('\n')
      let pkg = {}; try { pkg = JSON.parse(read('web/package.json')) } catch {}
      const miss = []
      if (!/place_preorder/.test(src)) miss.push('place_preorder')
      if (!/available_slots/.test(src)) miss.push('available_slots')
      if (!/preorder/.test(src)) miss.push('หน้า #/preorder')
      if (!pkg.dependencies?.['@supabase/supabase-js']) miss.push('@supabase/supabase-js ใน web/package.json')
      if (miss.length) return { ok: false, hint: `หน้าเว็บยังขาด: ${miss.join(', ')}` }
      const b = run('npm', ['run', 'build', '--silent'], { cwd: process.cwd() + '/web' })
      return { ok: b.ok, hint: `web build ไม่ผ่าน: ${b.out.trim().split('\n').slice(-3).join(' | ')}` }
    },
  },
]
