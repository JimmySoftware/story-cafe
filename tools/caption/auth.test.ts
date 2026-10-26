import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { checkAuth } from './auth.ts'

const root = resolve(import.meta.dirname, '../..')
const FAKE_OK = 'sk-ant-FAKE-ไม่ใช่ของจริง-0000000000'.replace('ไม่ใช่ของจริง', 'not-real')
const FAKE_BAD = 'sk-ant-FAKE'

test('ไม่มี key หรือค่าว่าง = โหมด login', () => {
  assert.deepEqual(checkAuth({}), { mode: 'login', keyOk: null })
  assert.deepEqual(checkAuth({ ANTHROPIC_API_KEY: '' }), { mode: 'login', keyOk: null })
  assert.deepEqual(checkAuth({ ANTHROPIC_API_KEY: '   ' }), { mode: 'login', keyOk: null })
})

test('มี key รูปแบบถูก = api-key keyOk true', () => {
  assert.deepEqual(checkAuth({ ANTHROPIC_API_KEY: FAKE_OK }), { mode: 'api-key', keyOk: true })
})

test('key รูปแบบผิด (สั้นไป / ไม่ขึ้นต้น sk-ant-) = keyOk false', () => {
  assert.deepEqual(checkAuth({ ANTHROPIC_API_KEY: FAKE_BAD }), { mode: 'api-key', keyOk: false })
  assert.deepEqual(checkAuth({ ANTHROPIC_API_KEY: 'xx-FAKE-0000000000000000000' }), { mode: 'api-key', keyOk: false })
})

test('ผลลัพธ์ของ checkAuth ไม่มีตัว key', () => {
  assert.doesNotMatch(JSON.stringify(checkAuth({ ANTHROPIC_API_KEY: FAKE_OK })), /FAKE/)
})

function authCheck(key: string | null) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  if (key !== null) env.ANTHROPIC_API_KEY = key
  return spawnSync('node', ['--import', 'tsx', 'tools/caption/cli.ts', '--auth-check'], { cwd: root, env, encoding: 'utf8' })
}

test('--auth-check โหมด login: exit 0', () => {
  const r = authCheck(null)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /ล็อกอิน/)
})

test('--auth-check key ถูกรูปแบบ: exit 0 และไม่พิมพ์ key', () => {
  const r = authCheck(FAKE_OK)
  assert.equal(r.status, 0)
  assert.match(r.stdout, /api-key/)
  assert.doesNotMatch(r.stdout + r.stderr, /FAKE|sk-ant|0000/)
})

test('--auth-check key ผิดรูปแบบ: exit 1 และไม่พิมพ์ key', () => {
  const r = authCheck(FAKE_BAD)
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /รูปแบบ/)
  assert.doesNotMatch(r.stdout + r.stderr, /FAKE|sk-ant/)
})
