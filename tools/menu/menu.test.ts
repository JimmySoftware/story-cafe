import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePrice, readMenuXlsx, toCsv } from './parse.ts'

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

test('ราคาแบบ ฿75.- อ่านได้', () => {
  assert.equal(parsePrice('฿75.-', 4), 75)
})

test('ราคาแบบ 85 บาท อ่านได้', () => {
  assert.equal(parsePrice('85 บาท', 6), 85)
})

test('ราคาแบบ 65.00 อ่านได้ (ทั้งข้อความและตัวเลข)', () => {
  assert.equal(parsePrice('65.00', 11), 65)
  assert.equal(parsePrice(65.0, 11), 65)
})

test('ช่องว่างหน้าหลังตัวเลขไม่เป็นปัญหา', () => {
  assert.equal(parsePrice(' 79 ', 13), 79)
  assert.equal(parsePrice(' 120\t', 14), 120)
})

test('ราคาที่อ่านไม่ออกจริง ๆ ต้องหยุดและบอกแถว ห้ามเดา', () => {
  for (const bad of ['ประมาณ 80', '75.50', '', '80-90', '0', '-5', '฿', '7 5']) {
    assert.throws(() => parsePrice(bad, 9), /แถว 9/, `ควรปฏิเสธ '${bad}'`)
  }
  assert.throws(() => parsePrice(undefined, 9), /แถว 9/)
})

test('ไฟล์ Excel ของร้าน (ราคาหลายแบบ + แถวว่างคั่น) แปลงได้เท่ากับ expected-menu.csv', async () => {
  const csv = toCsv(await readMenuXlsx('data/เมนู-จากร้าน.xlsx'))
  assert.equal(csv, readFileSync('tools/menu/expected-menu.csv', 'utf8'))
})
