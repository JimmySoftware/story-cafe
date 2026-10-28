// ตัวตรวจบท 24: เปิดร้านจริง — rls_audit · แผนสำรอง (fallback, backup/restore, usage) · runbook · สูตรของผู้เรียน · e2e ทั้งระบบ
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, createReadStream, readdirSync, copyFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { exists, read, run, walk, root } from './lib.mjs'
import { rows, scalar, sql, dbUp, cfg, container, csv } from './db.mjs'
import { api, rpc, newUser, delUser, env } from './api.mjs'

const need = () => (dbUp() ? null : { ok: false, hint: 'ติดต่อฐานข้อมูลในเครื่องไม่ได้ — รัน npx supabase start แล้ว npx supabase db reset' })
const service = (name, body = {}) => api(`/rest/v1/rpc/${name}`, { key: env().SUPABASE_SECRET_KEY, body })
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 300000, ...opts })
const thai = /[ก-๙]/

export const skipOnTag = (c) => false

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.png': 'image/png' }
function serveDir(dir) {
  const s = createServer((q, a) => {
    let p = join(dir, decodeURIComponent(q.url.split('?')[0])); if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html')
    a.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); createReadStream(p).pipe(a)
  })
  return new Promise((res) => s.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() })))
}
const fm = (t) => { const m = t.match(/^---\n([\s\S]*?)\n---/); if (!m) return null; const o = {}; for (const l of m[1].split('\n')) { const k = l.match(/^([A-Za-z_]+):\s*(.*)$/); if (k) o[k[1]] = k[2].trim().replace(/^['"]|['"]$/g, '') } return o }
const SECRET_RE = [/sk_live_[A-Za-z0-9]{8,}/, /sk-ant-(?!FAKE)[A-Za-z0-9_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /eyJ[A-Za-z0-9_-]{30,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}/]
function trackedFiles() {
  const g = sh('git', ['ls-files'])
  if (g.status === 0 && g.stdout.trim()) return g.stdout.split('\n').filter(Boolean)
  return walk('.', ['node_modules', '.git', 'dist', '.cafe', 'out', 'target', 'backups'])
}

export const checks = [
  {
    part: 'win', name: 'rls_audit(): เรียกได้เฉพาะ service_role · เมื่อปลูกจุดรั่วทดลอง 4 แบบ (ตารางไม่เปิด RLS / anon เขียนได้ / policy เขียนเปิดโล่ง / security definer ไม่ตั้ง search_path) ต้องรายงานครบทั้ง 4 รหัส · ลบของทดลองแล้วต้องไม่เหลือ',
    run: async () => {
      const n = need(); if (n) return n
      const staff = await newUser('au24', { appMetadata: { role: 'staff' } }), cust = await newUser('au24c')
      const drop = () => sql('drop table if exists public.zz_a1, public.zz_a2, public.zz_a3 cascade; drop function if exists public.zz_fn()')
      drop()
      try {
        if (scalar("select count(*) from pg_proc where proname='rls_audit'") !== '1') return { ok: false, hint: 'ยังไม่มีฟังก์ชัน rls_audit()' }
        const denied = [await rpc('rls_audit', {}), await rpc('rls_audit', {}, cust.token), await rpc('rls_audit', {}, staff.token)].map((r) => !r.ok)
        sql(`create table public.zz_a1 (id int);
             create table public.zz_a2 (id int); alter table public.zz_a2 enable row level security; grant insert on public.zz_a2 to anon;
             create table public.zz_a3 (id int); alter table public.zz_a3 enable row level security; create policy zz_open on public.zz_a3 for all to authenticated using (true) with check (true);
             create function public.zz_fn() returns int language sql security definer as $$ select 1 $$;`)
        const r = await service('rls_audit'); const f = Array.isArray(r.body) ? r.body : []
        const has = (t, p) => f.some((x) => x.table === t && x.problem === p)
        const found = { rls_off: has('zz_a1', 'rls_off'), anon_write: has('zz_a2', 'anon_write'), open_write_policy: has('zz_a3', 'open_write_policy'), definer_no_search_path: has('zz_fn', 'definer_no_search_path') }
        const shape = f.every((x) => typeof x.table === 'string' && typeof x.problem === 'string' && typeof x.detail === 'string')
        drop(); const after = (await service('rls_audit')).body
        const leftover = (Array.isArray(after) ? after : []).filter((x) => /^zz_/.test(x.table))
        return { ok: denied.every(Boolean) && Object.values(found).every(Boolean) && shape && !leftover.length, hint: `anon/ลูกค้า/พนักงานเรียกไม่ได้=${denied.join('/')} · เจอ ${JSON.stringify(found)} · รูปแบบ {table,problem,detail}=${shape} · เหลือของทดลองหลังลบ=${leftover.length} · status ${r.status} ${r.ok ? '' : r.text.slice(0, 100)}` }
      } finally { drop(); await delUser(staff.id); await delUser(cust.id) }
    },
  },
  {
    part: 'win', name: 'ระบบจริงของร้าน: rls_audit() ว่าง · ทุกตารางใน public เปิด RLS · anon ไม่มีสิทธิ์เขียนตารางใดเลย · ฟังก์ชัน security definer ตั้ง search_path ทุกตัว',
    run: async () => {
      const n = need(); if (n) return n
      const r = await service('rls_audit'); if (!r.ok) return { ok: false, hint: `rls_audit ${r.status}: ${r.text.slice(0, 120)}` }
      const f = Array.isArray(r.body) ? r.body : []
      const noRls = rows("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity") ?? []
      const anonW = rows("select distinct table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon' and privilege_type in ('INSERT','UPDATE','DELETE')") ?? []
      const defs = rows("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not coalesce(array_to_string(p.proconfig,',') like '%search_path%', false)") ?? []
      return { ok: !f.length && !noRls.length && !anonW.length && !defs.length, hint: `rls_audit พบ ${f.length} จุด ${JSON.stringify(f).slice(0, 200)} · ไม่เปิด RLS: ${noRls.map((x) => x[0]).join(',') || '-'} · anon เขียนได้: ${anonW.map((x) => x[0]).join(',') || '-'} · definer ไม่มี search_path: ${defs.map((x) => x[0]).join(',') || '-'}` }
    },
  },
  {
    part: 'extra', name: 'docs/security-review.md: บรรทัดแรก "ตรวจโดย: security review" + วันที่ · มีตารางจุดที่พบ (ระดับ + สถานะ แก้แล้ว/ยอมรับ) · พูดถึง RLS, service_role และ .env · test SQL 15_rls_audit.sql ผ่านใน npm run test:db · ไม่มีความลับจริงในไฟล์ที่ commit และ .env ไม่ถูก track',
    run: () => {
      const t = read('docs/security-review.md'); if (!t) return { ok: false, hint: 'ยังไม่มี docs/security-review.md' }
      const first = /^\s*(?:#+\s*)?ตรวจโดย:\s*security review.*\d{4}/i.test(t.split('\n').find((l) => l.trim()) ?? '')
      const table = /\|.*(ระดับ|severity).*\|/i.test(t) && /แก้แล้ว|ยอมรับ/.test(t)
      const topics = ['RLS', 'service_role'].every((w) => t.includes(w)) && /\.env|ความลับ/.test(t)
      const tests = walk('supabase/tests').some((f) => /rls_audit/.test(f))
      const files = trackedFiles().filter((f) => !/^(tools\/check|tools\/fakes)\//.test(f) && !/\.test\.(ts|mjs)$/.test(f) && !/fixtures\//.test(f) && !/\.(png|jpg|woff2?|ttf|xlsx|icns|ico|lock)$/.test(f))
      const leaks = files.filter((f) => { try { const c = readFileSync(join(root, f), 'utf8'); return SECRET_RE.some((re) => re.test(c)) } catch { return false } })
      const envTracked = sh('git', ['ls-files', '.env']).stdout.trim() === '.env' && !/ปลอม|FAKE|example\.invalid/.test(read('.env') || '')  // .env ปลอมของบท 3 ถูก track ไว้โดยตั้งใจ
      return { ok: first && table && topics && tests && !leaks.length && !envTracked, hint: `บรรทัดแรก=${first} · ตาราง=${table} · หัวข้อ RLS/service_role/.env=${topics} · มี test SQL=${tests} · ไฟล์ที่มีความลับ=${leaks.join(',') || 'ไม่มี'} · .env ถูก track=${envTracked}` }
    },
  },
  {
    part: 'break', name: 'Supabase หลับ: tools/menu-fallback.mjs สร้าง web/public/menu-fallback.json ตรงกับ data/menu.csv และ seed_settings.sql (รันซ้ำได้ไฟล์เดิม) · เว็บ build แล้วเมื่อทุกคำขอไป Supabase ถูกตัด หน้าแรกยังเห็นเมนู ราคา และชื่อร้าน',
    run: async () => {
      if (!exists('tools/menu-fallback.mjs')) return { ok: false, hint: 'ยังไม่มี tools/menu-fallback.mjs' }
      const g = sh('node', ['tools/menu-fallback.mjs']); if (g.status !== 0) return { ok: false, hint: `menu-fallback.mjs exit ${g.status}: ${(g.stdout + g.stderr).slice(-200)}` }
      const before = read('web/public/menu-fallback.json'); const g2 = sh('node', ['tools/menu-fallback.mjs']); const same = read('web/public/menu-fallback.json') === before && g2.status === 0
      let j; try { j = JSON.parse(before) } catch { return { ok: false, hint: 'menu-fallback.json ไม่ใช่ JSON' } }
      const m = csv('data/menu.csv'); const jm = j.menu ?? []
      const menuOk = jm.length === m.length && m.every((r, i) => jm[i]?.name === r.name && Number(jm[i]?.price) === Number(r.price))
      const shopOk = j.shop?.shop_name === 'Story Cafe' && typeof j.shop?.open_time === 'string' && typeof j.shop?.phone === 'string'
      const e = env(); const b = sh('npm', ['run', 'build', '--silent'], { cwd: join(root, 'web'), env: { ...process.env, SUPABASE_URL: e.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: e.SUPABASE_PUBLISHABLE_KEY }, timeout: 170000 })
      if (b.status !== 0) return { ok: false, hint: `web build ไม่ผ่าน: ${(b.stdout + b.stderr).slice(-250)}` }
      const { chromium } = await import('playwright'); const srv = await serveDir(join(root, 'web/dist')); const br = await chromium.launch()
      try {
        const page = await br.newPage(); const origin = new URL(e.SUPABASE_URL).origin
        await page.route(`${origin}/**`, (r) => r.abort()); await page.goto(srv.url); await page.waitForTimeout(2500)
        const txt = await page.evaluate(() => document.body.innerText)
        const seen = { ลาเต้: txt.includes('ลาเต้'), ราคา75: /75/.test(txt), ชื่อร้าน: txt.includes('Story Cafe'), เวลาเปิด: /07:30/.test(txt) }
        return { ok: same && menuOk && shopOk && Object.values(seen).every(Boolean), hint: `รันซ้ำได้ไฟล์เดิม=${same} · เมนูตรง CSV=${menuOk} · shop ครบ=${shopOk} · หน้าเว็บตอนตัด Supabase เห็น ${JSON.stringify(seen)}` }
      } finally { await br.close(); srv.close() }
    },
  },
  {
    part: 'break', name: 'tools/backup.sh: ได้ไฟล์ .sql ในโฟลเดอร์ที่กำหนด (CAFE_BACKUP_DIR) มีตาราง menu_items กับ settings · เส้นทางไฟล์เป็นบรรทัดสุดท้าย · ไฟล์สิทธิ์ 600 · ไม่พิมพ์รหัสผ่าน/key · backups/ อยู่ใน .gitignore',
    run: () => {
      const n = need(); if (n) return n
      if (!exists('tools/backup.sh')) return { ok: false, hint: 'ยังไม่มี tools/backup.sh' }
      const d = mkdtempSync(join(tmpdir(), 'cafe-bk-'))
      try {
        const r = sh('bash', ['tools/backup.sh'], { env: { ...process.env, CAFE_BACKUP_DIR: d } })
        const f = r.stdout.trim().split('\n').pop()?.trim() ?? ''
        const okFile = r.status === 0 && /\.sql$/.test(f) && existsSync(f) && f.startsWith(d)
        const body = okFile ? readFileSync(f, 'utf8') : ''
        const mode = okFile ? (statSync(f).mode & 0o777).toString(8) : '-'
        const leak = /sb_secret_|postgres:\/\/|PGPASSWORD|password/i.test(r.stdout + r.stderr)
        return { ok: okFile && /menu_items/.test(body) && /settings/.test(body) && body.length > 2000 && mode === '600' && !leak && /^backups\/?$/m.test(read('.gitignore')), hint: `exit ${r.status} · ไฟล์=${f.slice(-60)} · มี menu_items/settings=${/menu_items/.test(body)}/${/settings/.test(body)} · ขนาด ${body.length} · สิทธิ์ ${mode} · พิมพ์ความลับ=${leak} · .gitignore backups=${/^backups\/?$/m.test(read('.gitignore'))} ${r.stderr.slice(-100)}` }
      } finally { rmSync(d, { recursive: true, force: true }) }
    },
  },
  {
    part: 'break', name: 'tools/restore-check.sh: กู้ไฟล์สำรองลงฐานชั่วคราว เทียบแถวทุกตารางตรง → exit 0 · มีคนเพิ่มแถวในฐานจริงหลังสำรอง → exit 1 และบอกชื่อตาราง · ฐานชั่วคราวถูกลบทุกกรณี',
    run: () => {
      const n = need(); if (n) return n
      if (!exists('tools/restore-check.sh') || !exists('tools/backup.sh')) return { ok: false, hint: 'ต้องมี tools/backup.sh และ tools/restore-check.sh' }
      const d = mkdtempSync(join(tmpdir(), 'cafe-bk-'))
      try {
        const b = sh('bash', ['tools/backup.sh'], { env: { ...process.env, CAFE_BACKUP_DIR: d } }); const f = b.stdout.trim().split('\n').pop()?.trim()
        if (b.status !== 0 || !f) return { ok: false, hint: `backup.sh ไม่ผ่าน: ${(b.stdout + b.stderr).slice(-150)}` }
        const good = sh('bash', ['tools/restore-check.sh', f], { timeout: 600000 })
        sql("insert into settings(key,value,is_public) values ('zz_restore_probe','1'::jsonb,false)")
        const bad = sh('bash', ['tools/restore-check.sh', f], { timeout: 600000 })
        sql("delete from settings where key='zz_restore_probe'")
        const left = rows("select datname from pg_database where datname like 'restore_check%'") ?? []
        return { ok: good.status === 0 && thai.test(good.stdout) && bad.status === 1 && /settings/.test(bad.stdout + bad.stderr) && !left.length, hint: `ตรงกัน: exit ${good.status} · มีแถวเพิ่ม: exit ${bad.status} ระบุ settings=${/settings/.test(bad.stdout + bad.stderr)} · ฐานชั่วคราวที่ค้าง=${left.length} ${good.status !== 0 ? (good.stdout + good.stderr).slice(-200) : ''}` }
      } finally { sql("delete from settings where key='zz_restore_probe'"); rmSync(d, { recursive: true, force: true }) }
    },
  },
  {
    part: 'break', name: 'tools/usage-check.mjs: ใช้ลิมิตจาก data/free-tier.json (ไม่ฝังตัวเลขในโค้ด) · 100 MB = ปกติ exit 0 · 450 MB = ใกล้เต็ม exit 1 · 520 MB = เต็มแล้ว exit 1 · ข้อความไทยพร้อมเปอร์เซ็นต์',
    run: () => {
      if (!exists('tools/usage-check.mjs')) return { ok: false, hint: 'ยังไม่มี tools/usage-check.mjs' }
      const lim = JSON.parse(read('data/free-tier.json')); const mb = (x) => String(Math.round(x * 1024 * 1024))
      const go = (x) => sh('node', ['tools/usage-check.mjs'], { env: { ...process.env, CAFE_FAKE_DB_BYTES: mb(x) } })
      const a = go(100), b = go(450), c = go(520)
      const src = read('tools/usage-check.mjs').replace(/\/\/.*$/gm, ''); const hard = /(?<![\w.])500(?![\w.])/.test(src) || /(?<![\w.])50000(?![\w.])/.test(src)
      const ok = lim.db_mb === 500 && a.status === 0 && /ปกติ/.test(a.stdout) && /20(\.\d+)?\s*%/.test(a.stdout) && b.status === 1 && /ใกล้เต็ม/.test(b.stdout) && c.status === 1 && /เต็มแล้ว/.test(c.stdout) && /500\s*MB/.test(a.stdout) && !hard
      return { ok, hint: `100MB: exit ${a.status} "${a.stdout.trim().slice(0, 80)}" · 450MB: exit ${b.status} ใกล้เต็ม=${/ใกล้เต็ม/.test(b.stdout)} · 520MB: exit ${c.status} เต็มแล้ว=${/เต็มแล้ว/.test(c.stdout)} · ฝังตัวเลขในโค้ด=${hard}` }
    },
  },
  {
    part: 'break', name: 'docs/runbook.md: หัวข้อ Supabase หลับ/ล่ม · ลิมิตของแผนฟรี · สำรองและกู้คืน · ถ้าข้อมูลหลุด · ตัวเลขตรง data/free-tier.json (500 MB, 50,000, 1 GB, 5 GB, 7 วัน) พร้อมลิงก์เอกสารทางการ · พูดถึง POS offline และ menu-fallback · ติดป้าย [ตรวจหลังสมัคร]',
    run: () => {
      const t = read('docs/runbook.md'); if (!t) return { ok: false, hint: 'ยังไม่มี docs/runbook.md' }
      const need_ = { 'หัวข้อหลับ/ล่ม': /^#+.*(หลับ|ล่ม)/m.test(t), 'หัวข้อลิมิต': /^#+.*ลิมิต/m.test(t), 'หัวข้อสำรอง/กู้คืน': /^#+.*(สำรอง|กู้คืน)/m.test(t), 'หัวข้อข้อมูลหลุด': /^#+.*หลุด/m.test(t), '500 MB': /500\s*MB/.test(t), '50,000': /50,?000/.test(t), '1 GB': /1\s*GB/.test(t), '5 GB': /5\s*GB/.test(t), '7 วัน': /7\s*วัน/.test(t), 'ลิงก์ billing': t.includes('https://supabase.com/docs/guides/platform/billing-on-supabase'), 'ลิงก์ backups': t.includes('https://supabase.com/docs/guides/platform/backups'), 'POS offline': /offline|ออฟไลน์/i.test(t), 'menu-fallback': t.includes('menu-fallback'), 'ตรวจหลังสมัคร': t.includes('[ตรวจหลังสมัคร]') }
      const bad = Object.entries(need_).filter(([, v]) => !v).map(([k]) => k)
      return { ok: !bad.length, hint: bad.length ? `ขาด: ${bad.join(', ')}` : '' }
    },
  },
  {
    part: 'extra', name: 'สูตรของคุณเอง: mine/recipe.md ตามโครงสูตร (frontmatter ครบ, win ≤ 3 นาที, prompt 1 + prompt 2 ในบล็อก text ≥ 80 ตัวอักษร, รู้ทันสูตร ≥ 2 ข้อ, ตรวจ) ไม่ใช่แม่แบบที่ยังไม่ได้แก้ · ไม่มีความลับ · node mine/check.mjs ผ่าน',
    run: () => {
      const t = read('mine/recipe.md'); if (!t) return { ok: false, hint: 'ยังไม่มี mine/recipe.md (เริ่มจาก templates/recipe-template.md)' }
      const f = fm(t); if (!f) return { ok: false, hint: 'ไฟล์ต้องขึ้นต้นด้วย frontmatter --- ... ---' }
      const tpl = read('templates/recipe-template.md')
      const blocks = (h) => { const m = t.match(new RegExp(`## ${h}[^\\n]*\\n+\`\`\`text\\n([\\s\\S]*?)\\n\`\`\``)); return m?.[1] ?? '' }
      const p1 = blocks('prompt 1 ·'), p2 = blocks('prompt 2 ·')
      const know = (t.match(/## รู้ทันสูตร\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '').split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length
      const placeholders = /\(prompt ที่ copy|\(prompt ที่ทำให้|ชื่อสูตรของคุณ|ตั้งรหัสเอง|สิ่งที่ผู้ใช้เห็นเป็นผลแรก/.test(t)
      const fmOk = f.schema === '1' && /^[a-z0-9-]+$/.test(f.id ?? '') && (f.title ?? '').length > 0 && (f.title ?? '').length <= 90 && (f.win ?? '').length >= 10 && Number(f.win_minutes) > 0 && Number(f.win_minutes) <= 3 && (f.start ?? '').length > 0 && /^node mine\/check\.mjs/.test(f.check ?? '') && f.level === 'write' && /^\d+\.\d+\.\d+$/.test(f.min_claude_code ?? '')
      const secret = SECRET_RE.some((re) => re.test(t)) || /sk_test_[A-Za-z0-9]{10,}/.test(t)
      const chk = exists('mine/check.mjs') ? sh('node', ['mine/check.mjs'], { timeout: 120000 }) : { status: -1, stdout: '', stderr: 'ไม่มี mine/check.mjs' }
      return { ok: fmOk && p1.length >= 80 && p2.length >= 80 && know >= 2 && /## ตรวจ/.test(t) && !placeholders && t !== tpl && !secret && chk.status === 0, hint: `frontmatter ถูก=${fmOk} (${JSON.stringify(f).slice(0, 140)}) · prompt1 ${p1.length} ตัว · prompt2 ${p2.length} ตัว · รู้ทัน ${know} ข้อ · ยังมีข้อความแม่แบบ=${placeholders} · ความลับ=${secret} · mine/check.mjs exit ${chk.status} ${(chk.stdout + chk.stderr).slice(-100)}` }
    },
  },
  {
    part: 'extra', name: 'ทั้งระบบต่อกันได้: node tools/e2e/run.mjs ผ่านทุกขั้น (พรีออเดอร์ → LINE → จ่ายเงิน → POS ไม่ซ้ำ → ยอดเจ้าของ → สต็อก → สำรอง/กู้คืน → rls_audit ว่าง)',
    run: () => {
      const n = need(); if (n) return n
      if (!exists('tools/e2e/run.mjs')) return { ok: false, hint: 'ไม่มี tools/e2e/run.mjs' }
      const r = sh('node', ['--import', 'tsx', 'tools/e2e/run.mjs', '--json'], { timeout: 900000 })
      let res; try { res = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { return { ok: false, hint: `อ่านผล e2e ไม่ได้: ${(r.stdout + r.stderr).slice(-250)}` } }
      const bad = res.filter((x) => !x.ok)
      return { ok: !bad.length && res.length >= 9, hint: bad.map((x) => `✗ ${x.name}: ${x.hint}`).join(' | ') || `${res.length} ขั้นผ่าน` }
    },
  },
]
