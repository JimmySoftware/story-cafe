// ตัวตรวจบท 23: channel (store|line|web|delivery) ครบทุกส่วน + workflow แก้จนเขียว (tools/green-loop.mjs) + เอกสารเทียบ workflow/team
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exists, read, run, walk, root } from './lib.mjs'
import { rows, scalar, sql, dbUp } from './db.mjs'
import { rpc, newUser, delUser } from './api.mjs'
import { serve, post } from './fn.mjs'
import { startFakeLine } from '../fakes/line.mjs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const CH = ['store', 'line', 'web', 'delivery'], LABEL = { store: 'หน้าร้าน', line: 'LINE', web: 'เว็บ', delivery: 'เดลิเวอรี' }
const OWNER = 'U0123456789abcdef0123456789abcdef'
const SHIP = { name: 'ผู้ทดสอบ', phone: '0900000023', address: 'ซอยสมมติ 9 (ที่อยู่สมมติ)' }
const uuid = () => crypto.randomUUID()
const staffUser = () => newUser('ch23', { appMetadata: { role: 'staff' } })
const bill = (staff, channel, extra = {}) => rpc('pos_record_bill', { p_client_order_id: uuid(), p_lines: [{ item: 'ลาเต้', qty: 2 }], p_cash_received: 500, p_at: new Date().toISOString(), ...(channel ? { p_channel: channel } : {}), ...extra }, staff.token)
const summary = async (staff) => (await rpc('sales_summary', { p_day: scalar("select (now() at time zone 'Asia/Bangkok')::date::text") }, staff.token)).body
const tmr = (hhmm) => `((now() at time zone 'Asia/Bangkok')::date + 1 + time '${hhmm}') at time zone 'Asia/Bangkok'`
const latteId = () => scalar("select id from menu_items where name='ลาเต้'")
const preorder = async (hhmm, phone, channel) => rpc('place_preorder', { p_name: 'ทดสอบ', p_phone: phone, p_pickup: scalar(`select ${tmr(hhmm)}`), p_items: [{ menu_item_id: latteId(), qty: 1, options: [] }], ...(channel ? { p_channel: channel } : {}) })
const snap = () => rows('select sku,stock from products') ?? []
const restock = (s) => { for (const [sku, st] of s) sql(`update products set stock=${st} where sku='${sku}'`) }
const purge = () => {
  sql("delete from notify_queue where payload->>'code' in (select code from orders where phone like '09000000%') or payload->>'code' in (select code from shop_orders where ship_phone like '09000000%')")
  sql("delete from orders where phone like '09000000%'"); sql('delete from pickup_slots where slot_start not in (select pickup_at from orders)')
  sql("delete from orders where code like 'SC-97%'"); sql("delete from pos_bills where customer_phone like '09000000%'")
}
const hasFn = (fn) => ['handler.ts', 'index.ts'].every((f) => exists(`supabase/functions/${fn}/${f}`))
const mkEnv = (fake, o = {}) => ({ LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token, LINE_OWNER_USER_ID: OWNER, ...o })
const pushes = (f) => f.log.filter((l) => l.path === '/v2/bot/message/push')
const bodyText = (p) => { try { return JSON.parse(p.body).messages?.[0]?.text ?? '' } catch { return '' } }
const staticHas = (dir, re) => walk(dir).filter((f) => /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f)).some((f) => re.test(read(f)))
const buildOk = (dir) => { const r = spawnSync('npm', ['run', 'build', '--silent'], { cwd: join(root, dir), encoding: 'utf8', timeout: 170000 }); return { ok: r.status === 0, out: (r.stdout + r.stderr).slice(-250) } }

