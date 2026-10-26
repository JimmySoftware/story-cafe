import { exists, read, run, walk } from './lib.mjs'
import { rows, scalar, sql, dbUp } from './db.mjs'
import { rpc, newUser, delUser } from './api.mjs'
import { serve, post } from './fn.mjs'
import { startFakeLine, signLine } from '../fakes/line.mjs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const OWNER = 'U0123456789abcdef0123456789abcdef', STRANGER = 'Uffffffffffffffffffffffffffffffff'
const SECRET = '0123456789abcdef0123456789abcdef'
const has = (fn) => ['handler.ts', 'index.ts'].every((f) => exists(`supabase/functions/${fn}/${f}`))
const mkEnv = (fake, o = {}) => ({ LINE_API_BASE: fake.url, LINE_CHANNEL_ACCESS_TOKEN: fake.token, LINE_CHANNEL_SECRET: SECRET, LINE_OWNER_USER_ID: OWNER, ...o })
const today = (hhmm) => `((now() at time zone 'Asia/Bangkok')::date + time '${hhmm}') at time zone 'Asia/Bangkok'`
const dayStr = () => scalar("select (now() at time zone 'Asia/Bangkok')::date::text")
const mkOrder = (code, hhmm, status = 'placed', qty = 2, phone = '0900000016') => {
  sql(`insert into orders(code,customer_name,phone,pickup_at,status,total) values ('${code}','ทดสอบ','${phone}',${today(hhmm)},'${status}',${qty * 75})`)
  sql(`insert into order_items(order_id,menu_item_id,qty,options,unit_price,cups) values ((select id from orders where code='${code}'),(select id from menu_items where name='ลาเต้'),${qty},'[]',75,${qty})`)
}
const purge = () => { sql("delete from orders where code like 'SC-99%'"); sql("delete from line_events where id like 'chk-%'") }
const status = (code) => scalar(`select status from orders where code='${code}'`)
const pushes = (f) => f.log.filter((l) => l.path === '/v2/bot/message/push')
const replies = (f) => f.log.filter((l) => l.path === '/v2/bot/message/reply')
const evt = (id, userId, text, token = 'rt-' + id, extra = {}) => ({ type: 'message', webhookEventId: id, mode: 'active', timestamp: Date.now(), source: { type: 'user', userId }, replyToken: token, deliveryContext: { isRedelivery: false }, message: { type: 'text', id: '1', text }, ...extra })
const hook = (url, events, { secret = SECRET, header = 'x-line-signature', sig } = {}) => {
  const body = JSON.stringify({ destination: 'Udest', events })
  return post(url, body, sig === null ? {} : { [header]: sig ?? signLine(body, secret) })
}

