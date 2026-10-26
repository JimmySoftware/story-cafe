// node tools/rls-probe.mjs — ลองเป็นลูกค้า A สั่งกาแฟ แล้วลองเป็นลูกค้า B ส่องดูออเดอร์ของ A
// exit 0 = ปลอดภัย · exit 1 = รั่ว · ใช้กับ Supabase ในเครื่องเท่านั้น (ต้องมี SUPABASE_SECRET_KEY เพื่อลบข้อมูลทดสอบ)
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_PUBLISHABLE_KEY, SECRET = process.env.SUPABASE_SECRET_KEY
if (!URL_ || !KEY) { console.log('ตั้ง SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY ก่อน (npx supabase status -o env)'); process.exit(2) }
const H = (k) => ({ apikey: k, authorization: `Bearer ${k}`, 'content-type': 'application/json' })
const call = async (path, k, body, method = body ? 'POST' : 'GET') => {
  const r = await fetch(`${URL_}${path}`, { method, headers: H(k), body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}
const phoneA = '0900000555'
const tomorrow = new Date(Date.now() + 7 * 3600e3 + 86400e3).toISOString().slice(0, 10) // วันที่พรุ่งนี้ตามเวลาไทย
let leak = false
const say = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) leak = true }
try {
  const menu = await call('/rest/v1/menu_items?select=id&name=eq.ลาเต้', KEY)
  const placed = await call('/rest/v1/rpc/place_preorder', KEY, { p_name: 'ลูกค้า A', p_phone: phoneA, p_pickup: `${tomorrow}T16:30:00+07:00`, p_items: [{ menu_item_id: menu.body[0].id, qty: 1, options: [] }] })
  if (placed.status !== 200) { console.log('สั่งในฐานะ A ไม่ได้ (ข้อนี้ต้องใช้ได้):', JSON.stringify(placed.body).slice(0, 200)); process.exit(2) }
  const code = placed.body.code; globalThis.__code = code
  // ลูกค้า B ส่องตารางตรง ๆ
  for (const t of ['orders', 'order_items', 'pickup_slots']) {
    const r = await call(`/rest/v1/${t}?select=*&limit=5`, KEY)
    const n = Array.isArray(r.body) ? r.body.length : 0
    say(n === 0, `B อ่านตาราง ${t} ตรง ๆ → เห็น ${n} แถว (ต้อง 0)`)
  }
  const byPhone = await call(`/rest/v1/orders?select=code&phone=eq.${phoneA}`, KEY)
  say(!(Array.isArray(byPhone.body) && byPhone.body.length), 'B ค้นออเดอร์ของ A ด้วยเบอร์ผ่าน API → ไม่เห็น')
  // lookup_order
  const good = await call('/rest/v1/rpc/lookup_order', KEY, { p_code: code, p_phone: phoneA })
  say(good.status === 200 && good.body?.code === code, 'A ดูออเดอร์ของตัวเองด้วยรหัส + เบอร์ → เห็น')
  const wrong = await call('/rest/v1/rpc/lookup_order', KEY, { p_code: code, p_phone: '0999999999' })
  say(wrong.status !== 200 && /not_found/.test(JSON.stringify(wrong.body)), 'B ใช้รหัสของ A แต่เบอร์ตัวเอง → not_found')
  const none = await call('/rest/v1/rpc/lookup_order', KEY, { p_code: 'SC-0000000', p_phone: phoneA })
  say(none.status !== 200 && JSON.stringify(none.body) === JSON.stringify(wrong.body), 'รหัสที่ไม่มีอยู่ตอบเหมือนเบอร์ผิดทุกตัวอักษร (ไม่บอกใบ้)')
  const w = await call('/rest/v1/orders?code=eq.' + code, KEY, { status: 'cancelled' }, 'PATCH')
  say(!(Array.isArray(w.body) && w.body.length), 'B แก้สถานะออเดอร์ของ A ตรง ๆ ไม่ได้')
} finally {
  await call('/rest/v1/rpc/cancel_preorder', KEY, { p_code: globalThis.__code ?? '', p_phone: phoneA }) // คืนแก้วให้ช่อง
  if (SECRET) await call(`/rest/v1/orders?phone=eq.${phoneA}`, SECRET, undefined, 'DELETE')
}
console.log(leak ? '\nรั่ว: ลูกค้าเห็น/แก้ข้อมูลของคนอื่นได้ — ปิดที่ฐานข้อมูล (RLS) แล้วรันใหม่' : '\nปลอดภัย: ลูกค้าเห็นได้เฉพาะออเดอร์ที่รู้รหัส + เบอร์')
process.exit(leak ? 1 : 0)
