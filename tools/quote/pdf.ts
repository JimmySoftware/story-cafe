// วาดใบเสนอราคาเป็น PDF ภาษาไทย (ฟอนต์ Sarabun/Kanit ในโฟลเดอร์ fonts/) — รับ Quote ที่คำนวณแล้ว ไม่คิดเงินเอง
import PDFDocument from 'pdfkit'
import { createWriteStream } from 'node:fs'
import type { Order, Quote } from './types.ts'
import type { Shop } from './catalog.ts'

const baht = (n: number) => n.toLocaleString('en-US')

export function writeQuotePdf(file: string, number: string, shop: Shop, order: Order, q: Quote): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const out = createWriteStream(file)
    doc.pipe(out)
    doc.registerFont('r', 'fonts/Sarabun-Regular.ttf').registerFont('b', 'fonts/Sarabun-Bold.ttf')
    doc.font('b').fontSize(22).fillColor('#4b5a2a').text(shop.name)
    doc.font('r').fontSize(11).fillColor('#555').text(`${shop.tagline} · เปิด ${shop.open} · โทร ${shop.phone}`)
    doc.moveDown(1).font('b').fontSize(18).fillColor('#000').text('ใบเสนอราคา Coffee Break')
    doc.font('r').fontSize(12).text(`เลขที่ ${number}   วันที่ ${order.date}   (ยืนราคา 7 วัน)`)
    doc.text(`เรียน ${order.customer}`).moveDown(0.8)
    const x = [50, 300, 360, 450]
    let y = doc.y
    doc.font('b').text('รายการ', x[0], y).text('จำนวน', x[1], y).text('ราคา/หน่วย', x[2], y).text('รวม', x[3], y)
    doc.moveTo(50, y + 18).lineTo(545, y + 18).stroke('#999')
    y += 26
    doc.font('r')
    for (const l of q.lines) {
      doc.text(l.item, x[0], y, { width: 240 }).text(String(l.qty), x[1], y).text(baht(l.unitPrice), x[2], y).text(baht(l.amount), x[3], y)
      y += 20
    }
    doc.moveTo(50, y).lineTo(545, y).stroke('#999')
    y += 10
    const row = (label: string, v: string, bold = false) => { doc.font(bold ? 'b' : 'r').text(label, x[0], y).text(v, x[3], y); y += 20 }
    row('รวมก่อนลด', baht(q.subtotal))
    if (q.discount > 0) row(`ส่วนลดเครื่องดื่ม ${q.discountPercent}% (${q.cups} แก้ว)`, `-${baht(q.discount)}`)
    row(order.delivery ? 'ค่าจัดส่ง' : 'รับที่ร้าน', q.delivery === 0 ? 'ฟรี' : baht(q.delivery))
    row('ยอดสุทธิ (บาท)', baht(q.total), true)
    doc.font('r').fontSize(10).fillColor('#666').text('ราคานี้ยังไม่รวมภาษีมูลค่าเพิ่ม · ข้อมูลร้านและราคาเป็นข้อมูลสมมติสำหรับการเรียน', 50, y + 20)
    doc.end()
    out.on('finish', () => resolve())
    out.on('error', reject)
  })
}
