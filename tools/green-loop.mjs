#!/usr/bin/env node
// "แก้จนเขียว" แบบ workflow (สคริปต์ตายตัว ไม่ใช่ agent ตัดสินเอง): ตรวจ → ถ้าแดงเรียก `claude -p` ให้แก้ → ตรวจใหม่ → ... หยุดเมื่อ
// (1) เขียวทั้งหมด (2) ครบ N รอบ (3) แก้ไปสองครั้งติดกันแล้วรายการที่แดงเหมือนเดิมเป๊ะ (ไม่คืบหน้า)
// ใช้: node tools/green-loop.mjs [--rounds 4] [--part win|break|extra] [--budget 1.5] [--lesson 23] [--perm auto]
//   env CLAUDE_BIN = ตัว claude (ค่าเริ่มต้น claude) · --check-cmd "<คำสั่ง>" = คำสั่งตรวจอื่น (ต้องพิมพ์ JSON ของ check --json) — ไว้ทดสอบสคริปต์นี้
import { spawnSync } from 'node:child_process'

const a = process.argv.slice(2)
const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d)
const rounds = Math.min(6, Math.max(1, Number(opt('--rounds', 4))))
const lesson = opt('--lesson', '23'), part = opt('--part', ''), budget = opt('--budget', '1.5'), perm = opt('--perm', 'auto')
const checkCmd = opt('--check-cmd', `node tools/check/index.mjs ${lesson}${part ? ` --part ${part}` : ''} --json`)
const claude = process.env.CLAUDE_BIN || 'claude'

function check() {
  const r = spawnSync('sh', ['-c', checkCmd], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 26 })
  let res; try { res = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { return { error: `อ่านผลตรวจไม่ได้: ${(r.stdout + r.stderr).slice(-300)}` } }
  return { failing: res.filter((x) => !x.ok && !x.skip) }
}

const table = []
let prev = null, stuck = 0, cost = 0, calls = 0, green = false, why = ''
for (let round = 1; round <= rounds + 1; round++) {
  const c = check()
  if (c.error) { why = c.error; break }
  const names = c.failing.map((f) => f.name)
  table.push({ round: round - 1, failing: names.length, cost })
  if (!names.length) { green = true; break }
  if (round > rounds) { why = `ครบ ${rounds} รอบแล้วยังแดง ${names.length} ข้อ`; break }
  const key = names.join('|')
  stuck = key === prev ? stuck + 1 : 0; prev = key
  if (stuck >= 2) { why = 'ผ่านการแก้สองครั้งติดกันแล้วแดงรายการเดิมเป๊ะ (ไม่คืบหน้า) หยุดก่อนเสียเงินเพิ่ม'; break }
  const prompt = `ตัวตรวจ npm run check -- ${lesson} ยังแดง ${names.length} ข้อ แก้ให้ผ่านโดยแก้ที่ต้นเหตุ:\n${c.failing.map((f, i) => `${i + 1}. ${f.name}\n   → ${f.hint}`).join('\n')}\n\nกติกา: ห้ามแก้ tools/check/ ห้ามลบหรือผ่อน test · migration ใหม่เท่านั้น ห้ามแก้ migration เก่า · รัน npx supabase db reset และ npm test ให้ผ่านก่อนจบ · ห้ามพิมพ์ความลับ · เมื่อเขียวแล้ว commit เป็นภาษาไทย (ถ้ายังไม่เขียว ไม่ต้อง commit)`
  const r = spawnSync(claude, ['-p', prompt, '--permission-mode', perm, '--output-format', 'json', '--max-budget-usd', budget], { encoding: 'utf8', timeout: 1500000, maxBuffer: 1 << 26 })
  calls++
  try { cost += Number(JSON.parse(r.stdout.trim().split('\n').pop()).total_cost_usd ?? 0) } catch { /* ไม่มีราคา */ }
  if (r.error || r.status === null) { why = `เรียก claude ไม่ได้: ${r.error?.message ?? 'timeout'}`; break }
  let out = {}; try { out = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { /* ไม่ใช่ JSON */ }
  if (/not logged in|\/login/i.test(`${out.result ?? ''} ${r.stderr ?? ''}`)) { why = 'claude -p ตอบว่ายังไม่ได้ login (Not logged in) · พิมพ์ ! claude แล้ว /login ก่อน แล้วรัน green-loop ใหม่'; break }
}
console.log('\nรอบ | ข้อที่แดง | ค่าใช้จ่ายสะสม (USD)')
for (const t of table) console.log(`${String(t.round).padStart(3)} | ${String(t.failing).padStart(9)} | ${t.cost.toFixed(2)}`)
console.log(green ? `\nเขียวทั้งหมดหลังแก้ ${calls} รอบ · รวม $${cost.toFixed(2)}` : `\nยังไม่เขียว: ${why} · เรียก claude ${calls} ครั้ง · รวม $${cost.toFixed(2)}`)
process.exit(green ? 0 : 1)
