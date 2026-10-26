// npm run menu -- <ไฟล์.xlsx> [ไฟล์ผลลัพธ์.csv]   (ค่าเริ่มต้นผลลัพธ์ = data/menu.csv)
import { writeFileSync } from 'node:fs'
import { readMenuXlsx, toCsv } from './parse.ts'

const [src, dest = 'data/menu.csv'] = process.argv.slice(2)
if (!src) {
  console.error('ใช้แบบนี้: npm run menu -- data/เมนู-จากร้าน.xlsx')
  process.exit(1)
}
try {
  const rows = await readMenuXlsx(src)
  writeFileSync(dest, toCsv(rows))
  console.log(`อ่านเมนู ${rows.length} รายการ → ${dest}`)
} catch (e) {
  console.error(`ทำต่อไม่ได้: ${(e as Error).message}`)
  process.exit(1)
}
