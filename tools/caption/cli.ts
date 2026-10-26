import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { checkAuth } from './auth.ts'
import { validateCaptions, type Seasonal } from './validate.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    captions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['instagram', 'tiktok'] },
          text: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
        },
        required: ['platform', 'text', 'hashtags'],
      },
    },
  },
  required: ['captions'],
}

function parseOut(argv: string[]): string {
  const i = argv.indexOf('--out')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : 'out/captions.json'
}

function buildPrompt(seasonal: Seasonal, errors: string[] = []): string {
  const lines = [
    'เขียน caption ภาษาไทยสำหรับโพสต์เมนูประจำฤดูของร้านกาแฟ จำนวน 3 อัน',
    'มีทั้ง instagram และ tiktok อย่างน้อยอย่างละ 1 อัน',
    '- text ยาว 20–200 ตัวอักษร กล่าวถึงเมนูอย่างน้อย 1 เมนูโดยใช้ชื่อตรงตามข้อมูลเป๊ะ',
    '- hashtags 3–8 อัน ขึ้นต้นด้วย # และไม่มีช่องว่าง',
    '- ถ้าพูดถึงราคา ต้องใช้ราคาตามข้อมูลเท่านั้น ห้ามอ้างเรื่องสุขภาพ (รักษา, ลดน้ำหนัก, ดีต่อสุขภาพ)',
    '',
    'ข้อมูลเมนูประจำฤดู:',
    JSON.stringify(seasonal, null, 2),
  ]
  if (errors.length > 0) {
    lines.push('', 'ครั้งก่อนที่ส่งมาผิดกติกาดังนี้ แก้ให้ถูกทุกข้อ:', ...errors.map((e) => `- ${e}`))
  }
  return lines.join('\n')
}

// ตัวช่วยเรียกไม่ได้ / ยังไม่ล็อกอิน / ตอบไม่ใช่ JSON ที่ใช้ได้
class CallError extends Error {}

function runClaude(bin: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-p', prompt, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => reject(new CallError('spawn')))
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new CallError(`exit ${code}`))))
  })
}

async function askForCaptions(bin: string, prompt: string): Promise<unknown> {
  const raw = await runClaude(bin, prompt)
  let parsed: { is_error?: boolean; structured_output?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CallError('not json')
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.is_error) throw new CallError('error result')
  return parsed.structured_output
}

// ไม่พิมพ์ค่า key ออกมาทุกกรณี บอกแค่โหมดและความถูกต้องของรูปแบบ
function authCheck(): number {
  const { mode, keyOk } = checkAuth(process.env)
  if (mode === 'login') {
    console.log('โหมด login (ล็อกอิน): ใช้ล็อกอินส่วนตัวของคุณกับร้านของคุณเองในเครื่องนี้')
    return 0
  }
  if (keyOk) {
    console.log('โหมด api-key: รูปแบบ API key ใช้ได้ (ตรวจแค่รูปแบบ ไม่ได้ตรวจกับเซิร์ฟเวอร์)')
    return 0
  }
  console.error('โหมด api-key: รูปแบบ API key ใช้ไม่ได้ (คำนำหน้าไม่ถูกต้องหรือสั้นเกินไป) กรุณาตรวจค่า ANTHROPIC_API_KEY')
  return 1
}

async function main(): Promise<number> {
  if (process.argv.includes('--auth-check')) return authCheck()
  const outFile = parseOut(process.argv.slice(2))
  const seasonal = JSON.parse(await readFile('data/seasonal.json', 'utf8')) as Seasonal
  const bin = process.env.CLAUDE_BIN || 'claude'

  let structured: unknown
  let result = { ok: false, errors: [] as string[] }
  try {
    for (let attempt = 0; attempt < 2 && !result.ok; attempt++) {
      structured = await askForCaptions(bin, buildPrompt(seasonal, result.errors))
      result = validateCaptions(structured, seasonal)
    }
  } catch (e) {
    if (!(e instanceof CallError)) throw e
    console.error('เรียกตัวช่วยเขียน caption ไม่ได้ หรือยังไม่ได้ล็อกอิน: เปิด claude แล้วพิมพ์ /login จากนั้นรันใหม่')
    return 2
  }

  if (!result.ok) {
    console.error('ตัวช่วยเขียน caption ส่งผลที่ไม่ผ่านกติกา (ลองใหม่แล้ว 1 ครั้ง) จึงไม่เขียนไฟล์ ข้อที่ผิด:')
    for (const e of result.errors) console.error(`- ${e}`)
    return 1
  }

  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, JSON.stringify(structured, null, 2) + '\n', 'utf8')
  console.log(`สร้าง caption 3 อัน → ${outFile}`)
  return 0
}

process.exitCode = await main()
