import { exists, read, lines, run, walk } from './lib.mjs'
import { statSync } from 'node:fs'
import { join } from 'node:path'

const stripJsonc = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1')
const wrangler = () => { try { return JSON.parse(stripJsonc(read('web/wrangler.jsonc'))) } catch { return null } }
const pkg = () => { try { return JSON.parse(read('web/package.json')) } catch { return {} } }
const mtime = (p) => (exists(p) ? statSync(p).mtimeMs : 0)

export const checks = [
  {
    part: 'win', name: 'web/wrangler.jsonc ตั้งค่าถูก: name, compatibility_date, assets ./dist, single-page-application',
    run: () => {
      const w = wrangler()
      if (!w) return { ok: false, hint: 'ไม่มี web/wrangler.jsonc หรืออ่านไม่ได้' }
      const dir = String(w.assets?.directory ?? '').replace(/^\.\//, '')
      const ok = typeof w.name === 'string' && w.name === 'story-cafe' && /^\d{4}-\d{2}-\d{2}$/.test(w.compatibility_date ?? '') && dir === 'dist' && w.assets?.not_found_handling === 'single-page-application'
      return { ok, hint: 'ต้องมี name "story-cafe", compatibility_date, assets.directory "./dist" และ not_found_handling "single-page-application"' }
    },
  },
  {
    part: 'win', name: 'web/package.json: มี wrangler (devDependency) และสคริปต์ deploy',
    run: () => { const p = pkg(); return { ok: !!p.devDependencies?.wrangler && /wrangler deploy/.test(p.scripts?.deploy ?? '') && /build/.test(p.scripts?.deploy ?? ''), hint: 'ต้องมี wrangler ใน devDependencies และสคริปต์ deploy ที่ build แล้ว wrangler deploy' } },
  },
  { part: 'win', name: 'build แล้ว (web/dist/index.html ใหม่กว่าไฟล์ในโฟลเดอร์ src)', run: () => ({ ok: exists('web/dist/index.html') && mtime('web/dist/index.html') >= Math.max(...walk('web/src').map((p) => mtime(p)), 0) - 1000, hint: 'ยังไม่ได้ build หรือ build เก่ากว่าไฟล์ที่แก้ — รัน cd web && npm run build' }) },
  {
    part: 'win', name: 'npx wrangler deploy --dry-run ผ่าน (ไม่ล็อกอิน ไม่ส่งอะไรขึ้นเน็ต)',
    run: () => {
      if (!wrangler() || !pkg().devDependencies?.wrangler || !exists('web/dist/index.html')) return { ok: false, hint: 'ต้องผ่านข้อก่อนหน้าก่อน' }
      const r = run('npx', ['--no-install', 'wrangler', 'deploy', '--dry-run'], { cwd: join(process.cwd(), 'web') })
      return { ok: r.ok && /Total Upload/.test(r.out), hint: r.out.split('\n').filter((l) => /error|ERROR|✘/.test(l)).slice(0, 2).join(' | ') || 'dry-run ไม่ผ่าน' }
    },
  },
  {
    part: 'win', name: 'ไม่มีความลับในไฟล์ (ไม่มี token ของ Cloudflare, ไม่มี service_role)',
    run: () => {
      const files = [...walk('web', ['node_modules', 'dist', '.wrangler']), ...walk('docs')].filter((p) => /\.(jsonc?|ts|tsx|md|html|toml|env|txt)$/.test(p))
      const bad = files.filter((p) => /CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}|service_role|cfut_[A-Za-z0-9]{10,}/.test(read(p)))
      return { ok: bad.length === 0 && !/token|secret|password|api_key/i.test(stripJsonc(read('web/wrangler.jsonc')) /* a comment that warns "no API token here" is good practice: judge only keys and values */), hint: `พบข้อความที่ดูเหมือนความลับใน: ${bad.join(', ') || 'web/wrangler.jsonc'}` }
    },
  },
  {
    part: 'win', name: 'web/dist และ .wrangler ไม่เข้า git (build ใหม่ได้ทุกครั้ง)',
    run: () => { const t = run('git', ['ls-files']).out.split('\n'); const bad = t.filter((f) => f.startsWith('web/dist/') || f.includes('.wrangler/')); return { ok: bad.length === 0 && /dist/.test(read('.gitignore')) && /\.wrangler/.test(read('.gitignore')), hint: bad.length ? `ไฟล์ที่ไม่ควรเข้า git: ${bad.slice(0, 3).join(', ')}` : '.gitignore ต้องกัน dist และ .wrangler' } },
  },
  {
    part: 'break', name: 'มีรายงานตรวจหน้าจอ docs/responsive-check.md (375 / 768 / 1280)',
    run: () => { const t = read('docs/responsive-check.md'); return { ok: lines('docs/responsive-check.md').filter((l) => l.trim()).length >= 5 && /375/.test(t) && /768/.test(t) && /1280/.test(t), hint: 'รายงานต้องบอกผลที่ 375, 768 และ 1280 px' } },
  },
  {
    part: 'break', name: 'ไม่มีอะไรกว้างตายตัวเกินจอมือถือ (ไม่มี min-width/width แบบ px เกิน 400 นอก media query)',
    run: () => {
      const files = ['web/index.html', ...walk('web/src').filter((p) => /\.(css|tsx)$/.test(p))]
      const bad = []
      for (const f of files) {
        const t = read(f).replace(/@media[^{]*\{/g, '{').replace(/\bmax-width\s*:\s*\d+px/g, '')
        for (const m of t.matchAll(/(?<![\w-])(?:min-)?width\s*:\s*(\d+)px/g)) if (Number(m[1]) > 400) bad.push(`${f}: ${m[0]}`)
      }
      return { ok: bad.length === 0, hint: `เจอความกว้างตายตัว: ${bad.slice(0, 3).join(' | ')}` }
    },
  },
  { part: 'break', name: 'ยังมีแถบโปรโมชันของทีมการตลาดอยู่ (แก้ให้พอดีจอ ไม่ใช่ลบทิ้ง)', run: () => ({ ok: /promo-bar/.test(read('web/index.html')) && /โปรเดือนนี้/.test(read('web/index.html')), hint: 'แถบโปรโมชันใน web/index.html หายไป — ต้องแก้ให้พอดีจอ ไม่ใช่ลบ' }) },
  { part: 'later', name: 'deploy จริงแล้วได้ URL *.workers.dev', run: () => ({ ok: false, skip: true, hint: '[ตรวจหลังสมัคร Cloudflare] รัน npx wrangler login แล้ว npm run deploy ในโฟลเดอร์ web/ แล้วเปิด URL ที่ได้บนมือถือ' }) },
]
