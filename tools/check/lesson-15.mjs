import { exists, read, run, walk } from './lib.mjs'
import { rows, scalar, sql, dbUp } from './db.mjs'
import { rpc, newUser, delUser } from './api.mjs'
import { serve, post } from './fn.mjs'
import { startFakeLine } from '../fakes/line.mjs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const OWNER = 'U0123456789abcdef0123456789abcdef'
const SHIP = { name: 'ผู้ทดสอบ', phone: '0900000015', address: 'ซอยสมมติ 9 (ที่อยู่สมมติ)' }
const has = () => ['handler.ts', 'index.ts'].every((f) => exists(`supabase/functions/notify_owner/${f}`))
const tmr = (hhmm) => `((now() at time zone 'Asia/Bangkok')::date + 1 + time '${hhmm}') at time zone 'Asia/Bangkok'`
const snap = () => rows('select sku,stock from products') ?? []
const restock = (s) => { for (const [sku, st] of s) sql(`update products set stock=${st} where sku='${sku}'`) }
const q = (code) => rows(`select status,attempts,retry_key,coalesce(last_error,''),next_attempt_at > now() from notify_queue where dedupe_key='order_placed:${code}'`)?.[0]
const placePre = (phone, hhmm = '15:30') => scalar(`select place_preorder('ทดสอบ','${phone}',${tmr(hhmm)}, jsonb_build_array(jsonb_build_object('menu_item_id',(select id from menu_items where name='ลาเต้'),'qty',1,'options','[]'::jsonb)))::jsonb->>'code'`)
const purgeAll = () => { sql("delete from notify_queue where dedupe_key like 'order_placed:%' and (payload->>'code' in (select code from orders where phone like '09000000%') or payload->>'code' in (select code from shop_orders where ship_phone like '09000000%'))"); sql("delete from orders where phone like '09000000%'"); sql('delete from pickup_slots where slot_start not in (select pickup_at from orders)') }
const mkEnv = (fake, o = {}) => ({ LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token, LINE_OWNER_USER_ID: OWNER, ...o })
const pushes = (fake) => fake.log.filter((l) => l.path === '/v2/bot/message/push')

