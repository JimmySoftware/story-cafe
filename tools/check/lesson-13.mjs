import { exists, read, run, walk } from './lib.mjs'
import { rows, scalar, sql, dbUp } from './db.mjs'
import { api, rpc, newUser, delUser, env } from './api.mjs'
import { startFakeStripe, signStripe } from '../fakes/stripe.mjs'
import { serve, post } from './fn.mjs'
import { readdirSync } from 'node:fs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const WH = 'whsec_checkcheckcheck01'
const SHIP = { name: 'ผู้ทดสอบ', phone: '0900000013', address: 'ซอยสมมติ 9 (ที่อยู่สมมติ)' }
async function mkOrder(u, qty = 1, sku = 'beans-250') {
  const r = await rpc('create_order', { p_items: [{ sku, qty }], p_ship: SHIP }, u.token)
  if (!r.ok) throw new Error(`สร้างออเดอร์ทดสอบไม่ได้: ${r.text.slice(0, 120)}`)
  return r.body
}
const purge = (id) => { for (const tb of ['payment_slips', 'payments']) sql(`delete from ${tb} where order_id in (select id from shop_orders where user_id='${id}')`); sql(`delete from shop_orders where user_id='${id}'`) } // แต่ละคำสั่งแยก: ตารางอาจยังไม่มี (ก่อนถึงข้อสลิป)
const snap = () => rows('select sku,stock from products') ?? []
const restock = (s) => { for (const [sku, st] of s) sql(`update products set stock=${st} where sku='${sku}'`) }
const status = (code) => scalar(`select status from shop_orders where code='${code}'`)
const evtBody = (id, type, pi, amount, code) => JSON.stringify({ id, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object: { id: pi, object: 'payment_intent', amount, amount_received: type.endsWith('succeeded') ? amount : 0, currency: 'thb', metadata: { order_code: code } } } })
const files = (fn) => ['handler.ts', 'index.ts'].filter((f) => exists(`supabase/functions/${fn}/${f}`))

