import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Page } from 'playwright'
import { addSpend, bangkokDate, buildPrompt, cacheKey, checkBudget, currentSpend, fillTemplate, formatUsd, parseArgs, SCHEMA, validateCopy, type Limits, type PosterCopy, type Seasonal } from './poster.ts'

// เรียกไม่ได้ / ยังไม่ล็อกอิน / ตอบไม่ใช่ JSON ที่ใช้ได้
class CallError extends Error {}

function runClaude(bin: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => rej(new CallError('spawn')))
    child.on('close', (code) => (code === 0 ? res(out) : rej(new CallError(`exit ${code}`))))
  })
}

async function askModel(bin: string, prompt: string, maxUsd: number): Promise<{ copy: PosterCopy; cost: number }> {
  const raw = await runClaude(bin, ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--max-budget-usd', String(maxUsd)])
  let parsed: { is_error?: boolean; structured_output?: PosterCopy; total_cost_usd?: number }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CallError('not json')
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.is_error || !parsed.structured_output) throw new CallError('error result')
  return { copy: parsed.structured_output, cost: Number(parsed.total_cost_usd ?? 0) }
}

// ตรวจใน DOM ว่าข้อความไม่ล้นกรอบและฟอนต์ Kanit โหลดจริง คืนรายการข้อที่ผิด (ว่าง = ผ่าน)
async function inspectPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = 1080
    const H = 1350
    const problems: string[] = []
    const targets: [string, Element][] = [
      ['หัวเรื่อง', document.querySelector('#headline')!],
      ['บรรทัดรอง', document.querySelector('#subline')!],
      ['ท้ายโปสเตอร์', document.querySelector('#footer')!],
      ...[...document.querySelectorAll('#items li')].map((el, i): [string, Element] => [`เมนูที่ ${i + 1}`, el]),
    ]
    for (const [label, el] of targets) {
      const r = el.getBoundingClientRect()
      if (r.left < 0 || r.top < 0 || r.right > W || r.bottom > H) problems.push(`${label} ออกนอกกรอบภาพ`)
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`${label} ข้อความล้นกรอบ`)
    }
    if (document.documentElement.scrollHeight > H || document.documentElement.scrollWidth > W) problems.push('เนื้อหายาวเกินขนาดภาพ 1080×1350')
    const kanit = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Kanit' && f.status === 'loaded')
    if (!kanit || !document.fonts.check("600 20px 'Kanit'")) problems.push('ฟอนต์ Kanit โหลดไม่สำเร็จ')
    return problems
  })
}

// คืนรายการข้อที่ตรวจไม่ผ่าน (ถ้าไม่ว่างจะไม่เขียนไฟล์ PNG เลย)
async function render(htmlFile: string, outFile: string): Promise<string[]> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } })
    await page.goto(pathToFileURL(htmlFile).href)
    await page.evaluate(() => document.fonts.ready)
    const problems = await inspectPage(page)
    if (problems.length === 0) await page.screenshot({ path: outFile })
    return problems
  } finally {
    await browser.close()
  }
}

async function main(): Promise<number> {
  const { theme, out, force } = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const seasonal = JSON.parse(await readFile('data/seasonal.json', 'utf8')) as Seasonal
  const limits = JSON.parse(await readFile('data/ai-limits.json', 'utf8')) as Limits
  const template = await readFile('tools/poster/template.html', 'utf8')

  const state = process.env.CAFE_STATE_DIR || '.cafe'
  const prompt = buildPrompt(seasonal, theme)
  const cacheFile = `${state}/poster-cache/${cacheKey(seasonal, theme, prompt)}.json`
  let copy: PosterCopy | undefined
  let note = ''
  if (!force) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
      if (validateCopy(cached, seasonal).length === 0) copy = cached
    } catch {
      /* ไม่มี cache หรืออ่านไม่ได้ */
    }
  }
  if (copy) note = 'จาก cache'
  else {
    const spendFile = `${state}/spend.json`
    const today = bangkokDate()
    let raw: unknown = null
    try {
      raw = JSON.parse(await readFile(spendFile, 'utf8'))
    } catch {
      /* ยังไม่มี state */
    }
    const spend = currentSpend(raw, today)
    const blocked = checkBudget(spend, limits)
    if (blocked) {
      console.error(blocked)
      return 3
    }
    let result: { copy: PosterCopy; cost: number }
    try {
      result = await askModel(process.env.CLAUDE_BIN || 'claude', prompt, limits.max_usd_per_call)
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      console.error('เรียกตัวช่วยเขียนข้อความโปสเตอร์ไม่ได้ หรือยังไม่ได้ล็อกอิน: เปิด claude แล้วพิมพ์ /login จากนั้นรันใหม่')
      return 2
    }
    // นับค่าใช้จ่ายทันทีที่เรียกสำเร็จ แม้ผลจะไม่ผ่านการตรวจ (เงินถูกใช้ไปแล้ว)
    await mkdir(state, { recursive: true })
    await writeFile(`${spendFile}.tmp`, JSON.stringify(addSpend(spend, result.cost)) + '\n', 'utf8')
    await rename(`${spendFile}.tmp`, spendFile)
    const errors = validateCopy(result.copy, seasonal)
    if (errors.length > 0) {
      console.error('ผลจากโมเดลไม่ผ่านการตรวจ จึงไม่สร้างไฟล์โปสเตอร์ ข้อที่ผิด:')
      for (const e of errors) console.error(`- ${e}`)
      return 1
    }
    copy = result.copy
    note = `โมเดล 1 ครั้ง · ${formatUsd(result.cost)}`
    await mkdir(`${state}/poster-cache`, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(copy, null, 2) + '\n', 'utf8')
  }

  const outFile = resolve(out)
  const htmlFile = outFile.replace(/\.png$/i, '') + '.html'
  const html = fillTemplate(template, seasonal, copy, root)
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(htmlFile, html, 'utf8')
  let problems: string[]
  try {
    problems = await render(htmlFile, outFile)
  } catch {
    console.error('วาดภาพไม่ได้: ตรวจว่าติดตั้ง Chromium แล้ว (รัน npx playwright install chromium)')
    return 5
  }
  if (problems.length > 0) {
    console.error('ภาพโปสเตอร์ไม่ผ่านการตรวจ จึงไม่สร้างไฟล์ PNG ข้อที่ผิด:')
    for (const p of problems) console.error(`- ${p}`)
    console.error('ลองรันใหม่ด้วย --force หรือเปลี่ยน --theme เพื่อให้โมเดลเขียนข้อความสั้นลง')
    return 4
  }
  console.log(`โปสเตอร์ → ${out} (${note})`)
  return 0
}

process.exitCode = await main()
