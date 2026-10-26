// `claude` จำลอง (ไม่มีโมเดล ไม่เรียกเน็ต) ให้ตัวตรวจทดสอบเครื่องมือที่เรียก `claude -p ... --output-format json --json-schema ...`
// รูปแบบผลลัพธ์เลียนแบบของจริง (Claude Code 2.1.310): JSON เดียวใน stdout มี is_error / result / structured_output / total_cost_usd
// env: FAKE_CLAUDE_MODE = ok | bad_then_ok | always_bad | wrong_price | login | garbage · โปสเตอร์: poster_bad | poster_xss | poster_long · FAKE_CLAUDE_COST = ค่าใช้จ่ายต่อครั้งในผล JSON (ค่าเริ่มต้น 0.05) · FAKE_CLAUDE_LOG = ไฟล์ที่บันทึกทุกครั้งที่ถูกเรียก (1 บรรทัด JSON ต่อครั้ง)
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok'
const log = process.env.FAKE_CLAUDE_LOG
const val = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)
const prompt = val('-p') ?? ''
const schemaText = val('--json-schema')
let schema = null
try { schema = schemaText ? JSON.parse(schemaText) : null } catch { /* schema ไม่ใช่ JSON */ }
const calls = log && existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0
if (log) appendFileSync(log, `${JSON.stringify({ args, prompt, schemaOk: !!schema, n: calls + 1, cwd: process.cwd() })}\n`)

const out = (body, code = 0) => { process.stdout.write(`${JSON.stringify({ type: 'result', subtype: body.is_error ? 'error' : 'success', num_turns: 2, total_cost_usd: Number(process.env.FAKE_CLAUDE_COST ?? 0.05), ...body })}\n`); process.exit(code) }
if (mode === 'login') out({ is_error: true, result: 'Not logged in · Please run /login' }, 1)
if (mode === 'garbage') { process.stdout.write('นี่ไม่ใช่ JSON\n'); process.exit(0) }

const seasonal = existsSync('data/seasonal.json') ? JSON.parse(readFileSync('data/seasonal.json', 'utf8')) : { items: [{ name: 'ลาเต้ส้มยูซุ', price: 98 }, { name: 'ชาไทยโอ๊ตร้อน', price: 78 }, { name: 'ครัวซองต์อัลมอนด์', price: 89 }] }
const it = seasonal.items
const good = {
  captions: [
    { platform: 'instagram', text: `${it[0].name} แก้วใหม่ของหน้าฝน เปรี้ยวหวานสดชื่น แก้วละ ${it[0].price} บาท แวะมาลองที่ร้านได้เลย`, hashtags: ['#StoryCafe', '#เมนูใหม่', '#ลาเต้ส้มยูซุ', '#คาเฟ่'] },
    { platform: 'tiktok', text: `ฝนตกแบบนี้ต้อง ${it[1].name} อุ่น ๆ สักแก้ว ราคา ${it[1].price} บาท ตามมาดูกัน`, hashtags: ['#คาเฟ่', '#เมนูหน้าฝน', '#ชาไทย'] },
    { platform: 'instagram', text: `คู่กับ ${it[2].name} อบใหม่ทุกเช้า กรอบนอกนุ่มใน ชิ้นละ ${it[2].price} บาท วันนี้มีให้ทั้งวัน`, hashtags: ['#เบเกอรี่', '#ครัวซองต์', '#StoryCafe'] },
  ],
}
const bad = { captions: [{ platform: 'instagram', text: 'สั้น', hashtags: ['ไม่มีชาร์ป'] }] }
const wrongPrice = { captions: good.captions.map((c, i) => (i === 0 ? { ...c, text: `${it[0].name} ลดเหลือ 50 บาทวันนี้วันเดียว แวะมาลองที่ร้านได้เลยนะคะ` } : c)) }
const posterCopy = { headline: `เมนูใหม่ ${seasonal.season ?? ''}`.trim(), subline: 'อุ่นใจทุกแก้วที่ Story Cafe', items: it.map((x) => ({ name: x.name, blurb: x.note ?? 'ลองสักแก้ว' })), footer: 'Story Cafe · เปิด 07:30–17:00' }

const want = schema?.properties?.captions ? 'captions' : schema?.properties?.headline ? 'poster' : 'other'
const n = calls + 1
let body
if (want === 'poster') {
  body = posterCopy
  if (mode === 'poster_bad') body = { ...posterCopy, items: [{ name: 'เมนูที่ไม่มีในร้าน', blurb: 'ลอง' }, ...posterCopy.items.slice(0, 1)] }
  if (mode === 'poster_xss') body = { ...posterCopy, headline: '<script>alert(1)</script>เมนูใหม่', items: posterCopy.items.map((x, i) => (i ? x : { ...x, blurb: '<img src=x onerror=alert(2)> อร่อย' })) }
  if (mode === 'poster_long') body = { ...posterCopy, headline: 'เมนูใหม่หน้าฝนที่อร่อยที่สุดในโลกและต้องมาลองให้ได้ก่อนที่จะหมดฤดู '.repeat(4) }
}
else if (mode === 'always_bad') body = bad
else if (mode === 'bad_then_ok') body = n % 2 === 1 ? bad : good
else if (mode === 'wrong_price') body = wrongPrice
else body = good
out({ result: JSON.stringify(body), structured_output: body })
