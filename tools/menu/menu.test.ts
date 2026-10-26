import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePrice, toCsv } from './parse.ts'

test('ราคาเป็นตัวเลขล้วนใช้ได้', () => {
  assert.equal(parsePrice(75, 3), 75)
  assert.equal(parsePrice('85', 3), 85)
})

test('ราคาที่ไม่ใช่ตัวเลขต้องบอกว่าผิดที่แถวไหน', () => {
  assert.throws(() => parsePrice('ฟรี', 7), /แถว 7/)
})

test('toCsv: หัวตารางและรูปแบบแถว', () => {
  const csv = toCsv([{ category: 'กาแฟ', name: 'ลาเต้', price: 75, isDrink: true }])
  assert.equal(csv, 'category,name,price,is_drink\nกาแฟ,ลาเต้,75,1\n')
})
