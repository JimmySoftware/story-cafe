// npm run quote -- orders/xxx.json → out/QT-YYYYMMDD-NNN.pdf
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { loadCatalog, loadShop } from './catalog.ts'
import { computeQuote } from './pricing.ts'
import { writeQuotePdf } from './pdf.ts'
import type { Order } from './types.ts'

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('วิธีใช้: npm run quote -- orders/ชื่อไฟล์.json')
  let order: Order
  try {
    order = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`อ่านไฟล์คำขอ ${file} ไม่ได้ (ไม่พบไฟล์หรือรูปแบบ JSON ไม่ถูกต้อง)`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.date ?? '')) throw new Error('วันที่ในคำขอต้องอยู่ในรูปแบบ YYYY-MM-DD')
  const quote = computeQuote(order, loadCatalog())
  mkdirSync('out', { recursive: true })
  const prefix = `QT-${order.date.replaceAll('-', '')}-`
  const used = readdirSync('out').filter((f) => f.startsWith(prefix) && f.endsWith('.pdf')).length
  const number = prefix + String(used + 1).padStart(3, '0')
  const pdf = `out/${number}.pdf`
  await writeQuotePdf(pdf, number, await loadShop(), order, quote)
  console.log(`ยอดสุทธิ ${quote.total.toLocaleString('en-US')} บาท → ${pdf}`)
}

main().catch((e) => {
  console.error(`ผิดพลาด: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