export const checks = [
  {
    part: 'win', name: 'migration: คอลัมน์ channel (store|line|web|delivery) บน pos_bills (ค่าเริ่มต้น store), orders และ shop_orders (ค่าเริ่มต้น web) · ค่านอกรายการถูกปฏิเสธที่ฐานข้อมูล',
    run: () => {
      const n = need(); if (n) return n
      const info = (t) => rows(`select column_default, is_nullable from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='channel'`)?.[0]
      const want = { pos_bills: 'store', orders: 'web', shop_orders: 'web' }, bad = []
      for (const [t, d] of Object.entries(want)) { const i = info(t); if (!i) bad.push(`${t}: ไม่มีคอลัมน์ channel`); else if (!(i[0] ?? '').includes(`'${d}'`) || i[1] !== 'NO') bad.push(`${t}: default=${i[0]} nullable=${i[1]} (ต้อง '${d}' และ not null)`) }
      if (bad.length) return { ok: false, hint: bad.join(' · ') }
      const rej = sql("begin; insert into orders(code,customer_name,phone,pickup_at,total,channel) values ('SC-97001','x','0900000023',now(),1,'tiktok'); rollback")
      return { ok: !rej.ok, hint: `ใส่ channel='tiktok' ลง orders ได้=${rej.ok} (ต้องถูกปฏิเสธ)` }
    },
  },
  {
    part: 'win', name: 'pos_record_bill / place_preorder / create_order รับ p_channel: เก็บค่าที่ส่ง · ไม่ส่ง = ค่าเริ่มต้น (store / web / web) · ค่าแปลก → bad_channel · เรียกแบบเดิมที่ไม่ส่ง p_channel ยังได้',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap(), staff = await staffUser(), u = await newUser('ch23u'); purge()
      try {
        const a = await bill(staff, 'delivery'), b = await bill(staff, undefined), c = await bill(staff, 'tiktok')
        const chOf = (r) => scalar(`select channel from pos_bills where id='${r.body?.id}'`)
        const po1 = await preorder('14:00', '0900000023', 'line'), po2 = await preorder('14:30', '0900000024')
        const poCh = (r) => scalar(`select channel from orders where code='${r.body?.code}'`)
        const o1 = await rpc('create_order', { p_items: [{ sku: 'drip-5', qty: 1 }], p_ship: SHIP }, u.token), o2 = await rpc('create_order', { p_items: [{ sku: 'drip-5', qty: 1 }], p_ship: SHIP, p_channel: 'delivery' }, u.token)
        const soCh = (r) => scalar(`select channel from shop_orders where code='${r.body?.code}'`)
        const got = { posDelivery: chOf(a), posDefault: chOf(b), posBad: c.ok ? 'ไม่ปฏิเสธ' : /bad_channel/.test(c.text) ? 'bad_channel' : c.text.slice(0, 60), preLine: poCh(po1), preDefault: poCh(po2), shopDefault: soCh(o1), shopDelivery: soCh(o2) }
        const ok = got.posDelivery === 'delivery' && got.posDefault === 'store' && got.posBad === 'bad_channel' && got.preLine === 'line' && got.preDefault === 'web' && got.shopDefault === 'web' && got.shopDelivery === 'delivery'
        return { ok, hint: JSON.stringify(got) }
      } finally { restock(s0); sql(`delete from shop_orders where user_id='${u.id}'`); purge(); await delUser(staff.id); await delUser(u.id) }
    },
  },
  {
    part: 'win', name: 'sales_summary: by_channel ครบสี่ช่อง (ศูนย์ก็มี) · บิลใหม่ในแต่ละช่องเพิ่มเฉพาะช่องนั้น (bills, revenue, cups) · ผลรวมสี่ช่อง = ยอดรวมของฟังก์ชันเดียวกัน',
    run: async () => {
      const n = need(); if (n) return n
      const staff = await staffUser(); purge()
      try {
        const before = await summary(staff); if (!before?.by_channel) return { ok: false, hint: `sales_summary ไม่มี by_channel: ${JSON.stringify(before).slice(0, 120)}` }
        if (!CH.every((c) => before.by_channel[c] && ['bills', 'revenue', 'cups'].every((k) => typeof before.by_channel[c][k] === 'number'))) return { ok: false, hint: `by_channel ไม่ครบ: ${JSON.stringify(before.by_channel).slice(0, 160)}` }
        const rs = []; for (const c of ['store', 'line', 'delivery', 'delivery']) rs.push(await bill(staff, c))
        const after = await summary(staff)
        const d = (c, k) => after.by_channel[c][k] - before.by_channel[c][k]
        const per = { store: [1, 150], line: [1, 150], web: [0, 0], delivery: [2, 300] }
        const bad = CH.filter((c) => d(c, 'bills') !== per[c][0] || d(c, 'revenue') !== per[c][1] || d(c, 'cups') !== per[c][0] * 2)
        const sum = (k) => CH.reduce((a, c) => a + after.by_channel[c][k], 0)
        const tot = sum('bills') === after.bills && sum('revenue') === after.revenue && sum('cups') === after.cups
        return { ok: !bad.length && tot && rs.every((r) => r.ok), hint: `ช่องที่ผลต่างผิด=${bad.join(',') || 'ไม่มี'} · ผลรวมช่อง=ยอดรวม ${tot} (bills ${sum('bills')}/${after.bills}) · เรียกบิลสำเร็จ ${rs.filter((r) => r.ok).length}/4` }
      } finally { purge(); await delUser(staff.id) }
    },
  },
  {
    part: 'break', name: 'ออเดอร์ใหม่ทางช่อง LINE → คิวแจ้งเตือนมี payload.channel · notify_owner ส่งข้อความไทยที่บอกช่อง "LINE" · ช่องเว็บบอก "เว็บ"',
    run: async () => {
      const n = need(); if (n) return n
      if (!hasFn('notify_owner')) return { ok: false, hint: 'ไม่มี notify_owner' }
      const fake = await startFakeLine(); let s; purge(); sql("update notify_queue set status='sent' where status='pending'")
      try {
        s = await serve('notify_owner', mkEnv(fake))
        const po = await preorder('15:00', '0900000025', 'line'), code = po.body?.code
        const pay = scalar(`select payload->>'channel' from notify_queue where dedupe_key='order_placed:${code}'`)
        const r = await post(s.url, {}); const t1 = bodyText(pushes(fake)[0] ?? {})
        const po2 = await preorder('15:30', '0900000026'); await post(s.url, {}); const t2 = bodyText(pushes(fake).find((p) => bodyText(p).includes(po2.body?.code ?? 'none')) ?? {})
        return { ok: pay === 'line' && r.status === 200 && t1.includes(LABEL.line) && t1.includes(code) && t2.includes(LABEL.web), hint: `payload.channel=${pay} · ข้อความ LINE: "${t1}" · ข้อความเว็บ: "${t2}"` }
      } finally { s?.stop(); await fake.close(); purge() }
    },
  },
  {
    part: 'break', name: 'สรุปเช้า: morning_summary_data.by_channel นับออเดอร์วันนี้แยกช่อง · ข้อความ morning_summary มีบรรทัดช่องทางเฉพาะช่องที่มีออเดอร์ (LINE และ เว็บ)',
    run: async () => {
      const n = need(); if (n) return n
      if (!hasFn('morning_summary')) return { ok: false, hint: 'ไม่มี morning_summary' }
      const fake = await startFakeLine(); let s; purge(); sql("delete from orders where code like 'SC-97%'")
      const at = "((now() at time zone 'Asia/Bangkok')::date + time '10:00') at time zone 'Asia/Bangkok'"
      const mk = (code, ch) => { sql(`insert into orders(code,customer_name,phone,pickup_at,status,total,channel) values ('${code}','ทดสอบ','0900000023',${at},'placed',75,'${ch}')`); sql(`insert into order_items(order_id,menu_item_id,qty,options,unit_price,cups) values ((select id from orders where code='${code}'),(select id from menu_items where name='ลาเต้'),1,'[]',75,1)`) }
      try {
        mk('SC-97101', 'line'); mk('SC-97102', 'web'); mk('SC-97103', 'web')
        const d = scalar("select morning_summary_data()::text"); let j = {}; try { j = JSON.parse(d) } catch { /* ว่าง */ }
        const bc = j.by_channel ?? {}
        s = await serve('morning_summary', mkEnv(fake)); const r = await post(s.url, {}); const t = bodyText(pushes(fake)[0] ?? {})
        const line = t.split('\n').find((l) => /ช่องทาง/.test(l)) ?? ''
        return { ok: bc.line >= 1 && bc.web >= 2 && CH.every((c) => typeof bc[c] === 'number') && r.status === 200 && /LINE\s*\d/.test(line) && /เว็บ\s*\d/.test(line) && !/เดลิเวอรี/.test(line), hint: `by_channel=${JSON.stringify(bc)} · ข้อความ "${t.slice(0, 160).replace(/\n/g, ' / ')}" · บรรทัดช่องทาง="${line}"` }
      } finally { s?.stop(); await fake.close(); sql("delete from orders where code like 'SC-97%'"); purge() }
    },
  },
  {
    part: 'break', name: 'test SQL ของ channel มี (supabase/tests/*channel*.sql) และ npm run test:db ผ่านทั้งหมด',
    run: () => {
      const n = need(); if (n) return n
      if (!walk('supabase/tests').some((f) => /channel/i.test(f))) return { ok: false, hint: 'ยังไม่มี supabase/tests/14_channel.sql' }
      const r = run('bash', ['tools/dbtest.sh']); return { ok: r.ok, hint: r.ok ? '' : r.out.slice(-500) }
    },
  },
  {
    part: 'extra', name: 'POS: ปุ่ม channel-store/line/web/delivery · คิว offline เก็บ channel ไปกับบิล · ส่ง p_channel ตอนบันทึก · build ผ่าน',
    run: () => {
      if (!exists('pos/src')) return { ok: false, hint: 'ไม่มี pos/' }
      const ids = CH.every((c) => staticHas('pos/src', new RegExp(`channel-\\$\\{|channel-${c}`))) || staticHas('pos/src', /data-testid=\{`channel-\$\{/)
      const q = /channel/.test(read('pos/src/queue.ts')), rpcc = staticHas('pos/src', /p_channel/)
      const b = buildOk('pos')
      return { ok: ids && q && rpcc && b.ok, hint: `ปุ่มช่อง=${ids} · queue.ts มี channel=${q} · ส่ง p_channel=${rpcc} · build ${b.ok ? 'ผ่าน' : b.out}` }
    },
  },
  {
    part: 'extra', name: 'แอปเจ้าของ: channel-total-<ช่อง> ครบสี่ช่อง จาก by_channel · หน้าเว็บส่ง p_channel ชัดเจน · build ของ owner/ และ web/ ผ่าน',
    run: () => {
      if (!exists('owner/src')) return { ok: false, hint: 'ไม่มี owner/ (บท 22)' }
      const own = (staticHas('owner/src', /channel-total-/) && staticHas('owner/src', /by_channel/)), web = staticHas('web/src', /p_channel/)
      const b1 = buildOk('owner'), b2 = buildOk('web')
      return { ok: own && web && b1.ok && b2.ok, hint: `owner มี channel-total + by_channel=${own} · web ส่ง p_channel=${web} · build owner ${b1.ok ? 'ผ่าน' : b1.out} · build web ${b2.ok ? 'ผ่าน' : b2.out}` }
    },
  },
  {
    part: 'extra', name: 'workflow แก้จนเขียว (tools/green-loop.mjs): หยุดเมื่อเขียว · หยุดเมื่อครบ N รอบ · หยุดเมื่อแก้สองครั้งติดกันแล้วแดงเหมือนเดิม · ส่งรายการที่แดงเข้า prompt · คุมงบต่อรอบ',
    run: () => {
      if (!exists('tools/green-loop.mjs')) return { ok: false, hint: 'ไม่มี tools/green-loop.mjs' }
      const d = mkdtempSync(join(tmpdir(), 'cafe-loop-')); const out = []
      try {
        const fake = join(d, 'fake-claude.mjs'), chk = join(d, 'chk.mjs')
        writeFileSync(join(d, 'claude'), `#!/bin/sh\nexec node "${fake}" "$@"\n`, { mode: 0o755 })
        writeFileSync(fake, `import {appendFileSync,readFileSync,existsSync,writeFileSync} from 'node:fs'
const d=${JSON.stringify(d)}; appendFileSync(d+'/calls.log', JSON.stringify(process.argv.slice(2))+'\\n')
const n=readFileSync(d+'/calls.log','utf8').split('\\n').filter(Boolean).length
const fixAt=Number(process.env.FIX_AT||0); if(fixAt&&n>=fixAt) writeFileSync(d+'/fixed','1')
if(process.env.PROGRESS) writeFileSync(d+'/p', String(n))
console.log(JSON.stringify({total_cost_usd:0.25,result:'ok'}))`)
        writeFileSync(chk, `import {existsSync,readFileSync} from 'node:fs'
const d=${JSON.stringify(d)}; const fixed=existsSync(d+'/fixed'); const p=existsSync(d+'/p')?Number(readFileSync(d+'/p','utf8')):0
const r=[{part:'win',name:'ข้อ A',ok:true,hint:''}]
if(!fixed){ r.push({part:'win',name:'ข้อ B '+(process.env.PROGRESS?p:''),ok:false,hint:'ตัวอย่างข้อที่แดง'}) }
console.log(JSON.stringify(r))`)
        const loop = (env, args = []) => {
          rmSync(join(d, 'calls.log'), { force: true }); rmSync(join(d, 'fixed'), { force: true }); rmSync(join(d, 'p'), { force: true })
          const r = spawnSync('node', [resolve(root, 'tools/green-loop.mjs'), '--check-cmd', `node ${chk}`, ...args], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, CLAUDE_BIN: join(d, 'claude'), ...env } })
          const calls = existsSync(join(d, 'calls.log')) ? readFileSync(join(d, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
          return { status: r.status, text: r.stdout + r.stderr, calls }
        }
        const a = loop({ FIX_AT: '2' }, ['--rounds', '4'])                  // เขียวหลังเรียก 2 ครั้ง
        const b = loop({ PROGRESS: '1' }, ['--rounds', '3'])               // แดงข้อต่างกันทุกรอบ (คืบหน้าเสมอ) แต่ไม่เคยเขียว → ครบ 3 รอบ
        const c = loop({}, ['--rounds', '5'])                              // แดงเหมือนเดิมทุกรอบ → หยุดเพราะไม่คืบหน้า
        const g = loop({}, ['--rounds', '3', '--budget', '0.7'])
        const p0 = a.calls[0] ?? []
        const argsOk = p0[0] === '-p' && /ข้อ B/.test(p0[1] ?? '') && /ตัวอย่างข้อที่แดง/.test(p0[1] ?? '') && p0.includes('--max-budget-usd')
        const bud = g.calls[0]?.[g.calls[0].indexOf('--max-budget-usd') + 1] === '0.7'
        const ok = a.status === 0 && a.calls.length === 2 && b.status === 1 && b.calls.length === 3 && c.status === 1 && c.calls.length <= 2 && /ไม่คืบหน้า/.test(c.text) && argsOk && bud && /\$/.test(a.text)
        out.push(`เขียวหลัง 2 ครั้ง: exit ${a.status} เรียก ${a.calls.length}`, `ครบ 3 รอบ: exit ${b.status} เรียก ${b.calls.length}`, `ไม่คืบหน้า: exit ${c.status} เรียก ${c.calls.length}`, `args ถูก=${argsOk} budget=${bud}`)
        return { ok, hint: out.join(' · ') }
      } finally { rmSync(d, { recursive: true, force: true }) }
    },
  },
  {
    part: 'extra', name: 'docs/workflow-vs-team.md: ตารางเทียบ workflow กับ agent team · บอกว่า experimental/ทดลอง · ชื่อ flag CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS · ลิงก์เอกสารทางการ · มีตัวเลขค่าใช้จ่ายจริงของรอบ workflow ($)',
    run: () => {
      const t = read('docs/workflow-vs-team.md'); if (!t) return { ok: false, hint: 'ยังไม่มี docs/workflow-vs-team.md' }
      const checks = { 'ตาราง': /\|.*\|\n\|[\s:|-]+\|/.test(t), 'experimental': /experimental|ทดลอง/i.test(t), 'flag': t.includes('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'), 'URL': t.includes('https://code.claude.com/docs/en/agent-teams'), 'ค่าใช้จ่ายจริง': /\$\s*\d+(\.\d+)?/.test(t), 'workflow': /green-loop|workflow/i.test(t), 'interactive': /interactive|-p/.test(t) }
      const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k)
      return { ok: !bad.length, hint: bad.length ? `ขาด: ${bad.join(', ')}` : '' }
    },
  },
]
