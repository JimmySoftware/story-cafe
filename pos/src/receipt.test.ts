import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { computeBill, type Catalog } from './bill.ts'
import { renderReceipt, textWidth, RECEIPT_WIDTH } from './receipt.ts'

// catalog จาก data/ (ไม่พิมพ์ราคาซ้ำ) แบบเดียวกับ bill.test.ts
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
const AT = '2026-10-26T03:30:00Z' // 10:30 เวลาไทย
const long = computeBill({
  lines: [
    { item: 'ลาเต้', qty: 2, options: { size: 'L', milk: 'โอ๊ต', sweetness: '50%', extra_shots: 2 } },
    { item: 'ครัวซองต์เนย', qty: 1 },
  ],
  redeem_points: 30, points_balance: 100, cash_received: 500, at: AT,
}, catalog)
const short = computeBill({ lines: [{ item: 'เอสเปรสโซ', qty: 1 }], at: AT }, catalog)

test('ทุกบรรทัดกว้างไม่เกิน 32 คอลัมน์ แม้ชื่อร้านและรายการยาว', () => {
  const lines = renderReceipt(long, { shop_name: 'ร้านกาแฟเรื่องเล่าเมืองเก่า สาขาริมน้ำ', bill_no: 'PB-20261026-0001', at: AT })
  for (const l of lines) assert.ok(textWidth(l) <= RECEIPT_WIDTH, `กว้างเกิน: "${l}" (${textWidth(l)})`)
  assert.ok(lines.length > 8)
})

test('ชื่อร้านยาวไม่มีช่องว่างให้ตัด ต้องตัดตามความกว้างโดยไม่แยกวรรณยุกต์ออกจากพยัญชนะ', () => {
  const name = 'ร้านกาแฟเรื่องเล่าเมืองเก่าริมน้ำสาขาที่หนึ่งเปิดใหม่'
  const lines = renderReceipt(short, { shop_name: name, bill_no: 'PB-1', at: AT })
  for (const l of lines) assert.ok(textWidth(l) <= RECEIPT_WIDTH)
  assert.ok(!lines.some((l) => /^\s*[ัิ-ฺ็-๎]/.test(l)), 'บรรทัดขึ้นต้นด้วยสระบน/วรรณยุกต์')
  assert.equal(lines.join('').replace(/\s/g, '').includes(name.replace(/\s/g, '')), true, 'ตัดแล้วตัวอักษรหาย')
})

test('มีข้อมูลครบ: ชื่อร้าน เลขบิล วันเวลาไทย รายการ ยอด รับเงิน/ทอน แต้ม ขอบคุณ', () => {
  const text = renderReceipt(long, { shop_name: 'ร้านทดสอบ', bill_no: 'PB-20261026-0001', at: AT }).join('\n')
  for (const s of ['ร้านทดสอบ', 'PB-20261026-0001', '26/10/2026 10:30', long.lines[0].label, String(long.lines[0].line_total),
    String(long.subtotal), String(long.discount), String(long.total), String(long.cash_received), String(long.change),
    String(long.points_earned), 'ขอบคุณที่มาอุดหนุน']) {
    assert.ok(text.includes(s), `ไม่มี "${s}"`)
  }
  assert.ok(!/undefined|NaN|null/.test(text))
})

test('ไม่มีส่วนลด/ไม่ได้รับเงิน → ไม่มีบรรทัดส่วนลด รับเงิน ทอน', () => {
  const text = renderReceipt(short, { shop_name: 'ร้านทดสอบ', bill_no: 'PB-2', at: AT }).join('\n')
  assert.ok(!text.includes('ส่วนลด') && !text.includes('รับเงิน') && !text.includes('เงินทอน'))
  assert.ok(text.includes('สุทธิ') && !/undefined|NaN|null/.test(text))
})

test('วันเวลาใช้เวลาไทย: 17:30 UTC ข้ามเป็นวันถัดไป 00:30', () => {
  const text = renderReceipt(short, { shop_name: 'x', bill_no: 'PB-3', at: '2026-10-26T17:30:00Z' }).join('\n')
  assert.ok(text.includes('27/10/2026 00:30'))
})

test('ชื่อร้านว่าง (ยังไม่เคยอ่านจาก settings) → ไม่มีบรรทัดชื่อร้าน และไม่มีชื่อร้านฝังในโค้ด', () => {
  const lines = renderReceipt(short, { shop_name: '', bill_no: 'PB-4', at: AT })
  assert.equal(lines[0], 'PB-4')
  assert.ok(!/Story Cafe/.test(readFileSync(fileURLToPath(new URL('./receipt.ts', import.meta.url)), 'utf8')))
})

test('เวลาอ่านไม่ได้ → error ภาษาไทย', () => {
  assert.throws(() => renderReceipt(short, { shop_name: 'x', bill_no: 'PB-5', at: 'เมื่อวาน' }), /อ่านไม่ได้/)
})
