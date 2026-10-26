import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeStore, earnPoints, balanceOf } from './index.ts'

test('ซื้อ 50 บาท ได้ 2 แต้ม', () => {
  const s = makeStore()
  earnPoints(s, 'c1', 50, new Date('2026-10-21T05:00:00Z')) // พุธ
  assert.equal(balanceOf(s, 'c1'), 2)
})
