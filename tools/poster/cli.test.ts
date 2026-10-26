import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const FAKE = resolve('tools/fakes/claude')

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'poster-'))
  const env = { ...process.env, CLAUDE_BIN: FAKE, CAFE_STATE_DIR: join(dir, 'state'), FAKE_CLAUDE_LOG: join(dir, 'calls.log') }
  const run = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync('node', ['--import', 'tsx', 'tools/poster/cli.ts', '--out', join(dir, 'p.png'), ...args], { env: { ...env, ...extra }, encoding: 'utf8' })
  const calls = () => (existsSync(env.FAKE_CLAUDE_LOG) ? readFileSync(env.FAKE_CLAUDE_LOG, 'utf8').split('\n').filter(Boolean).length : 0)
  const spend = () => JSON.parse(readFileSync(join(dir, 'state', 'spend.json'), 'utf8'))
  return { dir, run, calls, spend }
}

test('สำเร็จ: เรียกโมเดล 1 ครั้ง นับค่าใช้จ่ายจาก total_cost_usd แล้วครั้งต่อไปใช้ cache', () => {
  const t = setup()
  const a = t.run([], { FAKE_CLAUDE_COST: '0.07' })
  assert.equal(a.status, 0, a.stderr)
  assert.match(a.stdout, /โมเดล 1 ครั้ง · \$0\.07/)
  assert.ok(existsSync(join(t.dir, 'p.png')))
  assert.equal(t.spend().calls, 1)
  assert.equal(t.spend().usd, 0.07)
  const b = t.run([])
  assert.equal(b.status, 0, b.stderr)
  assert.match(b.stdout, /จาก cache/)
  assert.equal(t.calls(), 1)
  assert.equal(t.spend().calls, 1)
  const c = t.run(['--force'])
  assert.equal(c.status, 0, c.stderr)
  assert.equal(t.calls(), 2)
})

test('โมเดลตอบเมนูที่ไม่มีในไฟล์: exit 1 ไม่สร้างไฟล์ ไม่เก็บ cache แต่ยังนับค่าใช้จ่าย', () => {
  const t = setup()
  const r = t.run([], { FAKE_CLAUDE_MODE: 'poster_bad' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /เมนูที่ไม่มีในร้าน: เมนูที่ไม่มีในร้าน/)
  assert.match(r.stderr, /เมนูขาด/)
  assert.doesNotMatch(r.stderr, /at .*\.ts/)
  assert.ok(!existsSync(join(t.dir, 'p.png')) && !existsSync(join(t.dir, 'p.html')))
  assert.ok(!existsSync(join(t.dir, 'state', 'poster-cache')))
  assert.equal(t.spend().calls, 1)
})

test('โมเดลแอบใส่ <script>: HTML ที่ได้ไม่มี tag จริง', () => {
  const t = setup()
  const r = t.run([], { FAKE_CLAUDE_MODE: 'poster_xss' })
  assert.equal(r.status, 0, r.stderr)
  const html = readFileSync(join(t.dir, 'p.html'), 'utf8')
  assert.doesNotMatch(html, /<script>|<img/i)
  assert.match(html, /&lt;script&gt;alert\(1\)/)
})

test('กดซ้ำ 20 ครั้งด้วย theme ต่างกัน: หยุดที่เพดานจำนวนครั้ง (5) และไม่เรียกโมเดลเพิ่ม', () => {
  const t = setup()
  const codes: (number | null)[] = []
  for (let i = 0; i < 20; i++) codes.push(t.run(['--theme', `ธีม ${i}`]).status)
  assert.deepEqual(codes, [...Array(5).fill(0), ...Array(15).fill(3)])
  assert.equal(t.calls(), 5)
  assert.equal(t.spend().calls, 5)
  const blocked = t.run(['--theme', 'ธีมใหม่'])
  assert.equal(blocked.status, 3)
  assert.match(blocked.stderr, /ถึงเพดาน.*5 ครั้ง/)
  assert.equal(t.calls(), 5)
})

test('กดซ้ำ 20 ครั้ง: หยุดที่เพดานดอลลาร์เมื่อค่าใช้จ่ายต่อครั้งสูง และ cache ยังใช้ได้ตอนถึงเพดาน', () => {
  const t = setup()
  const codes: (number | null)[] = []
  for (let i = 0; i < 20; i++) codes.push(t.run(['--theme', `ธีม ${i}`], { FAKE_CLAUDE_COST: '0.1' }).status)
  // 0.1 x 4 = 0.4 แล้วครั้งที่ 5: 0.4 + 0.15 > 0.5 จึงหยุด
  assert.deepEqual(codes, [...Array(4).fill(0), ...Array(16).fill(3)])
  assert.equal(t.calls(), 4)
  assert.ok(Math.abs(t.spend().usd - 0.4) < 1e-9)
  const cached = t.run(['--theme', 'ธีม 0'], { FAKE_CLAUDE_COST: '0.1' })
  assert.equal(cached.status, 0, cached.stderr)
  assert.match(cached.stdout, /จาก cache/)
  assert.equal(t.calls(), 4)
  assert.equal(readdirSync(join(t.dir, 'state', 'poster-cache')).length, 4)
})

test('ข้อความยาวจนล้นกรอบ: exit 4 ข้อความไทย ไม่ทิ้ง PNG และไม่ทับไฟล์เดิม · ข้อความปกติผ่าน', () => {
  const t = setup()
  const long = t.run(['--theme', 'ยาว'], { FAKE_CLAUDE_MODE: 'poster_long' })
  assert.equal(long.status, 4, long.stderr)
  assert.match(long.stderr, /ไม่ผ่านการตรวจ.*PNG/)
  assert.match(long.stderr, /หัวเรื่อง/)
  assert.doesNotMatch(long.stderr, /at .*\.ts/)
  assert.ok(!existsSync(join(t.dir, 'p.png')))
  const normal = t.run(['--theme', 'ปกติ'])
  assert.equal(normal.status, 0, normal.stderr)
  assert.ok(existsSync(join(t.dir, 'p.png')))
})

test('ภาพที่ผ่านแล้วถูกทับด้วยผลที่ไม่ผ่าน: ไฟล์เดิมยังอยู่ครบ', () => {
  const t = setup()
  assert.equal(t.run(['--theme', 'ก']).status, 0)
  const before = readFileSync(join(t.dir, 'p.png'))
  assert.equal(t.run(['--theme', 'ข'], { FAKE_CLAUDE_MODE: 'poster_long' }).status, 4)
  assert.deepEqual(readFileSync(join(t.dir, 'p.png')), before)
})
