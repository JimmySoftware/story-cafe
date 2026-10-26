import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { computeBill, type Catalog } from './bill.ts'

// สร้าง catalog จาก data/ แบบเดียวกับ pos/scripts/build-catalog.mjs (ไม่พิมพ์ราคาซ้ำในที่นี่)
const dataDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'data')
const table = (file: string) => {
  const [head, ...rows] = readFileSync(join(dataDir, file), 'utf8').split('\n').filter((l) => l.trim())
  const cols = head.split(',')
  return rows.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])))
}
const catalog: Catalog = {
  items: table('menu.csv').map((r) => ({ name: r.name, price: Number(r.price), is_drink: r.is_drink === '1' })),
  options: table('options.csv').map((r) => ({ kind: r.kind, label: r.label, price_delta: Number(r.price_delta) })),
}

test('ตัวอย่างบิลในบท: ลาเต้ L โอ๊ต หวาน 50% + ครัวซองต์เนย ใช้ 30 แต้ม รับ 200', () => {
  const bill = computeBill(
    {
      lines: [
        { item: 'ลาเต้', qty: 1, options: { size: 'L', milk: 'โอ๊ต', sweetness: '50%' } },
        { item: 'ครัวซองต์เนย', qty: 1 },
      ],
      redeem_points: 30,
      points_balance: 100,
      cash_received: 200,
      at: '2026-10-26T10:00:00+07:00', // วันจันทร์
    },
    catalog,
  )
  assert.equal(bill.subtotal, 179)
  assert.equal(bill.discount, 30)
  assert.equal(bill.total, 149)
  assert.equal(bill.change, 51)
  assert.equal(bill.points_earned, 5)
  assert.equal(bill.points_redeemed, 30)
  assert.equal(bill.lines[0].label, 'ลาเต้ L โอ๊ต หวาน 50%')
  assert.equal(bill.lines[0].line_total, bill.lines[0].unit_price)
})

test('ใช้แต้มได้ไม่เกินแต้มที่มีและไม่เกินยอดรวม', () => {
  const lines = [{ item: 'ครัวซองต์เนย', qty: 1 }]
  assert.equal(computeBill({ lines, redeem_points: 50, points_balance: 10 }, catalog).points_redeemed, 10)
  assert.equal(computeBill({ lines, redeem_points: 999, points_balance: 999 }, catalog).total, 0)
})

test('ไม่ให้ cash_received → change เป็น null และเงินไม่พอ → cash_short', () => {
  const lines = [{ item: 'ครัวซองต์เนย', qty: 1 }]
  const bill = computeBill({ lines }, catalog)
  assert.equal(bill.cash_received, null)
  assert.equal(bill.change, null)
  assert.throws(() => computeBill({ lines, cash_received: 1 }, catalog), /^Error: cash_short:/)
})

const croissant = [{ item: 'ครัวซองต์เนย', qty: 1 }]
const code = (c: string) => new RegExp(`^Error: ${c}: `)

test('ยอด 24 บาทได้ 0 แต้ม และ 25 บาทได้ 1 แต้ม (วันธรรมดา)', () => {
  const at = '2026-10-26T10:00:00+07:00'
  const pay = (n: number) => computeBill({ lines: croissant, redeem_points: 69 - n, points_balance: 100, at }, catalog)
  assert.equal(pay(24).total, 24)
  assert.equal(pay(24).points_earned, 0)
  assert.equal(pay(25).points_earned, 1)
})

test('แต้มคิดจากยอดที่จ่ายจริง ใช้แต้มจนยอดเป็น 0 → ได้ 0 แต้ม', () => {
  const bill = computeBill({ lines: croissant, redeem_points: 999, points_balance: 999, at: '2026-10-26T10:00:00+07:00' }, catalog)
  assert.equal(bill.total, 0)
  assert.equal(bill.points_earned, 0)
})

test('วันเสาร์ตามเวลาไทยได้แต้ม ×2 แม้ใน UTC ยังเป็นวันศุกร์ (เสาร์ 01:30 ไทย)', () => {
  const sat = computeBill({ lines: [{ item: 'ครัวซองต์เนย', qty: 3 }], at: '2026-10-24T01:30:00+07:00' }, catalog)
  const weekday = computeBill({ lines: [{ item: 'ครัวซองต์เนย', qty: 3 }], at: '2026-10-23T10:00:00+07:00' }, catalog)
  assert.equal(sat.points_earned, weekday.points_earned * 2)
  assert.ok(sat.points_earned > 0)
  // เวลาเดียวกันในรูป UTC (ศุกร์ 18:30Z)
  assert.equal(computeBill({ lines: [{ item: 'ครัวซองต์เนย', qty: 3 }], at: '2026-10-23T18:30:00Z' }, catalog).points_earned, sat.points_earned)
})

