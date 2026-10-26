import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const fake = join(root, 'tools/fakes/claude')

function run(mode: string | null, extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'caption-'))
  const out = join(dir, 'sub', 'captions.json')
  const log = join(dir, 'calls.log')
  const env = { ...process.env, CLAUDE_BIN: fake, FAKE_CLAUDE_LOG: log, ...extra }
  if (mode) env.FAKE_CLAUDE_MODE = mode
  const r = spawnSync('node', ['--import', 'tsx', 'tools/caption/cli.ts', '--out', out], { cwd: root, env, encoding: 'utf8' })
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  return { ...r, out, calls }
}

const noTrace = (s: string) => assert.doesNotMatch(s, /\bat .*\(|node:internal|Error:/)

test('ok: เขียนไฟล์ เรียกครั้งเดียว exit 0', () => {
  const r = run('ok')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /สร้าง caption 3 อัน → /)
  assert.equal(JSON.parse(readFileSync(r.out, 'utf8')).captions.length, 3)
  assert.equal(r.calls.length, 1)
  assert.equal(r.calls[0].schemaOk, true)
})

test('bad_then_ok: ลองใหม่ครั้งที่สองโดยบอกข้อที่ผิด แล้วเขียนไฟล์', () => {
  const r = run('bad_then_ok')
  assert.equal(r.status, 0)
  assert.equal(r.calls.length, 2)
  assert.doesNotMatch(r.calls[0].prompt, /ครั้งก่อนที่ส่งมาผิด/)
  assert.match(r.calls[1].prompt, /ครั้งก่อนที่ส่งมาผิด/)
  assert.match(r.calls[1].prompt, /hashtag|ความยาว|ตัวอักษร/)
  assert.ok(existsSync(r.out))
})

test('always_bad: ลอง 2 ครั้งแล้ว exit 1 ไม่เขียนไฟล์ ข้อความไทยบอกข้อที่ผิด', () => {
  const r = run('always_bad')
  assert.equal(r.status, 1)
  assert.equal(r.calls.length, 2)
  assert.equal(existsSync(r.out), false)
  assert.match(r.stderr, /ไม่ผ่านกติกา/)
  assert.match(r.stderr, /caption ที่ 1/)
  noTrace(r.stderr)
})

test('wrong_price: ราคาผิดถูกจับ exit 1 ไม่เขียนไฟล์', () => {
  const r = run('wrong_price')
  assert.equal(r.status, 1)
  assert.equal(existsSync(r.out), false)
  assert.match(r.stderr, /ราคา 50/)
  assert.match(r.calls[1].prompt, /ราคา 50/)
})

test('login: exit 2 บอกให้ /login ไม่เขียนไฟล์ ไม่มี stack trace', () => {
  const r = run('login')
  assert.equal(r.status, 2)
  assert.equal(existsSync(r.out), false)
  assert.match(r.stderr, /\/login/)
  noTrace(r.stderr)
})

test('garbage: ตอบไม่ใช่ JSON → exit 2', () => {
  const r = run('garbage')
  assert.equal(r.status, 2)
  assert.equal(existsSync(r.out), false)
  assert.match(r.stderr, /\/login/)
  noTrace(r.stderr)
})

test('หา claude ไม่เจอ → exit 2', () => {
  const r = run('ok', { CLAUDE_BIN: '/ไม่มี/claude-นี้' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /\/login/)
  noTrace(r.stderr)
})

test('ข้อความที่ร้านเห็นไม่เรียกว่า Claude Code', () => {
  for (const m of ['always_bad', 'login']) assert.doesNotMatch(run(m).stderr, /Claude Code/i)
})
