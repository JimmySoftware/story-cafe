// loyalty-probe.mjs — ตัวตรวจบทที่ 14: ลองโค้ดบัตรสะสมแต้มกับกฎใน briefs/loyalty.md ทีละบั๊ก (รันด้วย node --import tsx)
// พิมพ์ JSON { A: ok, B: ok, C: ok, D: ok, details: {...} } · ใช้โค้ดที่ tools/loyalty/index.ts หรือ argv[2] (โฟลเดอร์อื่น)
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const dir = process.argv[2] ?? 'tools/loyalty'
const L = await import(pathToFileURL(resolve(dir, 'index.ts')).href)
const out = { A: false, B: false, C: false, D: false, details: {} }
const t = (f) => { try { return f() } catch (e) { return `ERR ${e.message}` } }

// A ปัดเศษ: 38 บาท = 1 แต้ม (ปัดลง) · 49 บาท = 1 แต้ม · 50 บาท = 2 แต้ม
out.details.A = t(() => { const s = L.makeStore(), wed = new Date('2026-10-21T05:00:00Z'); return [L.earnPoints(s, 'x', 38, wed), L.earnPoints(s, 'x', 49, wed), L.earnPoints(s, 'x', 50, wed), L.earnPoints(s, 'x', 24, wed)] })
out.A = JSON.stringify(out.details.A) === '[1,1,2,0]'
// B เขตเวลา: เสาร์ 00:30 เวลาไทย (ศุกร์ 17:30Z) ต้องคูณ 2 · อาทิตย์ 00:30 เวลาไทย (เสาร์ 17:30Z) ห้ามคูณ · ศุกร์ 23:59 เวลาไทย ห้ามคูณ · เสาร์ 23:59 เวลาไทย (เสาร์ 16:59Z) คูณ 2
out.details.B = t(() => { const s = L.makeStore(); return [['2026-10-23T17:30:00Z'], ['2026-10-24T17:30:00Z'], ['2026-10-23T16:59:00Z'], ['2026-10-24T16:59:00Z']].map(([d]) => L.earnPoints(s, 'y', 50, new Date(d))) })
out.B = JSON.stringify(out.details.B) === '[4,2,2,4]'
// C ติดลบ: หลังใช้ไปแล้ว ใช้เกินยอดคงเหลือไม่ได้ · ค่าติดลบ/ทศนิยม/0 ไม่ได้ · ยอดไม่เปลี่ยนเมื่อถูกปฏิเสธ
out.details.C = t(() => {
  const s = L.makeStore(), wed = new Date('2026-10-21T05:00:00Z'); L.earnPoints(s, 'z', 100, wed) // 4 แต้ม
  const sess = { customerId: 'z' }
  const r1 = L.redeemPoints(s, sess, { points: 3 }), r2 = L.redeemPoints(s, sess, { points: 3 }), r3 = L.redeemPoints(s, sess, { points: -5 }), r4 = L.redeemPoints(s, sess, { points: 1.5 }), r5 = L.redeemPoints(s, sess, { points: 0 })
  return { r1: r1.ok, r2: r2.ok, r3: r3.ok, r4: r4.ok, r5: r5.ok, balance: L.balanceOf(s, 'z') }
})
out.C = JSON.stringify(out.details.C) === JSON.stringify({ r1: true, r2: false, r3: false, r4: false, r5: false, balance: 1 })
// D แต้มคนอื่น: ส่ง customerId ของคนอื่นมาใน request ต้องถูกปฏิเสธ · ส่ง id ตัวเองยังใช้ได้ · แต้มของเหยื่อไม่เปลี่ยน
out.details.D = t(() => {
  const s = L.makeStore(), wed = new Date('2026-10-21T05:00:00Z'); L.earnPoints(s, 'victim', 100, wed); L.earnPoints(s, 'mallory', 25, wed)
  const atk = L.redeemPoints(s, { customerId: 'mallory' }, { customerId: 'victim', points: 2 })
  const own = L.redeemPoints(s, { customerId: 'mallory' }, { customerId: 'mallory', points: 1 })
  return { attack: atk.ok, own: own.ok, victim: L.balanceOf(s, 'victim'), mallory: L.balanceOf(s, 'mallory') }
})
out.D = JSON.stringify(out.details.D) === JSON.stringify({ attack: false, own: true, victim: 4, mallory: 0 })
console.log(JSON.stringify(out))