test('อาทิตย์ 00:30 ไทย (ยังเป็นเสาร์ใน UTC) ไม่ได้ ×2', () => {
  const lines = [{ item: 'ครัวซองต์เนย', qty: 3 }]
  const sun = computeBill({ lines, at: '2026-10-25T00:30:00+07:00' }, catalog)
  const mon = computeBill({ lines, at: '2026-10-26T10:00:00+07:00' }, catalog)
  assert.equal(sun.points_earned, mon.points_earned)
})

test('เสาร์ 23:59 ไทย ยัง ×2', () => {
  const lines = [{ item: 'ครัวซองต์เนย', qty: 3 }]
  const sat = computeBill({ lines, at: '2026-10-24T23:59:00+07:00' }, catalog)
  assert.equal(sat.points_earned, computeBill({ lines, at: '2026-10-26T10:00:00+07:00' }, catalog).points_earned * 2)
})

test('at อ่านไม่ได้ → error ภาษาไทย ไม่ใช่ RangeError', () => {
  assert.throws(() => computeBill({ lines: croissant, at: 'เมื่อวาน' }, catalog), /^Error: bad_at: /)
})

test('unknown_item', () => {
  assert.throws(() => computeBill({ lines: [{ item: 'ชาเย็นสมมติ', qty: 1 }] }, catalog), code('unknown_item'))
})

test('bad_qty: 0, 100, ติดลบ, ทศนิยม, NaN', () => {
  for (const qty of [0, 100, -1, 1.5, NaN]) {
    assert.throws(() => computeBill({ lines: [{ item: 'ลาเต้', qty }] }, catalog), code('bad_qty'), `qty=${qty}`)
  }
  assert.equal(computeBill({ lines: [{ item: 'ลาเต้', qty: 99 }] }, catalog).lines[0].qty, 99)
})

test('bad_option: ตัวเลือกที่ไม่มี, ของที่ไม่ใช่เครื่องดื่ม, extra_shots ผิด', () => {
  const bad = (options: object, item = 'ลาเต้') =>
    assert.throws(() => computeBill({ lines: [{ item, qty: 1, options }] }, catalog), code('bad_option'), JSON.stringify(options))
  bad({ size: 'XL' })
  bad({ milk: 'นมม้า' })
  bad({ sweetness: '999%' })
  bad({ extra_shots: 5 })
  bad({ extra_shots: -1 })
  bad({ extra_shots: 1.5 })
  bad({ size: 'L' }, 'ครัวซองต์เนย')
  bad({ extra_shots: 1 }, 'ครัวซองต์เนย')
  assert.equal(computeBill({ lines: [{ item: 'ลาเต้', qty: 1, options: { extra_shots: 4 } }] }, catalog).lines[0].unit_price > 0, true)
})

test('extra_shots บวกราคาตาม catalog', () => {
  const base = computeBill({ lines: [{ item: 'ลาเต้', qty: 1 }] }, catalog).subtotal
  const shot = catalog.options.find((o) => o.kind === 'extra')!.price_delta
  assert.equal(computeBill({ lines: [{ item: 'ลาเต้', qty: 2, options: { extra_shots: 2 } }] }, catalog).subtotal, (base + 2 * shot) * 2)
})

test('bad_points: ติดลบ ทศนิยม NaN', () => {
  for (const extra of [{ redeem_points: -1 }, { points_balance: -5 }, { redeem_points: 1.5 }, { points_balance: NaN }]) {
    assert.throws(() => computeBill({ lines: croissant, ...extra }, catalog), code('bad_points'), JSON.stringify(extra))
  }
})

test('empty_bill', () => {
  assert.throws(() => computeBill({ lines: [] }, catalog), code('empty_bill'))
})

test('cash_short: ขาดบาทเดียว error, พอดีทอน 0, NaN ไม่หลุดเป็นทอน NaN', () => {
  const total = computeBill({ lines: croissant }, catalog).total
  assert.throws(() => computeBill({ lines: croissant, cash_received: total - 1 }, catalog), code('cash_short'))
  assert.equal(computeBill({ lines: croissant, cash_received: total }, catalog).change, 0)
  assert.throws(() => computeBill({ lines: croissant, cash_received: NaN }, catalog), code('cash_short'))
})

test('ข้อความ error มีภาษาไทยหลัง code', () => {
  assert.throws(() => computeBill({ lines: [] }, catalog), /empty_bill: .*[฀-๿]/)
})

test('ไม่แก้ input และเรียกซ้ำได้ผลเดิม', () => {
  const input = {
    lines: [{ item: 'ลาเต้', qty: 2, options: { size: 'L' as const, milk: 'โอ๊ต', sweetness: '50%', extra_shots: 1 } }],
    redeem_points: 10, points_balance: 20, cash_received: 500, at: '2026-10-24T01:30:00+07:00',
  }
  const before = structuredClone(input)
  const a = computeBill(input, catalog)
  const cat = structuredClone(catalog)
  assert.deepEqual(input, before)
  assert.deepEqual(computeBill(input, catalog), a)
  assert.deepEqual(catalog, cat)
})
