// อ่านเมนูจากไฟล์ Excel ของร้าน (แถวแรกเป็นหัวตาราง: หมวด | รายการ | ราคา) → รายการเมนู
// ตั้งใจให้เข้มงวด: เจอข้อมูลที่ไม่เข้าใจให้หยุดและบอกว่าผิดที่แถวไหน ไม่เดาเอง
import ExcelJS from 'exceljs'

export type MenuRow = { category: string; name: string; price: number; isDrink: boolean }

const BAKERY = 'เบเกอรี่'

export function parsePrice(raw: unknown, rowNo: number): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw
  if (typeof raw === 'string') {
    // รับ: 75 · 65.00 · ฿75.- · 85 บาท (มีช่องว่างหน้าหลังได้) · ไม่รับทศนิยมจริงหรือข้อความอื่น
    const m = raw.trim().match(/^฿?\s*(\d+)(?:\.0+)?\s*(?:\.-|-|บาท|฿)?$/)
    if (m && Number(m[1]) > 0) return Number(m[1])
  }
  throw new Error(`แถว ${rowNo}: ราคา '${String(raw)}' ไม่ใช่ตัวเลข`)
}

export async function readMenuXlsx(file: string): Promise<MenuRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('ไม่พบแผ่นงานในไฟล์ Excel')
  const rows: MenuRow[] = []
  ws.eachRow({ includeEmpty: true }, (row, rowNo) => {
    if (rowNo === 1) return
    const cells = [1, 2, 3].map((i) => String(row.getCell(i).value ?? '').trim())
    if (cells.every((c) => !c)) return // แถวว่างคั่น
    const category = cells[0]
    const name = String(row.getCell(2).value ?? '').trim()
    if (!category || !name) throw new Error(`แถว ${rowNo}: ไม่มีหมวดหรือชื่อรายการ`)
    rows.push({ category, name, price: parsePrice(row.getCell(3).value, rowNo), isDrink: category !== BAKERY })
  })
  return rows
}

export function toCsv(rows: MenuRow[]): string {
  const lines = ['category,name,price,is_drink', ...rows.map((r) => `${r.category},${r.name},${r.price},${r.isDrink ? 1 : 0}`)]
  return lines.join('\n') + '\n'
}
