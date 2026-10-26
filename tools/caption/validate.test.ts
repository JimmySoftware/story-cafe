import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCaptions, type Seasonal } from './validate.ts'

const seasonal: Seasonal = {
  items: [
    { name: 'เมนูทดสอบเอ', price: 100 },
    { name: 'เมนูทดสอบบี', price: 55 },
  ],
}

const cap = (over: Record<string, unknown> = {}) => ({
  platform: 'instagram',
  text: 'วันฝนตกต้องลอง เมนูทดสอบเอ แก้วนี้หอมมาก',
  hashtags: ['#หน้าฝน', '#กาแฟ', '#คาเฟ่'],
  ...over,
})
const good = () => ({ captions: [cap(), cap({ platform: 'tiktok' }), cap()] })

test('ผ่านเมื่อถูกทุกข้อ', () => {
  assert.deepEqual(validateCaptions(good(), seasonal), { ok: true, errors: [] })
})

test('จำนวน caption ไม่ใช่ 3', () => {
  const r = validateCaptions({ captions: [cap(), cap({ platform: 'tiktok' })] }, seasonal)
  assert.equal(r.ok, false)
})

test('ขาด tiktok', () => {
  const r = validateCaptions({ captions: [cap(), cap(), cap()] }, seasonal)
  assert.match(r.errors.join('\n'), /tiktok/)
})

test('ข้อความสั้น/ยาวเกิน และไม่ใช่ภาษาไทย', () => {
  const d = good()
  d.captions[0] = cap({ text: 'สั้น เมนูทดสอบเอ' })
  d.captions[1] = cap({ platform: 'tiktok', text: 'เมนูทดสอบเอ' + 'ก'.repeat(200) })
  d.captions[2] = cap({ text: 'english only caption long enough' })
  assert.equal(validateCaptions(d, seasonal).errors.length >= 4, true)
})

test('ไม่กล่าวถึงชื่อเมนูตรงกับไฟล์', () => {
  const d = good()
  d.captions[0] = cap({ text: 'วันฝนตกต้องลองเมนูใหม่ของร้านเรา แก้วนี้หอมมาก' })
  assert.match(validateCaptions(d, seasonal).errors.join(), /เมนู/)
})

test('ราคาต้องตรงกับไฟล์ (บาท และ ฿)', () => {
  const d = good()
  d.captions[0] = cap({ text: 'เมนูทดสอบเอ ราคา 100 บาท และเมนูทดสอบบี ฿55 เท่านั้น' })
  assert.equal(validateCaptions(d, seasonal).ok, true)
  d.captions[0] = cap({ text: 'เมนูทดสอบเอ ราคา 99 บาท วันนี้เท่านั้นนะ' })
  assert.match(validateCaptions(d, seasonal).errors.join(), /99/)
  d.captions[0] = cap({ text: 'เมนูทดสอบเอ ราคา ฿90 วันนี้เท่านั้นนะจ๊ะ' })
  assert.match(validateCaptions(d, seasonal).errors.join(), /90/)
})

test('ห้ามอ้างเรื่องสุขภาพ', () => {
  const d = good()
  d.captions[0] = cap({ text: 'เมนูทดสอบเอ ดีต่อสุขภาพ ดื่มแล้วลดน้ำหนักได้' })
  const r = validateCaptions(d, seasonal)
  assert.match(r.errors.join(), /ดีต่อสุขภาพ/)
  assert.match(r.errors.join(), /ลดน้ำหนัก/)
})

test('hashtags ผิดรูปแบบ', () => {
  const d = good()
  d.captions[0] = cap({ hashtags: ['#a', 'b', '#c d'] })
  assert.equal(validateCaptions(d, seasonal).errors.length, 2)
  d.captions[0] = cap({ hashtags: ['#a', '#b'] })
  assert.equal(validateCaptions(d, seasonal).ok, false)
})

test('ข้อมูลผิดรูปทั้งก้อน', () => {
  assert.equal(validateCaptions(null, seasonal).ok, false)
  assert.equal(validateCaptions({}, seasonal).ok, false)
})
