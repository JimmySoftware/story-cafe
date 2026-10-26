// ตัวช่วยของหน้า #/preorder: ข้อความ error ภาษาไทย + วันที่เวลาไทย
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { thaiError, fallbackError } from '../../web/src/preorder/errors.ts'
import { bangkokDay, timeLabel } from '../../web/src/preorder/time.ts'

test('รหัส error ทุกตัวใน brief แปลเป็นภาษาไทย ไม่โชว์รหัสหรือ stack', () => {
  for (const c of ['empty_order', 'bad_slot', 'outside_hours', 'too_far', 'too_late', 'slot_full', 'bad_option']) {
    const t = thaiError({ message: `${c}: ข้อความจากฐานข้อมูล` })
    assert.match(t, /[ก-๙]/)
    assert.doesNotMatch(t, new RegExp(c))
  }
})

test('error ที่ไม่รู้จักหรือ stack trace ได้ข้อความกลาง ๆ', () => {
  assert.equal(thaiError(new Error('TypeError: x is undefined\n    at foo (bar.js:1:1)')), fallbackError)
  assert.equal(thaiError(null), fallbackError)
  assert.match(thaiError(new TypeError('Failed to fetch')), /อินเทอร์เน็ต/)
})

test('วันที่ใช้เวลาไทย: 18:00 UTC ของวันที่ 1 เป็นวันที่ 2 ที่กรุงเทพ', () => {
  const now = new Date('2026-10-26T18:00:00Z')
  assert.equal(bangkokDay(0, now), '2026-10-27')
  assert.equal(bangkokDay(1, now), '2026-10-28')
  assert.equal(timeLabel('2026-10-27T03:00:00Z'), '10:00')
})
