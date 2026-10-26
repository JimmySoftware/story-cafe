// ใบเสร็จสำหรับเครื่องพิมพ์ใบเสร็จแคบ — ฟังก์ชันล้วน ตัวเลขทุกตัวมาจาก Bill ที่ computeBill คิดไว้แล้ว
import type { Bill } from './bill.ts'

export const RECEIPT_WIDTH = 32

// สระบน/ล่าง วรรณยุกต์ และเครื่องหมายไทยที่ไม่กินคอลัมน์ (U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E)
const isZeroWidth = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0
  return c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e3a) || (c >= 0x0e47 && c <= 0x0e4e)
}
// สระหน้า (เ แ โ ใ ไ) ต้องอยู่กับพยัญชนะตัวถัดไป ห้ามตัดบรรทัดหลังมัน
const isLeadingVowel = (ch: string): boolean => /[เแโใไ]/.test(ch)

export const textWidth = (s: string): number => [...s].reduce((w, ch) => w + (isZeroWidth(ch) ? 0 : 1), 0)

// แบ่งเป็นกลุ่ม: ตัวอักษรฐาน + เครื่องหมายที่ตามมา (ไม่ตัดกลางกลุ่ม)
const clusters = (s: string): string[] => {
  const out: string[] = []
  for (const ch of s) {
    if (isZeroWidth(ch) && out.length > 0) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

// ตัดคำยาวเกินบรรทัดตามความกว้าง
const hardBreak = (word: string, width: number): string[] => {
  const lines: string[] = []
  let cur = ''
  let curW = 0
  for (const c of clusters(word)) {
    const w = textWidth(c)
    if (curW + w > width && cur !== '' && !isLeadingVowel([...cur].at(-1) ?? '')) {
      lines.push(cur)
      cur = ''
      curW = 0
    }
    cur += c
    curW += w
  }
  if (cur) lines.push(cur)
  return lines
}

// ตัดบรรทัดตามช่องว่างก่อน คำที่ยาวเกินค่อยตัดตามความกว้าง
export const wrap = (text: string, width = RECEIPT_WIDTH): string[] => {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (const piece of textWidth(word) > width ? hardBreak(word, width) : [word]) {
      if (cur === '') cur = piece
      else if (textWidth(cur) + 1 + textWidth(piece) <= width) cur += ` ${piece}`
      else {
        lines.push(cur)
        cur = piece
      }
    }
  }
  if (cur) lines.push(cur)
  return lines
}

const center = (text: string): string[] =>
  wrap(text).map((l) => ' '.repeat(Math.floor((RECEIPT_WIDTH - textWidth(l)) / 2)) + l)

// ซ้าย…ขวา ชิดขอบ · ถ้าไม่พอในบรรทัดเดียว ตัดข้อความซ้ายแล้วใส่ค่าขวาในบรรทัดสุดท้าย
const row = (left: string, right: string): string[] => {
  const pad = RECEIPT_WIDTH - textWidth(left) - textWidth(right)
  if (pad >= 1) return [left + ' '.repeat(pad) + right]
  const parts = wrap(left, RECEIPT_WIDTH - textWidth(right) - 1)
  const last = parts.pop() ?? ''
  return [...parts, last + ' '.repeat(Math.max(1, RECEIPT_WIDTH - textWidth(last) - textWidth(right))) + right]
}

// dd/MM/yyyy HH:mm เวลาไทย (Asia/Bangkok)
const formatThaiTime = (at: string): string => {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) throw new Error(`เวลาของบิล "${at}" อ่านไม่ได้ ให้ใช้รูปแบบ ISO เช่น 2026-10-26T10:00:00+07:00`)
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  )
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

export function renderReceipt(bill: Bill, info: { shop_name: string; bill_no: string; at: string }): string[] {
  const rule = '-'.repeat(RECEIPT_WIDTH)
  const out: string[] = []
  if (info.shop_name.trim()) out.push(...center(info.shop_name))
  out.push(...wrap(info.bill_no), formatThaiTime(info.at), rule)

  for (const l of bill.lines) {
    out.push(...wrap(l.label))
    out.push(...row(`  ${l.qty} × ${l.unit_price}`, String(l.line_total)))
  }
  out.push(rule)
  out.push(...row('รวม', String(bill.subtotal)))
  if (bill.discount > 0) out.push(...row('ส่วนลดจากแต้ม', `-${bill.discount}`))
  out.push(...row('สุทธิ', String(bill.total)))
  if (bill.cash_received !== null) out.push(...row('รับเงิน', String(bill.cash_received)))
  if (bill.change !== null) out.push(...row('เงินทอน', String(bill.change)))
  out.push(...row('แต้มที่ได้', String(bill.points_earned)), rule, ...center('ขอบคุณที่มาอุดหนุน'))
  return out
}
