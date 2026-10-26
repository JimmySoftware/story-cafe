import { exists, read, run, walk } from './lib.mjs'
import { rows, scalar, sql, dbUp, csv } from './db.mjs'
import { api, rpc, newUser, delUser } from './api.mjs'
import { readdirSync } from 'node:fs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const migFiles = () => (exists('supabase/migrations') ? readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')) : [])
const SHIP = { name: 'ผู้ทดสอบ', phone: '0900000012', address: 'ซอยสมมติ 9 (ที่อยู่สมมติ)' }
const prime = () => { setStock('beans-250', 20); setStock('drip-5', 30) } // ค่าเริ่มต้นตาม data/products.csv (ตัวตรวจไม่พึ่งสต็อกที่เหลือจาก test ของผู้เรียน)
const stock = (sku) => Number(scalar(`select stock from products where sku='${sku}'`))
const setStock = (sku, n) => sql(`update products set stock=${n} where sku='${sku}'`)
const errText = (r) => JSON.stringify(r.body)
const cleanup = (ids) => { for (const id of ids) { sql(`delete from shop_orders where user_id='${id}'`); delUser(id) } }

export const checks = [
  {
    part: 'win', name: 'ตาราง products / shop_orders / shop_order_items ตามชื่อใน brief เป็น migration ใหม่ · products มาจาก data/products.csv · key products ถูกย้ายออกจาก settings',
    run: () => {
      if (migFiles().length < 4) return { ok: false, hint: 'ต้องมี migration ใหม่เพิ่มจากบท 10 และ 11' }
      const n = need(); if (n) return n
      const want = { products: ['id', 'sku', 'name', 'price', 'stock', 'active', 'sort'], shop_orders: ['id', 'code', 'user_id', 'status', 'total', 'ship_name', 'ship_phone', 'ship_address', 'created_at'], shop_order_items: ['id', 'order_id', 'product_id', 'qty', 'unit_price'] }
      const miss = []
      for (const [t, cols] of Object.entries(want)) {
        const have = (rows(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}'`) ?? []).map((r) => r[0])
        const m = cols.filter((c) => !have.includes(c)); if (m.length) miss.push(`${t}: ${have.length ? 'ขาด ' + m.join(', ') : 'ไม่มีตาราง'}`)
      }
      if (miss.length) return { ok: false, hint: miss.join(' · ') }
      const w = csv('data/products.csv').map((r) => [r.sku, r.name, r.price].join('|')).sort()
      const g = (rows('select sku,name,price from products') ?? []).map((r) => r.join('|')).sort()
      const left = scalar("select count(*) from settings where key='products'")
      return { ok: JSON.stringify(w) === JSON.stringify(g) && left === '0', hint: `products ในฐานข้อมูล ${g.length} แถว (ไฟล์ ${w.length}) ตรงกัน=${JSON.stringify(w) === JSON.stringify(g)} · key products ใน settings เหลือ ${left}` }
    },
  },
  {
    part: 'win', name: 'สั่งซื้อ: ล็อกอินแล้ว create_order เมล็ดกาแฟ 2 ถุง = 760 บาท ได้เลข SH-… สต็อกลด 2 · ราคาที่ฝั่งลูกค้าส่งมาไม่มีผล',
    run: async () => {
      const n = need(); if (n) return n
      const u = await newUser('buy'); prime(); const before = stock('beans-250')
      try {
        const r = await rpc('create_order', { p_items: [{ sku: 'beans-250', qty: 2, price: 1 }, { sku: 'drip-5', qty: 1, unit_price: 1 }], p_ship: SHIP }, u.token)
        const after = stock('beans-250')
        const items = rows(`select p.sku,i.qty,i.unit_price from shop_order_items i join products p on p.id=i.product_id join shop_orders o on o.id=i.order_id where o.user_id='${u.id}' order by p.sku`) ?? []
        return { ok: r.ok && /^SH-/.test(r.body?.code ?? '') && r.body.total === 2 * 380 + 175 && before - after === 2 && JSON.stringify(items) === JSON.stringify([['beans-250', '2', '380'], ['drip-5', '1', '175']]),
          hint: `สถานะ ${r.status} ${errText(r).slice(0, 160)} · สต็อกลด ${before - after} (ต้อง 2) · รายการ ${JSON.stringify(items)}` }
      } finally { setStock('beans-250', before); cleanup([u.id]) }
    },
  },
  {
    part: 'win', name: 'กติกา: ไม่ล็อกอิน → not_authenticated · ว่าง/qty ผิด/sku ผิด/ที่อยู่ขาด → error ตามรหัส · ของไม่พอ → out_of_stock และ "ทั้งออเดอร์ล้ม" (สต็อกชิ้นแรกไม่ถูกตัด)',
    run: async () => {
      const n = need(); if (n) return n
      const u = await newUser('rules'); prime(); const b0 = stock('beans-250'), d0 = stock('drip-5')
      try {
        const t = (items, ship = SHIP, token = u.token) => rpc('create_order', { p_items: items, p_ship: ship }, token)
        const anon = await t([{ sku: 'beans-250', qty: 1 }], SHIP, null)
        setStock('drip-5', 1)
        const cases = {
          not_authenticated: anon, empty_order: await t([]), bad_qty: await t([{ sku: 'beans-250', qty: 0 }]), bad_qty2: await t([{ sku: 'beans-250', qty: 11 }]),
          bad_product: await t([{ sku: 'nope', qty: 1 }]), bad_ship: await t([{ sku: 'beans-250', qty: 1 }], { name: 'x' }), out_of_stock: await t([{ sku: 'beans-250', qty: 1 }, { sku: 'drip-5', qty: 2 }]),
        }
        const bad = Object.entries(cases).filter(([k, r]) => r.ok || !new RegExp(k === 'not_authenticated' ? 'not_authenticated|permission denied|42501|JWT|401' : k.replace(/2$/, '')).test(errText(r))).map(([k]) => k)
        const rolled = stock('beans-250') === b0
        return { ok: !bad.length && rolled && /drip-5/.test(errText(cases.out_of_stock)), hint: `error ที่ไม่ตรงรหัส: ${bad.join(', ') || '-'} · ออเดอร์ที่ล้มไม่ตัดสต็อกชิ้นแรก=${rolled} · out_of_stock บอก sku=${/drip-5/.test(errText(cases.out_of_stock))}` }
      } finally { setStock('beans-250', b0); setStock('drip-5', d0); cleanup([u.id]) }
    },
  },
  {
    part: 'win', name: 'RLS: ลูกค้า B เห็นออเดอร์ของ A ไม่ได้ · anon อ่านออเดอร์ไม่ได้ · ลูกค้าแก้สต็อก/ราคาตรง ๆ ไม่ได้ · เห็นสินค้า (active) ได้',
    run: async () => {
      const n = need(); if (n) return n
      const a = await newUser('rlsA'), b = await newUser('rlsB'); prime(); const b0 = stock('beans-250')
      try {
        await rpc('create_order', { p_items: [{ sku: 'beans-250', qty: 1 }], p_ship: SHIP }, a.token)
        const mine = await api('/rest/v1/shop_orders?select=code', { token: a.token })
        const theirs = await api('/rest/v1/shop_orders?select=code', { token: b.token })
        const items = await api('/rest/v1/shop_order_items?select=id', { token: b.token })
        const anon = await api('/rest/v1/shop_orders?select=code')
        const patch = await api('/rest/v1/products?sku=eq.beans-250', { token: b.token, method: 'PATCH', body: { stock: 999, price: 1 }, headers: { prefer: 'return=representation' } })
        const prod = await api('/rest/v1/products?select=sku')
        const ok = Array.isArray(mine.body) && mine.body.length === 1 && Array.isArray(theirs.body) && theirs.body.length === 0 && (!Array.isArray(items.body) || items.body.length === 0)
          && (!Array.isArray(anon.body) || anon.body.length === 0) && !(Array.isArray(patch.body) && patch.body.length) && stock('beans-250') === b0 - 1 && Array.isArray(prod.body) && prod.body.length === 2
        return { ok, hint: `A เห็นของตัวเอง ${mine.body?.length} (ต้อง 1) · B เห็นของ A ${theirs.body?.length} (ต้อง 0) · order_items ที่ B เห็น ${items.body?.length ?? 'ปฏิเสธ'} · anon เห็นออเดอร์ ${Array.isArray(anon.body) ? anon.body.length : 'ปฏิเสธ'} · แก้สต็อกตรงได้=${Array.isArray(patch.body) && patch.body.length > 0} · สินค้าที่ anon เห็น ${prod.body?.length}` }
      } finally { setStock('beans-250', b0); cleanup([a.id, b.id]) }
    },
  },
  {
    part: 'win', name: 'มี test SQL เรื่องสต็อก/สั่งซื้อใน supabase/tests/ และ npm run test:db ผ่าน',
    run: () => {
      const files = exists('supabase/tests') ? readdirSync('supabase/tests').filter((f) => f.endsWith('.sql')) : []
      if (!files.some((f) => /create_order/.test(read('supabase/tests/' + f)))) return { ok: false, hint: 'ยังไม่มี test SQL ที่เรียก create_order' }
      const n = need(); if (n) return n
      const r = run('npm', ['run', 'test:db', '--silent'])
      return { ok: r.ok, hint: r.out.trim().split('\n').slice(-4).join(' | ') }
    },
  },
  // ---- ลองพัง: ของชิ้นสุดท้าย ----
  {
    part: 'break', name: 'สั่งพร้อมกัน 8 คนของชิ้นสุดท้าย (สต็อก 1) → สำเร็จคนเดียว · สต็อกเป็น 0 ไม่ติดลบ · ออเดอร์ที่สำเร็จมี 1',
    run: async () => {
      const n = need(); if (n) return n
      const us = await Promise.all(Array.from({ length: 8 }, (_, i) => newUser('race' + i))); prime(); const d0 = stock('drip-5')
      try {
        setStock('drip-5', 1)
        const rs = await Promise.all(us.map((u) => rpc('create_order', { p_items: [{ sku: 'drip-5', qty: 1 }], p_ship: SHIP }, u.token)))
        const okN = rs.filter((r) => r.ok).length, oos = rs.filter((r) => /out_of_stock/.test(errText(r))).length
        const orders = Number(scalar(`select count(*) from shop_orders where user_id in (${us.map((u) => `'${u.id}'`).join(',')})`))
        return { ok: okN === 1 && oos === 7 && stock('drip-5') === 0 && orders === 1, hint: `สำเร็จ ${okN} (ต้อง 1) · out_of_stock ${oos} (ต้อง 7) · สต็อก ${stock('drip-5')} (ต้อง 0) · ออเดอร์ที่ถูกสร้าง ${orders} (ต้อง 1)` }
      } finally { setStock('drip-5', d0); cleanup(us.map((u) => u.id)) }
    },
  },
  {
    part: 'break', name: 'มี test ที่พิสูจน์การสั่งพร้อมกันของสินค้าชิ้นสุดท้าย',
    run: () => {
      const files = [...(exists('supabase/tests') ? walk('supabase/tests') : []), ...walk('tools', ['node_modules', 'check'])].filter((p) => /\.(sql|ts|mjs|sh)$/.test(p))
      return { ok: files.some((p) => /concurren|พร้อมกัน|race|advisory|pg_sleep|dblink/i.test(read(p)) && /create_order|stock/.test(read(p))), hint: 'ยังไม่มีไฟล์ test ที่ทดสอบการสั่งสินค้าชิ้นสุดท้ายพร้อมกัน' }
    },
  },
  // ---- ต่อยอด: หน้าเว็บ ----
  {
    part: 'extra', name: 'หน้าเว็บร้านค้า (#/shop): สมัคร/ล็อกอิน (supabase.auth) + ตะกร้า + create_order + ออเดอร์ของฉัน และ web build ผ่าน',
    run: () => {
      const src = walk('web/src').filter((p) => /\.(tsx?|css)$/.test(p)).map(read).join('\n')
      const miss = []
      if (!/create_order/.test(src)) miss.push('create_order')
      if (!/signUp|signInWithPassword/.test(src)) miss.push('สมัคร/ล็อกอิน')
      if (!/shop_orders/.test(src)) miss.push('ออเดอร์ของฉัน (shop_orders)')
      if (!/#\/shop|\/shop/.test(src)) miss.push('หน้า #/shop')
      if (miss.length) return { ok: false, hint: `หน้าเว็บยังขาด: ${miss.join(', ')}` }
      const b = run('npm', ['run', 'build', '--silent'], { cwd: process.cwd() + '/web' })
      return { ok: b.ok, hint: `web build ไม่ผ่าน: ${b.out.trim().split('\n').slice(-3).join(' | ')}` }
    },
  },
]
