import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, earnPoints, balanceOf, redeemPoints, pointsFor, isDoublePointsDay } from './index.ts'

const WED = new Date('2026-10-21T05:00:00Z') // พุธ ไม่คูณ 2
const SAT_NOON = new Date('2026-10-24T05:00:00Z') // เสาร์ 12:00 เวลาไทย
const SAT_0030_TH = new Date('2026-10-23T17:30:00Z') // เสาร์ 00:30 เวลาไทย (ยังเป็นศุกร์ตาม UTC)
const SUN_0030_TH = new Date('2026-10-24T17:30:00Z') // อาทิตย์ 00:30 เวลาไทย (ยังเป็นเสาร์ตาม UTC)

function storeWith(customerId: string, points: number) {
  const s = makeStore()
  earnPoints(s, customerId, points * 25, WED)
  assert.equal(balanceOf(s, customerId), points) // เตรียมข้อมูลให้ถูกก่อน
  return s
}

// กฎ 1: ทุก 25 บาท ได้ 1 แต้ม ปัดเศษลง
test('กฎ 1: 24 บาท = 0 แต้ม', () => {
  assert.equal(pointsFor(24, WED), 0)
})
test('กฎ 1: 25 บาท = 1 แต้ม', () => {
  assert.equal(pointsFor(25, WED), 1)
})
test('กฎ 1: 38 บาท = 1 แต้ม (ปัดลง)', () => {
  assert.equal(pointsFor(38, WED), 1)
})
test('กฎ 1: 49 บาท = 1 แต้ม (ปัดลง)', () => {
  assert.equal(pointsFor(49, WED), 1)
})
test('กฎ 1: 50 บาท = 2 แต้ม', () => {
  assert.equal(pointsFor(50, WED), 2)
})
test('กฎ 1: earnPoints คืนและบันทึกแต้มที่ปัดลงแล้ว', () => {
  const s = makeStore()
  assert.equal(earnPoints(s, 'c1', 38, WED), 1)
  assert.equal(balanceOf(s, 'c1'), 1)
})

// กฎ 2: เสาร์ตามเวลาไทย คูณ 2
test('กฎ 2: เสาร์เที่ยงวันเวลาไทย คูณ 2', () => {
  assert.equal(pointsFor(50, SAT_NOON), 4)
})
test('กฎ 2: เสาร์ 00:30 เวลาไทย (ศุกร์ตาม UTC) ต้องคูณ 2', () => {
  assert.equal(isDoublePointsDay(SAT_0030_TH), true)
  assert.equal(pointsFor(50, SAT_0030_TH), 4)
})
test('กฎ 2: อาทิตย์ 00:30 เวลาไทย (เสาร์ตาม UTC) ต้องไม่คูณ 2', () => {
  assert.equal(isDoublePointsDay(SUN_0030_TH), false)
  assert.equal(pointsFor(50, SUN_0030_TH), 2)
})
test('กฎ 2: วันพุธไม่คูณ 2', () => {
  assert.equal(pointsFor(50, WED), 2)
})

// กฎ 3: 1 แต้ม = 1 บาท จำนวนเต็ม >= 1 ไม่เกินยอดคงเหลือ ถูกปฏิเสธแล้วยอดไม่เปลี่ยน
test('กฎ 3: แลกได้ปกติ หักแต้มและให้ส่วนลด 1 แต้ม = 1 บาท', () => {
  const s = storeWith('c1', 10)
  const r = redeemPoints(s, { customerId: 'c1' }, { points: 4 })
  assert.deepEqual(r, { ok: true, balance: 6, discountBaht: 4 })
  assert.equal(balanceOf(s, 'c1'), 6)
})
test('กฎ 3: แลกเกินยอดคงเหลือต้องถูกปฏิเสธ แม้เคยได้แต้มสะสมมากกว่านั้น', () => {
  const s = storeWith('c1', 10)
  assert.equal(redeemPoints(s, { customerId: 'c1' }, { points: 8 }).ok, true) // เหลือ 2
  const r = redeemPoints(s, { customerId: 'c1' }, { points: 5 }) // เคยได้ 10 แต่เหลือ 2
  assert.equal(r.ok, false)
  assert.equal(balanceOf(s, 'c1'), 2)
})
test('กฎ 3: แต้มติดลบต้องถูกปฏิเสธ และยอดไม่เพิ่ม', () => {
  const s = storeWith('c1', 10)
  const r = redeemPoints(s, { customerId: 'c1' }, { points: -5 })
  assert.equal(r.ok, false)
  assert.equal(balanceOf(s, 'c1'), 10)
})
test('กฎ 3: 0 แต้มต้องถูกปฏิเสธ', () => {
  const s = storeWith('c1', 10)
  assert.equal(redeemPoints(s, { customerId: 'c1' }, { points: 0 }).ok, false)
  assert.equal(balanceOf(s, 'c1'), 10)
})
test('กฎ 3: เศษทศนิยมต้องถูกปฏิเสธ', () => {
  const s = storeWith('c1', 10)
  const r = redeemPoints(s, { customerId: 'c1' }, { points: 1.5 })
  assert.equal(r.ok, false)
  assert.equal(balanceOf(s, 'c1'), 10)
})
test('กฎ 3: NaN ต้องถูกปฏิเสธ', () => {
  const s = storeWith('c1', 10)
  const r = redeemPoints(s, { customerId: 'c1' }, { points: Number.NaN })
  assert.equal(r.ok, false)
  assert.equal(balanceOf(s, 'c1'), 10)
})

// กฎ 4: ใช้ได้เฉพาะแต้มของคนที่ล็อกอิน
test('กฎ 4: ส่ง customerId ของคนอื่นมา ต้องปฏิเสธ และแต้มของเขาไม่เปลี่ยน', () => {
  const s = storeWith('victim', 10)
  const r = redeemPoints(s, { customerId: 'attacker' }, { customerId: 'victim', points: 5 })
  assert.equal(r.ok, false)
  assert.equal(balanceOf(s, 'victim'), 10)
  assert.equal(balanceOf(s, 'attacker'), 0)
})
test('กฎ 4: ส่ง customerId ตรงกับ session ยังแลกได้', () => {
  const s = storeWith('c1', 10)
  const r = redeemPoints(s, { customerId: 'c1' }, { customerId: 'c1', points: 3 })
  assert.equal(r.ok, true)
  assert.equal(balanceOf(s, 'c1'), 7)
})