export const checks = [
  {
    part: 'win', name: 'ตาราง notify_queue ตาม brief · RLS ปิดสำหรับลูกค้า · claim_notifications / finish_notification เรียกจากลูกค้าไม่ได้',
    run: async () => {
      const n = need(); if (n) return n
      const cols = (rows("select column_name from information_schema.columns where table_schema='public' and table_name='notify_queue'") ?? []).map((r) => r[0])
      const miss = ['id', 'kind', 'payload', 'dedupe_key', 'status', 'attempts', 'next_attempt_at', 'retry_key', 'last_error', 'created_at', 'sent_at'].filter((c) => !cols.includes(c))
      if (miss.length) return { ok: false, hint: cols.length ? `notify_queue ขาดคอลัมน์ ${miss.join(', ')}` : 'ยังไม่มีตาราง notify_queue' }
      const anon = sql('begin; set local role anon; select count(*) from notify_queue; rollback'), rls = scalar("select relrowsecurity from pg_class where relname='notify_queue'")
      const u = await newUser('nq')
      try {
        const a = await rpc('claim_notifications', { p_limit: 5 }), b = await rpc('claim_notifications', { p_limit: 5 }, u.token), c = await rpc('finish_notification', { p_id: '00000000-0000-0000-0000-000000000000', p_outcome: 'sent' }, u.token)
        return { ok: rls === 't' && (!anon.ok || anon.out.trim() === '0') && !a.ok && !b.ok && !c.ok, hint: `RLS=${rls} · anon อ่านคิวได้=${anon.ok && anon.out.trim() !== '0'} · anon เรียก claim ได้=${a.ok} · ลูกค้าเรียก claim ได้=${b.ok} · ลูกค้าเรียก finish ได้=${c.ok}` }
      } finally { await delUser(u.id) }
    },
  },
  {
    part: 'win', name: 'สั่งล่วงหน้า 1 ออเดอร์ → มีแถวคิวเดียว (order_placed:<code>, pending) · ออเดอร์ร้านค้าออนไลน์ก็เข้าคิว · ใส่ซ้ำ dedupe_key เดิมไม่เพิ่มแถว',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap(); const u = await newUser('nq2'); purgeAll()
      try {
        const code = placePre('0900000015'); const row = q(code)
        const before = Number(scalar(`select count(*) from notify_queue where dedupe_key='order_placed:${code}'`))
        sql(`insert into notify_queue(kind,payload,dedupe_key) values ('order_placed','{}','order_placed:${code}') on conflict do nothing`)
        const after = Number(scalar(`select count(*) from notify_queue where dedupe_key='order_placed:${code}'`))
        const o = await rpc('create_order', { p_items: [{ sku: 'drip-5', qty: 1 }], p_ship: SHIP }, u.token)
        const shopRow = q(o.body?.code ?? 'none')
        const payload = scalar(`select payload::text from notify_queue where dedupe_key='order_placed:${code}'`) ?? ''
        return { ok: !!code && row?.[0] === 'pending' && before === 1 && after === 1 && shopRow?.[0] === 'pending' && payload.includes(code) && /preorder/.test(payload),
          hint: `สั่งล่วงหน้า ${code}: คิว ${JSON.stringify(row?.slice(0, 2))} · แถวก่อน/หลังใส่ซ้ำ ${before}/${after} · ออเดอร์ร้านค้า ${o.body?.code}: ${JSON.stringify(shopRow?.slice(0, 2))} · payload ${payload.slice(0, 80)}` }
      } finally { restock(s0); sql(`delete from notify_queue where payload->>'code' in (select code from shop_orders where user_id='${u.id}')`); sql(`delete from shop_orders where user_id='${u.id}'`); purgeAll(); await delUser(u.id) }
    },
  },
  {
    part: 'win', name: 'notify_owner: ส่ง push ไป LINE จำลอง 1 ครั้ง (token ถูก · to = owner · ข้อความไทยมีเลขออเดอร์และยอด · X-Line-Retry-Key = retry_key ของแถว) แถวเป็น sent · เรียกซ้ำไม่ส่งซ้ำ',
    run: async () => {
      const n = need(); if (n) return n
      if (!has()) return { ok: false, hint: 'ต้องมี supabase/functions/notify_owner/handler.ts และ index.ts' }
      const fake = await startFakeLine(); let s; purgeAll(); sql("update notify_queue set status='sent' where status='pending'")
      try {
        s = await serve('notify_owner', mkEnv(fake))
        const code = placePre('0900000016'); const total = scalar(`select total from orders where code='${code}'`)
        const r = await post(s.url, {}); const p = pushes(fake)
        const body = JSON.parse(p[0]?.body ?? '{}'); const text = body.messages?.[0]?.text ?? ''
        const row = q(code)
        const again = await post(s.url, {})
        return { ok: r.status === 200 && p.length === 1 && p[0].auth === `Bearer ${fake.token}` && body.to === OWNER && body.messages?.[0]?.type === 'text' && text.includes(code) && text.includes(String(total)) && /[ก-๙]/.test(text) && p[0].retryKey === row?.[2] && row?.[0] === 'sent' && pushes(fake).length === 1 && again.status === 200,
          hint: `สถานะฟังก์ชัน ${r.status} ${r.text.slice(0, 60)} · push ${p.length} ครั้ง · to ถูก=${body.to === OWNER} · ข้อความ "${text}" · retryKey ตรงแถว=${p[0]?.retryKey === row?.[2]} · แถว ${JSON.stringify(row?.slice(0, 2))} · เรียกซ้ำแล้ว push รวม ${pushes(fake).length} (ต้อง 1)` }
      } finally { s?.stop(); await fake.close(); purgeAll() }
    },
  },
  // ---- ลองทดสอบหนัก ๆ: LINE ล่ม / token ผิด / ส่งซ้ำ ----
  {
    part: 'break', name: 'LINE ล่ม (500) → ออเดอร์ยังเข้า · แถวเป็น pending นับ attempts เลื่อนเวลา · พอ LINE กลับมาส่งสำเร็จด้วย retry key เดิม (ข้อความเดียว)',
    run: async () => {
      const n = need(); if (n) return n
      if (!has()) return { ok: false, hint: 'ยังไม่มี notify_owner' }
      const fake = await startFakeLine(); let s; purgeAll(); sql("update notify_queue set status='sent' where status='pending'")
      try {
        s = await serve('notify_owner', mkEnv(fake))
        const code = placePre('0900000017')
        fake.setMode('500'); await post(s.url, {}); const down = q(code)
        sql(`update notify_queue set next_attempt_at=now() where dedupe_key='order_placed:${code}'`)
        fake.setMode('ok'); await post(s.url, {}); const up = q(code)
        const keys = pushes(fake).map((p) => p.retryKey)
        const orderOk = scalar(`select status from orders where code='${code}'`) === 'placed'
        return { ok: orderOk && down?.[0] === 'pending' && down?.[1] === '1' && down?.[4] === 't' && /500/.test(down?.[3] ?? '') && up?.[0] === 'sent' && keys.length === 2 && keys[0] === keys[1] && fake.log.filter((l) => l.result === 200).length === 1,
          hint: `ออเดอร์ยัง placed=${orderOk} · ตอนล่ม ${JSON.stringify(down)} (ต้อง pending/1/เลื่อนเวลา/error มี 500) · หลังกลับมา ${JSON.stringify(up?.slice(0, 2))} · retry key ที่ส่ง ${keys.length} ครั้ง ซ้ำกัน=${keys[0] === keys[1]}` }
      } finally { s?.stop(); await fake.close(); purgeAll() }
    },
  },
  {
    part: 'break', name: 'ส่งซ้ำด้วย retry key เดิม → LINE ตอบ 409 → ถือว่าส่งแล้ว (sent) · ล้มเกิน 5 ครั้ง → dead',
    run: async () => {
      const n = need(); if (n) return n
      if (!has()) return { ok: false, hint: 'ยังไม่มี notify_owner' }
      const fake = await startFakeLine(); let s; purgeAll(); sql("update notify_queue set status='sent' where status='pending'")
      try {
        s = await serve('notify_owner', mkEnv(fake))
        const code = placePre('0900000018'); const key = q(code)[2]
        await fetch(`${fake.url}/v2/bot/message/push`, { method: 'POST', headers: { authorization: `Bearer ${fake.token}`, 'content-type': 'application/json', 'x-line-retry-key': key }, body: JSON.stringify({ to: OWNER, messages: [{ type: 'text', text: 'ส่งไปแล้วก่อนหน้า' }] }) }) // จำลอง: ส่งสำเร็จแต่ตอบไม่ถึงเรา
        await post(s.url, {}); const row = q(code); const nOk = fake.log.filter((l) => l.result === 200).length, n409 = fake.log.filter((l) => l.result === 409).length
        const code2 = placePre('0900000019', '15:40')
        sql(`update notify_queue set attempts=4, next_attempt_at=now() where dedupe_key='order_placed:${code2}'`)
        fake.setMode('500'); await post(s.url, {}); const dead = q(code2)
        return { ok: row?.[0] === 'sent' && nOk === 1 && n409 === 1 && dead?.[0] === 'dead', hint: `409: แถว ${JSON.stringify(row?.slice(0, 2))} (ต้อง sent) LINE รับสำเร็จ ${nOk} ครั้ง 409 ${n409} ครั้ง · ล้มครั้งที่ 5: ${JSON.stringify(dead?.slice(0, 2))} (ต้อง dead)` }
      } finally { s?.stop(); await fake.close(); purgeAll() }
    },
  },
  {
    part: 'break', name: 'token ผิด (401) → ออเดอร์ยังเข้า · แถวเป็น failed (ไม่ลองซ้ำ) · last_error ไม่มี token · ไม่มี token/owner ใน env → failed line_not_configured ไม่ crash',
    run: async () => {
      const n = need(); if (n) return n
      if (!has()) return { ok: false, hint: 'ยังไม่มี notify_owner' }
      const fake = await startFakeLine(); const sv = []; purgeAll(); sql("update notify_queue set status='sent' where status='pending'")
      try {
        const SECRET = 'wrong-token-SECRETVALUE-123456'
        const s = await serve('notify_owner', mkEnv(fake, { LINE_CHANNEL_ACCESS_TOKEN: SECRET })); sv.push(s)
        const code = placePre('0900000020'); const r = await post(s.url, {}); const row = q(code)
        const leaked = (row?.[3] ?? '').includes('SECRETVALUE') || r.text.includes('SECRETVALUE')
        const orderOk = scalar(`select status from orders where code='${code}'`) === 'placed'
        sql(`update notify_queue set status='pending', next_attempt_at=now() where dedupe_key='order_placed:${code}'`)
        const s2 = await serve('notify_owner', mkEnv(fake, { LINE_CHANNEL_ACCESS_TOKEN: '', LINE_OWNER_USER_ID: '' })); sv.push(s2)
        const r2 = await post(s2.url, {}); const row2 = q(code)
        return { ok: orderOk && row?.[0] === 'failed' && !leaked && /401/.test(row?.[3] ?? '') && r2.status === 200 && row2?.[0] === 'failed' && /line_not_configured/.test(row2?.[3] ?? ''),
          hint: `ออเดอร์ยัง placed=${orderOk} · 401 → ${JSON.stringify(row?.slice(0, 1))} error="${row?.[3]}" หลุด token=${leaked} · ไม่ตั้งค่า → ฟังก์ชัน ${r2.status} แถว ${JSON.stringify(row2?.slice(0, 1))} error="${row2?.[3]}"` }
      } finally { sv.forEach((x) => x.stop()); await fake.close(); purgeAll() }
    },
  },
  {
    part: 'win', name: 'มี test ของ notify_owner (handler.test.ts) · npm test กับ npm run test:db ผ่าน · ไม่มี token พิมพ์ในโค้ด/.env.example มีแต่ชื่อตัวแปร',
    run: () => {
      const tests = walk('supabase/functions/notify_owner').filter((p) => /\.test\.ts$/.test(p))
      const code = walk('supabase/functions').filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p)).map(read).join('\n')
      const hard = /Bearer\s+[A-Za-z0-9+/=]{30,}/.test(code)
      const ex = read('.env.example'); const exOk = /LINE_CHANNEL_ACCESS_TOKEN=\s*$/m.test(ex) && /LINE_OWNER_USER_ID=\s*$/m.test(ex)
      const t = run('npm', ['test', '--silent']), d = run('npm', ['run', 'test:db', '--silent'])
      return { ok: tests.length > 0 && t.ok && d.ok && !hard && exOk, hint: `ไฟล์ test ${tests.length} · npm test=${t.ok} · test:db=${d.ok} · token ในโค้ด=${hard} · .env.example ถูก=${exOk}` }
    },
  },
  {
    part: 'later', name: '[ตรวจหลังสมัคร LINE] ส่งข้อความจริงถึงมือถือเจ้าของร้านด้วย token จริง · ตั้ง Database Webhook / pg_cron ให้เรียก notify_owner บน Supabase จริง',
    run: () => ({ ok: false, skip: true, hint: 'ทำหลังสมัคร LINE Official Account: ใส่ LINE_CHANNEL_ACCESS_TOKEN / LINE_OWNER_USER_ID ใน .env (ผ่านฟอร์มของ companion) แล้วลบ LINE_API_BASE' }),
  },
]
