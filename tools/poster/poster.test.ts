import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { addSpend, bangkokDate, buildPrompt, cacheKey, checkBudget, currentSpend, escapeHtml, fillTemplate, formatUsd, parseArgs, renderItems, SCHEMA, validateCopy, type PosterCopy, type Seasonal } from './poster.ts'

const seasonal: Seasonal = {
  shop: 'ร้านทดสอบ',
  hours: '08:00–16:00',
  season: 'หน้าฝน',
  items: [
    { name: 'กาแฟเอ', price: 111, note: 'โน้ตเอ' },
    { name: 'ชาบี', price: 222, note: 'โน้ตบี' },
  ],
}
const copy: PosterCopy = {
  headline: 'หัวเรื่อง',
  subline: 'บรรทัดรอง',
  items: [
    { name: 'กาแฟเอ', blurb: 'อร่อยเอ' },
    { name: 'ชาบี', blurb: 'อร่อยบี' },
  ],
  footer: 'ท้ายโปสเตอร์',
}

test('schema ไม่มีฟิลด์ราคา', () => {
  assert.ok(!('price' in SCHEMA.properties.items.items.properties))
  assert.ok(!('price' in SCHEMA.properties))
  assert.deepEqual(SCHEMA.required, ['headline', 'subline', 'items', 'footer'])
})

test('prompt มีชื่อเมนูและ theme แต่ไม่มีราคา', () => {
  const p = buildPrompt(seasonal, 'เน้นวันฝนตก')
  assert.match(p, /กาแฟเอ/)
  assert.match(p, /เน้นวันฝนตก/)
  assert.doesNotMatch(p, /111|222/)
  assert.doesNotMatch(buildPrompt(seasonal), /โจทย์เพิ่มเติม/)
})

test('escapeHtml กัน tag และเครื่องหมายคำพูด', () => {
  assert.equal(escapeHtml(`<script>"a" & 'b'</script>`), '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;')
})

test('ราคาในโปสเตอร์มาจากไฟล์เสมอ แม้โมเดลแอบเขียนราคามา', () => {
  const sneaky = { ...copy, items: [{ name: 'กาแฟเอ', blurb: 'ลดเหลือ 1 บาท', price: 1 } as never, copy.items[1]] }
  const html = renderItems(seasonal, sneaky)
  assert.match(html, /<span class="price">111 บาท<\/span>/)
  assert.match(html, /<span class="price">222 บาท<\/span>/)
  assert.doesNotMatch(html, /price">1 บาท/)
})

test('ชื่อเมนูที่โมเดลแต่งเองไม่ถูกใส่ และ blurb ที่ขาดใช้ note จากไฟล์', () => {
  const html = renderItems(seasonal, { ...copy, items: [{ name: 'เมนูแต่งเอง', blurb: 'x' }] })
  assert.doesNotMatch(html, /เมนูแต่งเอง/)
  assert.match(html, /โน้ตเอ/)
  assert.equal((html.match(/<li>/g) ?? []).length, 2)
})

test('fillTemplate กรอกทุกช่องและ escape ข้อความจากโมเดล', () => {
  const tpl = readFileSync('tools/poster/template.html', 'utf8')
  const html = fillTemplate(tpl, seasonal, { ...copy, headline: '<script>x</script>' }, '/a b')
  assert.doesNotMatch(html, /\{\{\w+\}\}/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;x/)
  assert.match(html, /\/a%20b\/web\/public\/fonts\/Kanit-Regular\.ttf/)
  assert.equal((html.match(/<li>/g) ?? []).length, 2)
})

test('parseArgs ค่าเริ่มต้นและค่าที่ระบุ', () => {
  assert.deepEqual(parseArgs([]), { theme: undefined, out: 'out/poster.png', force: false })
  assert.deepEqual(parseArgs(['--theme', 'ฝน', '--out', 'x.png', '--force']), { theme: 'ฝน', out: 'x.png', force: true })
})

test('formatUsd', () => {
  assert.equal(formatUsd(0.05), '$0.05')
})

const ok: PosterCopy = { headline: 'ก', subline: 'ข', items: [{ name: 'กาแฟเอ', blurb: 'x' }, { name: 'ชาบี', blurb: 'y' }], footer: 'ค' }

test('validateCopy: ผ่านเมื่อครบ ไม่ผ่านเมื่อขาด เกิน ซ้ำ หรือไม่ใช่ object', () => {
  assert.deepEqual(validateCopy(ok, seasonal), [])
  assert.match(validateCopy({ ...ok, items: [ok.items[0]] }, seasonal).join(), /เมนูขาด: ชาบี/)
  assert.match(validateCopy({ ...ok, items: [...ok.items, { name: 'แปลก', blurb: 'z' }] }, seasonal).join(), /ไม่มีในร้าน: แปลก/)
  assert.match(validateCopy({ ...ok, items: [ok.items[0], ok.items[0]] }, seasonal).join(), /ซ้ำ/)
  assert.match(validateCopy({ ...ok, headline: '' }, seasonal).join(), /headline/)
  assert.ok(validateCopy(null, seasonal).length > 0)
  assert.ok(validateCopy({ headline: 'a', subline: 'b', footer: 'c' }, seasonal).length > 0)
})

test('cacheKey: เปลี่ยน theme / เมนู / prompt แล้วคีย์เปลี่ยน', () => {
  const k = cacheKey(seasonal, undefined, 'p')
  assert.equal(k, cacheKey(seasonal, undefined, 'p'))
  assert.notEqual(k, cacheKey(seasonal, 'ฝน', 'p'))
  assert.notEqual(k, cacheKey(seasonal, undefined, 'q'))
  assert.notEqual(k, cacheKey({ ...seasonal, items: [seasonal.items[0]] }, undefined, 'p'))
})

test('bangkokDate: ใช้เวลา Asia/Bangkok (UTC+7)', () => {
  assert.equal(bangkokDate(new Date('2026-10-26T16:59:00Z')), '2026-10-26')
  assert.equal(bangkokDate(new Date('2026-10-26T17:00:00Z')), '2026-10-27')
})

const limits = { max_calls_per_day: 5, max_usd_per_day: 0.5, max_usd_per_call: 0.15 }

test('currentSpend / checkBudget / addSpend', () => {
  assert.deepEqual(currentSpend({ date: '2026-10-25', calls: 9, usd: 9 }, '2026-10-26'), { date: '2026-10-26', calls: 0, usd: 0 })
  assert.deepEqual(currentSpend('พัง', '2026-10-26'), { date: '2026-10-26', calls: 0, usd: 0 })
  const d = '2026-10-26'
  assert.equal(checkBudget({ date: d, calls: 4, usd: 0.35 }, limits), null)
  assert.match(checkBudget({ date: d, calls: 5, usd: 0 }, limits)!, /ถึงเพดาน.*5 ครั้ง/)
  assert.match(checkBudget({ date: d, calls: 1, usd: 0.36 }, limits)!, /ถึงเพดาน/)
  assert.deepEqual(addSpend({ date: d, calls: 1, usd: 0.1 }, 0.2), { date: d, calls: 2, usd: 0.3 })
})