export const checks = [
  {
    part: 'win', name: 'ตาราง payments ตาม brief (migration ใหม่) และ create_payment ใช้ตารางนี้เก็บการจ่าย',
    run: () => {
      const n = need(); if (n) return n
      const have = (rows("select column_name from information_schema.columns where table_schema='public' and table_name='payments'") ?? []).map((r) => r[0])
      const miss = ['id', 'order_id', 'provider_ref', 'amount', 'status'].filter((c) => !have.includes(c))
      return { ok: have.length > 0 && !miss.length, hint: have.length ? `payments ขาดคอลัมน์ ${miss.join(', ')}` : 'ยังไม่มีตาราง payments' }
    },
  },
  {
    part: 'win', name: 'create_payment: ล็อกอินแล้วขอจ่ายออเดอร์ beans 1 ถุง → 200 มี client_secret ยอด 380 บาท · Stripe จำลองได้ 38000 สตางค์ thb promptpay + metadata + Idempotency-Key · ยอดจากฐานข้อมูล ไม่ใช่จากลูกค้า',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap()
      if (files('create_payment').length < 2) return { ok: false, hint: 'ต้องมี supabase/functions/create_payment/handler.ts และ index.ts' }
      const fake = await startFakeStripe(); const u = await newUser('pay'), u2 = await newUser('pay2'); let s
      try {
        s = await serve('create_payment', { STRIPE_API_BASE: fake.url, STRIPE_SECRET_KEY: fake.secretKey, STRIPE_WEBHOOK_SECRET: WH })
        const o = await mkOrder(u)
        const r = await post(s.url, { order_code: o.code, amount: 1, total: 1 }, { authorization: `Bearer ${u.token}` })
        const r2 = await post(s.url, { order_code: o.code }, { authorization: `Bearer ${u.token}` }) // กดซ้ำ
        const noJwt = await post(s.url, { order_code: o.code })
        const other = await post(s.url, { order_code: o.code }, { authorization: `Bearer ${u2.token}` })
        const nf = await post(s.url, { order_code: 'SH-0000000' }, { authorization: `Bearer ${u.token}` })
        const calls = fake.log.filter((l) => l.method === 'POST' && l.path === '/v1/payment_intents')
        const f = new URLSearchParams(calls[0]?.body ?? '')
        const pays = rows(`select p.provider_ref,p.amount,p.status from payments p join shop_orders o on o.id=p.order_id where o.code='${o.code}'`) ?? []
        const ok = r.status === 200 && r.json?.amount_thb === 380 && /^pi_/.test(r.json?.payment_intent_id ?? '') && !!r.json?.client_secret && f.get('amount') === '38000' && f.get('currency') === 'thb' && f.getAll('payment_method_types[]').includes('promptpay')
          && f.get('metadata[order_code]') === o.code && calls[0].auth === `Bearer ${fake.secretKey}` && /order-/.test(calls[0].idempotencyKey ?? '') && r2.status === 200 && r2.json?.payment_intent_id === r.json?.payment_intent_id
          && noJwt.status === 401 && other.status === 404 && nf.status === 404 && other.text === nf.text && pays.length === 1 && pays[0][1] === '380' && pays[0][2] === 'created'
        return { ok, hint: `สถานะ ${r.status} ${r.text.slice(0, 120)} · ส่ง Stripe: amount=${f.get('amount')} currency=${f.get('currency')} metadata=${f.get('metadata[order_code]')} · กดซ้ำได้ intent เดิม=${r2.json?.payment_intent_id === r.json?.payment_intent_id} · ไม่มี JWT→${noJwt.status} (401) · ออเดอร์คนอื่น→${other.status} (404) · ไม่พบ→${nf.status} (404 ข้อความเดียวกัน=${other.text === nf.text}) · payments ${JSON.stringify(pays)}` }
      } finally { s?.stop(); await fake.close(); restock(s0); for (const x of [u, u2]) { purge(x.id); await delUser(x.id) } }
    },
  },
  {
    part: 'win', name: 'create_payment ปลอดภัย: key เป็น sk_live_ → ปฏิเสธ (ไม่เรียก Stripe) · Stripe ตอบ error → 502 ไม่หลุด key/ข้อความ Stripe · ออเดอร์ที่จ่ายแล้ว → 409',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap()
      if (files('create_payment').length < 2) return { ok: false, hint: 'ยังไม่มี create_payment' }
      const fake = await startFakeStripe(); const u = await newUser('payS'); const sv = []
      try {
        const o = await mkOrder(u)
        const live = await serve('create_payment', { STRIPE_API_BASE: fake.url, STRIPE_SECRET_KEY: 'sk_live_notrealnotrealnotreal', STRIPE_WEBHOOK_SECRET: WH }); sv.push(live)
        const a = await post(live.url, { order_code: o.code }, { authorization: `Bearer ${u.token}` })
        const called = fake.log.filter((l) => l.path === '/v1/payment_intents').length
        const bad = await serve('create_payment', { STRIPE_API_BASE: fake.url, STRIPE_SECRET_KEY: 'sk_test_wrongwrongwrong', STRIPE_WEBHOOK_SECRET: WH }); sv.push(bad)
        const b = await post(bad.url, { order_code: o.code }, { authorization: `Bearer ${u.token}` })
        sql(`update shop_orders set status='paid' where code='${o.code}'`)
        const good = await serve('create_payment', { STRIPE_API_BASE: fake.url, STRIPE_SECRET_KEY: fake.secretKey, STRIPE_WEBHOOK_SECRET: WH }); sv.push(good)
        const c = await post(good.url, { order_code: o.code }, { authorization: `Bearer ${u.token}` })
        const leak = /sk_test_wrong|Invalid API Key|invalid_request_error/.test(b.text)
        return { ok: !a.status.toString().startsWith('2') && called === 0 && b.status === 502 && !leak && c.status === 409, hint: `sk_live_: สถานะ ${a.status} เรียก Stripe ${called} ครั้ง (ต้อง 0) · Stripe 401: ${b.status} (ต้อง 502) หลุดข้อความ=${leak} · จ่ายแล้ว: ${c.status} (ต้อง 409)` }
      } finally { sv.forEach((x) => x.stop()); await fake.close(); restock(s0); purge(u.id); await delUser(u.id) }
    },
  },
  // ---- ลองทดสอบหนัก ๆ: webhook ปลอม / ซ้ำ ----
  {
    part: 'break', name: 'ตาราง stripe_events และฟังก์ชัน mark_order_paid / record_stripe_event ตาม brief · เรียกจากลูกค้า (anon/authenticated) ไม่ได้',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap()
      const want = { stripe_events: ['id', 'type'] }
      const miss = []
      for (const [t, cols] of Object.entries(want)) {
        const have = (rows(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}'`) ?? []).map((r) => r[0])
        const m = cols.filter((c) => !have.includes(c)); if (m.length) miss.push(`${t}: ${have.length ? 'ขาด ' + m.join(', ') : 'ไม่มีตาราง'}`)
      }
      const fns = (rows("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'") ?? []).map((r) => r[0])
      for (const f of ['mark_order_paid', 'record_stripe_event']) if (!fns.includes(f)) miss.push(`ไม่มีฟังก์ชัน ${f}`)
      if (miss.length) return { ok: false, hint: miss.join(' · ') }
      const u = await newUser('perm')
      try {
        const o = await mkOrder(u)
        const a = await rpc('mark_order_paid', { p_code: o.code, p_ref: 'pi_x', p_amount: 380 })
        const b = await rpc('mark_order_paid', { p_code: o.code, p_ref: 'pi_x', p_amount: 380 }, u.token)
        const c = await rpc('record_stripe_event', { p_id: 'evt_x', p_type: 'x' }, u.token)
        return { ok: !a.ok && !b.ok && !c.ok && status(o.code) === 'pending', hint: `anon เรียก mark_order_paid ได้=${a.ok} · ลูกค้าเรียกได้=${b.ok} · ลูกค้าเรียก record_stripe_event ได้=${c.ok} · สถานะออเดอร์ ${status(o.code)}` }
      } finally { restock(s0); purge(u.id); await delUser(u.id) }
    },
  },
  {
    part: 'break', name: 'payment_webhook: จ่ายจริง (ลงนามถูก) → ออเดอร์ paid · ลายเซ็นผิด/กุญแจผิด/เก่าเกิน 5 นาที/ไม่มี header/body ขยะ → 400 และออเดอร์ไม่ถูกแตะ',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap()
      if (files('payment_webhook').length < 2) return { ok: false, hint: 'ต้องมี supabase/functions/payment_webhook/handler.ts และ index.ts' }
      const u = await newUser('wh'); let s
      try {
        s = await serve('payment_webhook', { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WH })
        const o = await mkOrder(u), o2 = await mkOrder(u)
        const body = evtBody('evt_chk_1', 'payment_intent.succeeded', 'pi_chk_1', 38000, o.code)
        const forged = body.replace('38000', '1') // เนื้อหาถูกแก้หลังลงนาม
        const cases = {
          forgedBody: await post(s.url, forged, { 'stripe-signature': signStripe(body, WH) }),
          wrongSecret: await post(s.url, body, { 'stripe-signature': signStripe(body, 'whsec_other') }),
          stale: await post(s.url, body, { 'stripe-signature': signStripe(body, WH, Math.floor(Date.now() / 1000) - 3600) }),
          noHeader: await post(s.url, body),
          garbage: await post(s.url, '<<<ไม่ใช่ json>>>', { 'stripe-signature': 't=1,v1=00' }),
          v0only: await post(s.url, body, { 'stripe-signature': signStripe(body, WH).replace('v1=', 'v0=') }),
        }
        const untouched = status(o.code) === 'pending' && Number(scalar("select count(*) from stripe_events where id='evt_chk_1'")) === 0
        const bad = Object.entries(cases).filter(([, r]) => r.status !== 400).map(([k, r]) => `${k}→${r.status}`)
        const good = await post(s.url, body, { 'stripe-signature': signStripe(body, WH) })
        return { ok: !bad.length && untouched && good.status === 200 && status(o.code) === 'paid' && status(o2.code) === 'pending',
          hint: `ต้อง 400 แต่ได้: ${bad.join(', ') || '-'} · ออเดอร์ไม่ถูกแตะตอนลายเซ็นผิด=${untouched} · ลงนามถูก→${good.status} สถานะ ${status(o.code)} (ต้อง 200/paid) · ออเดอร์อื่น ${status(o2.code)}` }
      } finally { s?.stop(); restock(s0); sql(`delete from stripe_events where id like 'evt_chk_%'`); purge(u.id); await delUser(u.id) }
    },
  },
  {
    part: 'break', name: 'payment_webhook: event ซ้ำ (id เดิม) → 200 duplicate ไม่ทำซ้ำ · ยอดไม่ตรง → 400 ออเดอร์ไม่เปลี่ยน · payment_failed → ออเดอร์ยัง pending · event อื่น → 200',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap()
      if (files('payment_webhook').length < 2) return { ok: false, hint: 'ยังไม่มี payment_webhook' }
      const u = await newUser('wh2'); let s
      try {
        s = await serve('payment_webhook', { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WH })
        const a = await mkOrder(u), b = await mkOrder(u, 2), c = await mkOrder(u)
        const send = (id, type, pi, amt, code) => { const body = evtBody(id, type, pi, amt, code); return post(s.url, body, { 'stripe-signature': signStripe(body, WH) }) }
        const first = await send('evt_chk_a', 'payment_intent.succeeded', 'pi_a', 38000, a.code)
        sql(`update shop_orders set status='pending' where code='${a.code}'`) // ถ้า event ซ้ำทำงานซ้ำ ออเดอร์จะกลับไป paid
        const dup = await send('evt_chk_a', 'payment_intent.succeeded', 'pi_a', 38000, a.code)
        const mism = await send('evt_chk_b', 'payment_intent.succeeded', 'pi_b', 38000, b.code) // ออเดอร์ b = 760 บาท
        const failed = await send('evt_chk_c', 'payment_intent.payment_failed', 'pi_c', 38000, c.code)
        const other = await send('evt_chk_d', 'charge.refunded', 'pi_d', 38000, c.code)
        const ok = first.status === 200 && dup.status === 200 && /duplicate/.test(dup.text) && status(a.code) === 'pending' && mism.status === 400 && /amount_mismatch/.test(mism.text) && status(b.code) === 'pending' && failed.status === 200 && status(c.code) === 'pending' && other.status === 200
        return { ok, hint: `ครั้งแรก ${first.status} · ซ้ำ ${dup.status} ${dup.text.slice(0, 60)} สถานะหลังซ้ำ ${status(a.code)} (ต้อง pending = ไม่ทำซ้ำ) · ยอดไม่ตรง ${mism.status} ${mism.text.slice(0, 60)} สถานะ ${status(b.code)} · failed ${failed.status} สถานะ ${status(c.code)} · event อื่น ${other.status}` }
      } finally { s?.stop(); restock(s0); sql(`delete from stripe_events where id like 'evt_chk_%'`); purge(u.id); await delUser(u.id) }
    },
  },
  {
    part: 'break', name: 'ครบวงจรกับ Stripe จำลอง: create_payment → จ่าย (fake ยิง webhook ลงนามให้) → ออเดอร์ paid · payments.status = succeeded',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap()
      if (files('payment_webhook').length < 2 || files('create_payment').length < 2) return { ok: false, hint: 'ต้องมีทั้ง create_payment และ payment_webhook' }
      const fake = await startFakeStripe({ webhookSecret: WH }); const u = await newUser('e2e'); const sv = []
      try {
        const e = { STRIPE_API_BASE: fake.url, STRIPE_SECRET_KEY: fake.secretKey, STRIPE_WEBHOOK_SECRET: WH }
        const cp = await serve('create_payment', e), wh = await serve('payment_webhook', e); sv.push(cp, wh)
        const o = await mkOrder(u, 2)
        const p = await post(cp.url, { order_code: o.code }, { authorization: `Bearer ${u.token}` })
        const fired = await (await fetch(`${fake.url}/__fire`, { method: 'POST', body: JSON.stringify({ payment_intent: p.json?.payment_intent_id, type: 'payment_intent.succeeded', url: wh.url }) })).json()
        const pay = rows(`select p.status,p.amount from payments p join shop_orders o on o.id=p.order_id where o.code='${o.code}'`)?.[0]
        return { ok: p.status === 200 && fired.delivered_status === 200 && status(o.code) === 'paid' && pay?.[0] === 'succeeded' && pay?.[1] === '760', hint: `create_payment ${p.status} · webhook ${fired.delivered_status} ${fired.delivered_body?.slice(0, 80)} · สถานะ ${status(o.code)} · payments ${JSON.stringify(pay)}` }
      } finally { sv.forEach((x) => x.stop()); await fake.close(); restock(s0); sql(`delete from stripe_events where id like 'evt_fake_%'`); purge(u.id); await delUser(u.id) }
    },
  },
  // ---- ต่อยอด: สลิป ----
  {
    part: 'extra', name: 'ทางสำรองสลิป: ลูกค้าส่งสลิปของตัวเอง (คนอื่นส่งแทนไม่ได้) · ลูกค้าอนุมัติเองไม่ได้ · พนักงานอนุมัติ → paid · ปฏิเสธ → ยัง pending พร้อมเหตุผล',
    run: async () => {
      const n = need(); if (n) return n
      const s0 = snap()
      const u = await newUser('slip'), v = await newUser('slip2'), st = await newUser('staff', { appMetadata: { role: 'staff' } })
      try {
        const o = await mkOrder(u), o2 = await mkOrder(u)
        const mine = await rpc('submit_slip', { p_code: o.code, p_path: 'slips/a.jpg' }, u.token)
        const theirs = await rpc('submit_slip', { p_code: o.code, p_path: 'slips/b.jpg' }, v.token)
        const slip = scalar(`select id from payment_slips where order_id=(select id from shop_orders where code='${o.code}') order by created_at limit 1`)
        const selfApprove = await rpc('review_slip', { p_slip: slip, p_approve: true }, u.token)
        const stillPending = status(o.code) === 'pending'
        const approve = await rpc('review_slip', { p_slip: slip, p_approve: true }, st.token)
        const paid = status(o.code) === 'paid'
        await rpc('submit_slip', { p_code: o2.code, p_path: 'slips/c.jpg' }, u.token)
        const slip2 = scalar(`select id from payment_slips where order_id=(select id from shop_orders where code='${o2.code}') limit 1`)
        const rej = await rpc('review_slip', { p_slip: slip2, p_approve: false, p_reason: 'ยอดไม่ตรง' }, st.token)
        const r2 = rows(`select status,reason from payment_slips where id='${slip2}'`)?.[0]
        return { ok: mine.ok && !theirs.ok && /not_found/.test(theirs.text) && !selfApprove.ok && /forbidden/.test(selfApprove.text) && stillPending && approve.ok && paid && rej.ok && status(o2.code) === 'pending' && r2?.[0] === 'rejected' && r2?.[1] === 'ยอดไม่ตรง',
          hint: `ส่งสลิปของตัวเอง=${mine.ok} · คนอื่นส่งแทน=${theirs.ok} (${theirs.text.slice(0, 50)}) · ลูกค้าอนุมัติเอง=${selfApprove.ok} · พนักงานอนุมัติ→${status(o.code)} · ปฏิเสธ→${r2?.join('/')}` }
      } finally { restock(s0); for (const x of [u, v, st]) { purge(x.id); await delUser(x.id) } }
    },
  },
  {
    part: 'extra', name: 'มี test ของฟังก์ชัน (supabase/functions/*/handler.test.ts) และ npm test ผ่าน · ไม่มี key/secret พิมพ์ในโค้ด',
    run: () => {
      const tests = walk('supabase/functions').filter((p) => /\.test\.ts$/.test(p))
      const code = walk('supabase/functions').filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p)).map(read).join('\n')
      const hard = code.match(/sk_(test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/g)
      const t = run('npm', ['test', '--silent'])
      return { ok: tests.length >= 2 && t.ok && !hard, hint: `ไฟล์ test ${tests.length} (ต้อง ≥ 2) · npm test=${t.ok} · key ที่พิมพ์ในโค้ด: ${hard?.join(', ') ?? '-'}` }
    },
  },
  {
    part: 'later', name: '[ตรวจหลังสมัคร Stripe] สร้าง PaymentIntent จริงในโหมดทดสอบ · แสดง QR ด้วย Stripe.js (confirmPromptPayPayment) · กด Simulate scan · webhook ผ่าน stripe listen / endpoint จริง',
    run: () => ({ ok: false, skip: true, hint: 'ทำหลังสมัคร Stripe (โหมดทดสอบ): ใส่ STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET ใน .env แล้วลบ STRIPE_API_BASE' }),
  },
]