export const checks = [
  {
    part: 'win', name: 'migration: orders รับสถานะ confirmed · line_events · record_line_event / confirm_preorder (เรียกจากลูกค้าไม่ได้ · service_role เท่านั้น)',
    run: async () => {
      const n = need(); if (n) return n
      purge()
      const fns = (rows("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'") ?? []).map((r) => r[0])
      const miss = ['record_line_event', 'confirm_preorder'].filter((f) => !fns.includes(f))
      if (miss.length) return { ok: false, hint: `ไม่มีฟังก์ชัน ${miss.join(', ')}` }
      mkOrder('SC-99001', '09:00')
      const st = sql("begin; update orders set status='confirmed' where code='SC-99001'; rollback")
      const tbl = scalar("select count(*) from information_schema.tables where table_schema='public' and table_name='line_events'")
      const u = await newUser('l16')
      try {
        const a = await rpc('confirm_preorder', { p_code: 'SC-99001' }, u.token), b = await rpc('record_line_event', { p_id: 'chk-x' }, u.token), d = await rpc('record_line_event', { p_id: 'chk-y' })
        return { ok: st.ok && tbl === '1' && !a.ok && !b.ok && !d.ok,
          hint: `สถานะ confirmed ใช้ได้=${st.ok} · ตาราง line_events=${tbl === '1'} · ลูกค้าเรียก confirm_preorder ได้=${a.ok}, record_line_event ได้=${b.ok} (anon ${d.ok})` }
      } finally { purge(); await delUser(u.id) }
    },
  },
  {
    part: 'win', name: 'confirm_preorder / record_line_event ทำงานตามกติกา (placed → confirmed · ยืนยันซ้ำ → already · cancelled → bad_status · ไม่พบ → not_found · event ซ้ำ → false)',
    run: () => {
      const n = need(); if (n) return n
      purge()
      try {
        mkOrder('SC-99001', '09:00', 'placed', 2); mkOrder('SC-99003', '11:00', 'cancelled', 5)
        const c1 = sql("select confirm_preorder('SC-99001')"), c2 = sql("select confirm_preorder('SC-99001')"), c3 = sql("select confirm_preorder('SC-99003')"), c4 = sql("select confirm_preorder('SC-NOPE')")
        const e1 = scalar("select record_line_event('chk-1')"), e2 = scalar("select record_line_event('chk-1')")
        const ok = c1.ok && status('SC-99001') === 'confirmed' && /already/.test(c2.out) && !c3.ok && /bad_status/.test(c3.out) && !c4.ok && /not_found/.test(c4.out) && e1 === 't' && e2 === 'f'
        return { ok, hint: `ยืนยัน→${status('SC-99001')} ซ้ำ=${/already/.test(c2.out)} cancelled→${/bad_status/.test(c3.out)} ไม่พบ→${/not_found/.test(c4.out)} · event ใหม่/ซ้ำ ${e1}/${e2}` }
      } finally { purge() }
    },
  },
  {
    part: 'break', name: 'morning_summary_data (เรียกจากลูกค้าไม่ได้) + งาน cron "morning-summary" ที่ 0 0 * * * (= 07:00 เวลาไทย) เรียก morning_summary',
    run: async () => {
      const n = need(); if (n) return n
      const job = rows("select schedule, replace(replace(command, chr(10), ' '), '|', ' ') from cron.job where jobname='morning-summary'")?.[0]
      const u = await newUser('l16b')
      try {
        const c = await rpc('morning_summary_data', {}, u.token), d = await rpc('morning_summary_data', {})
        return { ok: job?.[0] === '0 0 * * *' && /morning_summary/.test(job?.[1] ?? '') && !c.ok && !d.ok,
          hint: `cron.job: ${JSON.stringify(job?.[0])} (ต้อง "0 0 * * *") คำสั่งเรียก morning_summary=${/morning_summary/.test(job?.[1] ?? '')} · ลูกค้าเรียก morning_summary_data ได้=${c.ok} (anon ${d.ok})` }
      } finally { await delUser(u.id) }
    },
  },
  {
    part: 'break', name: 'morning_summary_data ทำงานตามกติกา (นับออเดอร์วันนี้เวลาไทย · แก้วรวม · วัตถุดิบใกล้หมด)',
    run: () => {
      const n = need(); if (n) return n
      purge(); const ing = rows("select stock from ingredients where name='นมวัว'")?.[0]?.[0]
      try {
        mkOrder('SC-99001', '09:00', 'placed', 2); mkOrder('SC-99002', '14:30', 'confirmed', 3); mkOrder('SC-99003', '11:00', 'cancelled', 5)
        sql("update ingredients set stock=100 where name='นมวัว'")
        const before = rows("select count(*) from orders where status in ('placed','confirmed') and (pickup_at at time zone 'Asia/Bangkok')::date=(now() at time zone 'Asia/Bangkok')::date")?.[0]?.[0]
        const d = JSON.parse(scalar('select morning_summary_data()::text'))
        const low = (d.low_stock ?? []).map((x) => x.name)
        const ok = String(d.orders) === before && d.cups === 5 && low.includes('นมวัว') && !low.includes('ชาซีลอน') && d.day === dayStr() && /^\d\d:\d\d$/.test(d.first_pickup ?? '')
        return { ok, hint: `สรุป ${JSON.stringify(d).slice(0, 220)} (ออเดอร์วันนี้ที่ควรนับ ${before}) · ใกล้หมด ${low.join(',')}` }
      } finally { sql(`update ingredients set stock=${ing} where name='นมวัว'`); purge() }
    },
  },
  {
    part: 'break', name: 'morning_summary: ส่ง push หาเจ้าของ (ไทย: วันที่ · จำนวนออเดอร์/แก้ว · วัตถุดิบใกล้หมด) · retry key เดิมเมื่อรันซ้ำวันเดียวกัน (LINE 409 → ยังตอบ 200) · LINE ล่ม → 502 · ไม่มี token → 500',
    run: async () => {
      const n = need(); if (n) return n
      if (!has('morning_summary')) return { ok: false, hint: 'ต้องมี supabase/functions/morning_summary/handler.ts และ index.ts' }
      purge(); const ing = rows("select stock from ingredients where name='นมวัว'")?.[0]?.[0]
      const fake = await startFakeLine(); const sv = []
      try {
        mkOrder('SC-99001', '09:00', 'placed', 2); sql("update ingredients set stock=100 where name='นมวัว'")
        const s = await serve('morning_summary', mkEnv(fake)); sv.push(s)
        const r = await post(s.url, {}), r2 = await post(s.url, {}); const p = pushes(fake)
        const b = JSON.parse(p[0]?.body ?? '{}'); const text = b.messages?.[0]?.text ?? ''
        fake.setMode('500'); const down = await post(s.url, {}); fake.setMode('ok')
        const nt = await serve('morning_summary', mkEnv(fake, { LINE_CHANNEL_ACCESS_TOKEN: '' })); sv.push(nt)
        const none = await post(nt.url, {})
        const ok = r.status === 200 && r2.status === 200 && p.length >= 2 && p[0].retryKey === p[1].retryKey && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p[0].retryKey) && fake.log.some((l) => l.result === 409)
          && b.to === OWNER && /[ก-๙]/.test(text) && text.includes('นมวัว') && !text.includes('ชาซีลอน') && /\d/.test(text) && down.status === 502 && none.status === 500 && /line_not_configured/.test(none.text)
        return { ok, hint: `ครั้งแรก ${r.status} ซ้ำ ${r2.status} · push ${p.length} ครั้ง retry key เดิม=${p[0]?.retryKey === p[1]?.retryKey} 409=${fake.log.some((l) => l.result === 409)} · ข้อความ "${text.slice(0, 120)}" · LINE ล่ม→${down.status} (502) · ไม่มี token→${none.status} ${none.text.slice(0, 40)}` }
      } finally { sv.forEach((x) => x.stop()); await fake.close(); sql(`update ingredients set stock=${ing} where name='นมวัว'`); purge() }
    },
  },
  // ---- ลองพัง: webhook ปลอม / ซ้ำ / คนอื่น ----
  {
    part: 'break', name: 'line_webhook: ลายเซ็นผิด / กุญแจผิด / ไม่มี header / body ขยะ → 401 และออเดอร์ไม่ถูกแตะ · ลายเซ็นถูกจากเจ้าของ "ยืนยัน SC-…" → confirmed + ตอบกลับด้วย reply API · events ว่าง (Verify) → 200',
    run: async () => {
      const n = need(); if (n) return n
      if (!has('line_webhook')) return { ok: false, hint: 'ต้องมี supabase/functions/line_webhook/handler.ts และ index.ts' }
      purge(); const fake = await startFakeLine({ channelSecret: SECRET }); let s
      try {
        s = await serve('line_webhook', mkEnv(fake)); mkOrder('SC-99010', '10:00')
        const ev = [evt('chk-a1', OWNER, 'ยืนยัน SC-99010')]
        const bad = {
          wrongSig: await hook(s.url, ev, { sig: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }), wrongSecret: await hook(s.url, ev, { secret: 'ffffffffffffffffffffffffffffffff' }), noHeader: await hook(s.url, ev, { sig: null }),
          garbage: await post(s.url, '<<<ไม่ใช่ json>>>', { 'x-line-signature': 'AAAA' }), hexNotBase64: await post(s.url, JSON.stringify({ events: ev }), { 'x-line-signature': 'deadbeef' }),
        }
        const badStatuses = Object.entries(bad).filter(([, r]) => r.status !== 401).map(([k, r]) => `${k}→${r.status}`)
        const untouched = status('SC-99010') === 'placed' && replies(fake).length === 0 && Number(scalar("select count(*) from line_events where id='chk-a1'")) === 0
        const good = await hook(s.url, ev); const upper = await hook(s.url, [evt('chk-a0', OWNER, 'ยืนยัน SC-90000')], { header: 'X-Line-Signature' })
        const verify = await hook(s.url, [])
        const rep = replies(fake)
        return { ok: !badStatuses.length && untouched && good.status === 200 && status('SC-99010') === 'confirmed' && rep.length >= 1 && rep[0].auth === `Bearer ${fake.token}` && JSON.parse(rep[0].body).replyToken === 'rt-chk-a1' && /SC-99010/.test(rep[0].body) && upper.status === 200 && verify.status === 200,
          hint: `ต้อง 401 แต่ได้: ${badStatuses.join(', ') || '-'} · ลายเซ็นผิดแล้วออเดอร์ไม่ถูกแตะ/ไม่ reply/ไม่บันทึก event=${untouched} · ลายเซ็นถูก→${good.status} สถานะ ${status('SC-99010')} reply ${rep.length} ครั้ง · header ตัวพิมพ์ต่าง→${upper.status} · events ว่าง→${verify.status}` }
      } finally { s?.stop(); await fake.close(); purge() }
    },
  },
  {
    part: 'break', name: 'line_webhook: event ซ้ำ (webhookEventId เดิม / redelivery) ไม่ทำซ้ำ ไม่ตอบซ้ำ · คนที่ไม่ใช่เจ้าของพิมพ์ยืนยัน → ออเดอร์ไม่เปลี่ยน · รหัสไม่มี/สถานะผิด → ตอบกลับสุภาพ · reply ล้มเหลวก็ยังตอบ 200',
    run: async () => {
      const n = need(); if (n) return n
      if (!has('line_webhook')) return { ok: false, hint: 'ยังไม่มี line_webhook' }
      purge(); const fake = await startFakeLine({ channelSecret: SECRET }); let s
      try {
        s = await serve('line_webhook', mkEnv(fake)); mkOrder('SC-99011', '10:10'); mkOrder('SC-99012', '10:20', 'cancelled'); mkOrder('SC-99013', '10:30')
        await hook(s.url, [evt('chk-b1', OWNER, 'ยืนยัน SC-99011')]); const after1 = replies(fake).length
        sql("update orders set status='placed' where code='SC-99011'") // ถ้า event ซ้ำทำงานซ้ำ จะกลับไป confirmed
        const dup = await hook(s.url, [evt('chk-b1', OWNER, 'ยืนยัน SC-99011', 'rt-other', { deliveryContext: { isRedelivery: true } })])
        const dupOk = dup.status === 200 && status('SC-99011') === 'placed' && replies(fake).length === after1
        const stranger = await hook(s.url, [evt('chk-b2', STRANGER, 'ยืนยัน SC-99013')]); const strangerOk = stranger.status === 200 && status('SC-99013') === 'placed'
        const before = replies(fake).length
        const nf = await hook(s.url, [evt('chk-b3', OWNER, 'ยืนยัน SC-90000')]), bs = await hook(s.url, [evt('chk-b4', OWNER, 'ยืนยัน SC-99012')])
        const msgs = replies(fake).slice(before).map((r) => JSON.parse(r.body).messages?.[0]?.text ?? '')
        fake.setMode('500'); const down = await hook(s.url, [evt('chk-b5', OWNER, 'ยืนยัน SC-99013')]); fake.setMode('ok')
        return { ok: dupOk && strangerOk && nf.status === 200 && bs.status === 200 && msgs.length === 2 && /SC-90000/.test(msgs[0]) && /SC-99012/.test(msgs[1]) && status('SC-99012') === 'cancelled' && down.status === 200 && status('SC-99013') === 'confirmed',
          hint: `event ซ้ำไม่ทำซ้ำ=${dupOk} (สถานะ ${status('SC-99011')}, reply ${replies(fake).length - after1} ครั้งเพิ่ม) · คนอื่นพิมพ์ยืนยัน→สถานะ ${status('SC-99013')} ตอบ ${stranger.status} · ไม่พบ/สถานะผิด ตอบกลับ ${msgs.length}/2 ข้อความ ${JSON.stringify(msgs)} · reply ล้ม→${down.status} (ต้อง 200)` }
      } finally { s?.stop(); await fake.close(); purge() }
    },
  },
  {
    part: 'break', name: 'ครบวงจรกับ LINE จำลอง: จำลองเจ้าของพิมพ์ "ยืนยัน …" ผ่าน /__webhook ของ fake (ลงนามตามอัลกอริทึม LINE) → confirmed · ลายเซ็นผิดจาก fake → 401',
    run: async () => {
      const n = need(); if (n) return n
      if (!has('line_webhook')) return { ok: false, hint: 'ยังไม่มี line_webhook' }
      purge(); const fake = await startFakeLine({ channelSecret: SECRET }); let s
      try {
        s = await serve('line_webhook', mkEnv(fake)); mkOrder('SC-99020', '10:40')
        const f = (o) => fetch(`${fake.url}/__webhook`, { method: 'POST', body: JSON.stringify(o) }).then((r) => r.json())
        const bad = await f({ url: s.url, badSignature: true, events: [evt('chk-c0', OWNER, 'ยืนยัน SC-99020')] })
        const ok = await f({ url: s.url, events: [evt('chk-c1', OWNER, 'ยืนยัน SC-99020')] })
        return { ok: bad.status === 401 && ok.status === 200 && status('SC-99020') === 'confirmed', hint: `ลายเซ็นผิด→${bad.status} ลายเซ็นถูก→${ok.status} สถานะ ${status('SC-99020')}` }
      } finally { s?.stop(); await fake.close(); purge() }
    },
  },
  {
    part: 'extra', name: 'มี handler.test.ts ของ morning_summary และ line_webhook · npm test กับ npm run test:db ผ่าน · ไม่มี token/secret พิมพ์ในโค้ดหรือ migration',
    run: () => {
      const tests = ['morning_summary', 'line_webhook'].filter((f) => walk(`supabase/functions/${f}`).some((p) => /\.test\.ts$/.test(p)))
      const code = [...walk('supabase/functions').filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p)), ...walk('supabase/migrations')].map(read).join('\n')
      const hard = /Bearer\s+[A-Za-z0-9+/=]{30,}|[a-f0-9]{32}['"]/.test(code)
      const t = run('npm', ['test', '--silent']), d = run('npm', ['run', 'test:db', '--silent'])
      return { ok: tests.length === 2 && t.ok && d.ok && !hard, hint: `มี test ของ: ${tests.join(', ') || '-'} · npm test=${t.ok} · test:db=${d.ok} · ความลับในโค้ด=${hard}` }
    },
  },
  {
    part: 'later', name: '[ตรวจหลังสมัคร LINE] ตั้ง Webhook URL ใน LINE Developers Console แล้วกด Verify · พิมพ์ "ยืนยัน SC-…" จากมือถือเจ้าของ · รอ cron 07:00 รันจริงและข้อความมาถึง',
    run: () => ({ ok: false, skip: true, hint: 'ทำหลังสมัคร LINE Official Account และ deploy ฟังก์ชันขึ้น Supabase จริง' }),
  },
]
