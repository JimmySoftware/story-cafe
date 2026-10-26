// ส่วนที่เป็นฟังก์ชันล้วนของโปสเตอร์: schema, prompt, escape HTML, กรอก template (ราคามาจาก data/seasonal.json เท่านั้น)
import { createHash } from 'node:crypto'
export type SeasonalItem = { name: string; price: number; note?: string }
export type Seasonal = { shop: string; hours: string; season: string; items: SeasonalItem[] }
export type Limits = { max_calls_per_day: number; max_usd_per_day: number; max_usd_per_call: number }
export type PosterCopy = { headline: string; subline: string; items: { name: string; blurb: string }[]; footer: string }

// ไม่มีฟิลด์ราคา: โมเดลเขียนแต่ข้อความ
export const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    subline: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, blurb: { type: 'string' } },
        required: ['name', 'blurb'],
      },
    },
    footer: { type: 'string' },
  },
  required: ['headline', 'subline', 'items', 'footer'],
}

export function buildPrompt(seasonal: Seasonal, theme?: string): string {
  const menu = seasonal.items.map((i) => ({ name: i.name, note: i.note }))
  const lines = [
    'เขียนข้อความโปสเตอร์เมนูประจำฤดูของร้านกาแฟเป็นภาษาไทย',
    '- headline สั้นกระชับ ไม่เกิน 20 ตัวอักษร · subline หนึ่งประโยคสั้น ๆ · footer บอกชื่อร้านกับเวลาเปิด',
    '- items ต้องมีครบทุกเมนูตามข้อมูล ใช้ชื่อตรงตามข้อมูลเป๊ะ ไม่เพิ่ม ไม่ตัด · blurb หนึ่งประโยคสั้น ๆ',
    '- ห้ามใส่ราคาหรือตัวเลขราคาในข้อความใด ๆ (เครื่องมือจะใส่ราคาเอง) ห้ามอ้างเรื่องสุขภาพ',
    '',
    `ร้าน: ${seasonal.shop} · เวลา: ${seasonal.hours} · ฤดู: ${seasonal.season}`,
    'เมนู:',
    JSON.stringify(menu, null, 2),
  ]
  if (theme) lines.push('', `โจทย์เพิ่มเติม: ${theme}`)
  return lines.join('\n')
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// ชื่อกับราคาของทุกรายการมาจากไฟล์ ส่วน blurb มาจากโมเดล (จับคู่ตามชื่อ ถ้าไม่เจอใช้ note จากไฟล์)
export function renderItems(seasonal: Seasonal, copy: PosterCopy): string {
  return seasonal.items
    .map((it) => {
      const blurb = copy.items.find((c) => c.name === it.name)?.blurb ?? it.note ?? ''
      return `    <li><span class="name">${escapeHtml(it.name)}</span><span class="price">${it.price} บาท</span><span class="blurb">${escapeHtml(blurb)}</span></li>`
    })
    .join('\n')
}

export function fillTemplate(template: string, seasonal: Seasonal, copy: PosterCopy, root: string): string {
  const values: Record<string, string> = {
    season: escapeHtml(seasonal.season),
    headline: escapeHtml(copy.headline),
    subline: escapeHtml(copy.subline),
    items: renderItems(seasonal, copy),
    footer: escapeHtml(copy.footer),
    root: encodeURI(root),
  }
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in values ? values[k] : m))
}

export function parseArgs(argv: string[]): { theme?: string; out: string; force: boolean } {
  const val = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined
  }
  return { theme: val('--theme'), out: val('--out') ?? 'out/poster.png', force: argv.includes('--force') }
}

export function formatUsd(x: number): string {
  return `$${x.toFixed(2)}`
}

// ตรวจผลโมเดลก่อนใช้: คืนรายการข้อที่ผิด (ว่าง = ใช้ได้) · items ต้องตรงชื่อในไฟล์ครบ ไม่เกิน ไม่ขาด
export function validateCopy(copy: unknown, seasonal: Seasonal): string[] {
  const errors: string[] = []
  const c = copy as Partial<PosterCopy> | null
  if (c === null || typeof c !== 'object') return ['ผลจากโมเดลไม่ใช่ข้อมูลที่อ่านได้']
  for (const k of ['headline', 'subline', 'footer'] as const) {
    if (typeof c[k] !== 'string' || c[k].trim() === '') errors.push(`ไม่มีข้อความ ${k}`)
  }
  if (!Array.isArray(c.items)) return [...errors, 'ไม่มีรายการ items']
  const names = c.items.map((i) => (i && typeof i.name === 'string' ? i.name : ''))
  for (const i of c.items) if (!i || typeof i.blurb !== 'string' || i.blurb.trim() === '') errors.push(`เมนู "${i?.name}" ไม่มีคำบรรยาย`)
  const want = seasonal.items.map((i) => i.name)
  for (const n of want) if (!names.includes(n)) errors.push(`เมนูขาด: ${n}`)
  for (const n of names) if (!want.includes(n)) errors.push(`เมนูที่ไม่มีในร้าน: ${n}`)
  if (names.length !== new Set(names).size) errors.push('มีเมนูซ้ำ')
  return errors
}

export function cacheKey(seasonal: Seasonal, theme: string | undefined, prompt: string): string {
  return createHash('sha256').update(JSON.stringify([seasonal.items, theme ?? '', prompt])).digest('hex').slice(0, 32)
}

export type Spend = { date: string; calls: number; usd: number }

// วันที่ตามเวลา Asia/Bangkok รูปแบบ YYYY-MM-DD
export function bangkokDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// state เก่าหรือเสียถือว่าเริ่มศูนย์ของวันนี้
export function currentSpend(raw: unknown, today: string): Spend {
  const s = raw as Partial<Spend> | null
  if (s && s.date === today && Number.isFinite(s.calls) && Number.isFinite(s.usd)) return { date: today, calls: s.calls!, usd: s.usd! }
  return { date: today, calls: 0, usd: 0 }
}

// คืนข้อความไทยถ้าห้ามเรียก (ถึงเพดาน) · ไม่ถึงเพดานคืน null
export function checkBudget(spend: Spend, limits: Limits): string | null {
  const over = spend.calls >= limits.max_calls_per_day || spend.usd + limits.max_usd_per_call > limits.max_usd_per_day + 1e-9
  if (!over) return null
  return `ถึงเพดานค่าใช้จ่ายของวันนี้แล้ว (ใช้ไป ${spend.calls} ครั้ง ${formatUsd(spend.usd)} จากเพดาน ${limits.max_calls_per_day} ครั้ง ${formatUsd(limits.max_usd_per_day)}) ไม่เรียกโมเดล ลองใหม่พรุ่งนี้หรือใช้ผลที่เคยทำไว้`
}

export function addSpend(spend: Spend, cost: number): Spend {
  return { ...spend, calls: spend.calls + 1, usd: Math.round((spend.usd + cost) * 1e6) / 1e6 }
}
