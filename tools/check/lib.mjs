// ตัวช่วยของตัวตรวจประจำบท (ไม่มี dependency) — อ่านง่าย แก้ได้ ตัวตรวจแต่ละบทอยู่ใน lesson-NN.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const root = process.cwd()
export const exists = (p) => existsSync(join(root, p))
export const read = (p) => (exists(p) ? readFileSync(join(root, p), 'utf8') : '')
export const lines = (p) => read(p).split('\n')

export function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, ...opts })
    return { ok: true, out }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

export function walk(dir, skip = ['node_modules', '.git', 'dist', '.cafe']) {
  const out = []
  const base = join(root, dir)
  if (!existsSync(base)) return out
  for (const n of readdirSync(base)) {
    if (skip.includes(n)) continue
    const p = join(dir, n)
    if (statSync(join(root, p)).isDirectory()) out.push(...walk(p, skip))
    else out.push(p)
  }
  return out
}

// menu.txt → [{name, price}] (บรรทัดที่ขึ้นต้นด้วย "- " ตามด้วยชื่อและราคา)
export function menuItems() {
  const items = []
  for (const l of lines('menu.txt')) {
    const m = l.match(/^-\s+(.+?)\s+(\d+)\s*(\(.*\))?\s*$/)
    if (m) items.push({ name: m[1], price: Number(m[2]) })
  }
  return items
}

// รันงานใน "สำเนาชั่วคราว" ของโปรเจกต์ เพื่อให้ตัวตรวจไม่ทิ้งไฟล์ (เช่น PDF) ไว้ในโฟลเดอร์จริง
import { mkdtempSync, cpSync, symlinkSync, rmSync, existsSync as ex } from 'node:fs'
import { tmpdir } from 'node:os'
export function inTemp(dirs, fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'cafe-check-'))
  try {
    for (const d of dirs) if (ex(join(root, d))) cpSync(join(root, d), join(tmp, d), { recursive: true })
    if (ex(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(tmp, 'node_modules'))
    return fn(tmp)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// อยู่ที่ tag lesson-NN ของ repo นี้ตรง ๆ (clone แล้ว checkout tag) หรือไม่ — ใช้ข้ามข้อที่ตรวจ "งานของผู้เรียนเอง"
// (ผลของ prompt, ประวัติ git ของผู้เรียน) เพราะ tag เก็บไฟล์ปลายบทไว้ ไม่ใช่ประวัติและผลที่ผู้เรียนจะสร้างเอง
// ตั้ง CAFE_AS_LEARNER=1 เพื่อบังคับตรวจเต็มทุกข้อ
export function onTag() {
  if (process.env.CAFE_AS_LEARNER === '1' || !exists('.git')) return false
  const r = run('git', ['describe', '--exact-match', '--tags', 'HEAD'])
  return r.ok && /^lesson-\d+$/.test(r.out.trim())
}
