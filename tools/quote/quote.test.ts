import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCatalog, parseShop } from './catalog.ts'
import { computeQuote } from './pricing.ts'
import type { Order } from './types.ts'

const catalog = loadCatalog()
const order = (lines: Order['lines'], delivery = true): Order => ({ customer: 'ทดสอบ', date: '2026-11-02', delivery, lines })

test('ออฟฟิศ: ลาเต้ 20 + ครัวซองต์ 20 = 2,880 ไม่มีส่วนลด ส่งฟรี', () => {
  const q = computeQuote(order([{ item: 'ลาเต้', qty: 20 }, { item: 'ครัวซองต์เนย', qty: 20 }]), catalog)
  assert.equal(q.subtotal, 2880)
  assert.equal(q.discountPercent, 0)
  assert.equal(q.delivery, 0)
  assert.equal(q.total, 2880)
})

test('เครื่องดื่ม 30 แก้วขึ้นไป ลด 10% เฉพาะเครื่องดื่ม', () => {
  const q = computeQuote(order([{ item: 'คาปูชิโน่', qty: 30 }, { item: 'บราวนี่ช็อกโกแลต', qty: 10 }]), catalog)
  assert.equal(q.subtotal, 3040)
  assert.equal(q.discountPercent, 10)
  assert.equal(q.discount, 225)
  assert.equal(q.total, 2815)
})

test('เครื่องดื่ม 50 แก้วขึ้นไป ลด 15% ปัดเศษส่วนลดขึ้นเป็นบาทเต็ม', () => {
  const q = computeQuote(order([{ item: 'ลาเต้', qty: 50 }]), catalog)
  assert.equal(q.discountPercent, 15)
  assert.equal(q.discount, 563) // 3750 × 15% = 562.5 → 563
  assert.equal(q.total, 3187)
})

test('ยอดหลังลดต่ำกว่า 1,500 ส่งแล้วคิดค่าส่ง 100 บาท · รับที่ร้านไม่คิด', () => {
  const small = [{ item: 'อเมริกาโน่', qty: 12 }]
  assert.equal(computeQuote(order(small), catalog).delivery, 100)
  assert.equal(computeQuote(order(small), catalog).total, 880)
  assert.equal(computeQuote(order(small, false), catalog).delivery, 0)
})

test('ชื่อรายการที่ไม่มีในเมนูต้องหยุดและบอกชื่อ', () => {
  assert.throws(() => computeQuote(order([{ item: 'ชานมไข่มุก', qty: 3 }]), catalog), /ชานมไข่มุก/)
})

const sampleSettings = [
  { key: 'shop_name', value: 'ร้านตัวอย่าง' },
  { key: 'tagline', value: 'คำโปรยตัวอย่าง' },
  { key: 'open_time', value: '08:00' },
  { key: 'close_time', value: '18:00' },
  { key: 'phone', value: '0X-XXX-XXXX' },
  { key: 'address', value: 'ที่อยู่ตัวอย่าง' },
]

test('parseShop: แปลงแถว settings (ข้อมูลตัวอย่าง) เป็นข้อมูลร้าน', () => {
  assert.deepEqual(parseShop(sampleSettings), {
    name: 'ร้านตัวอย่าง', tagline: 'คำโปรยตัวอย่าง', open: '08:00-18:00', phone: '0X-XXX-XXXX', address: 'ที่อยู่ตัวอย่าง',
  })
})

test('parseShop: ขาด key ต้องบอกชื่อ key เป็นภาษาไทย', () => {
  assert.throws(() => parseShop(sampleSettings.filter((r) => r.key !== 'phone')), /"phone"/)
})
