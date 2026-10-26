export interface SeasonalItem {
  name: string
  price: number
  note?: string
}

export interface Seasonal {
  season?: string
  items: SeasonalItem[]
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const BANNED_CLAIMS = ['รักษา', 'ลดน้ำหนัก', 'ดีต่อสุขภาพ']
const PRICE_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*(?:บาท|฿)|฿\s*(\d[\d,]*(?:\.\d+)?)/g

export function validateCaptions(data: unknown, seasonal: Seasonal): ValidationResult {
  const errors: string[] = []
  const captions = (data as { captions?: unknown } | null)?.captions
  if (!Array.isArray(captions)) {
    return { ok: false, errors: ['ไม่พบรายการ captions'] }
  }

  if (captions.length !== 3) errors.push(`ต้องมี caption 3 อัน แต่ได้ ${captions.length} อัน`)
  const platforms = captions.map((c) => (c as { platform?: unknown })?.platform)
  if (!platforms.includes('instagram')) errors.push('ไม่มี caption ของ instagram')
  if (!platforms.includes('tiktok')) errors.push('ไม่มี caption ของ tiktok')

  const realPrices = new Set(seasonal.items.map((i) => i.price))

  captions.forEach((raw, idx) => {
    const n = idx + 1
    const c = (raw ?? {}) as { platform?: unknown; text?: unknown; hashtags?: unknown }
    if (c.platform !== 'instagram' && c.platform !== 'tiktok') {
      errors.push(`caption ที่ ${n}: platform ต้องเป็น instagram หรือ tiktok`)
    }

    if (typeof c.text !== 'string') {
      errors.push(`caption ที่ ${n}: ไม่มีข้อความ text`)
    } else {
      const text = c.text
      const len = [...text].length
      if (len < 20 || len > 200) errors.push(`caption ที่ ${n}: ข้อความยาว ${len} ตัวอักษร (ต้อง 20–200)`)
      if (!/[฀-๿]/.test(text)) errors.push(`caption ที่ ${n}: ข้อความต้องเป็นภาษาไทย`)
      if (!seasonal.items.some((i) => text.includes(i.name))) {
        errors.push(`caption ที่ ${n}: ไม่ได้กล่าวถึงเมนูประจำฤดูด้วยชื่อที่ตรงกับไฟล์`)
      }
      for (const m of text.matchAll(PRICE_PATTERN)) {
        const price = Number((m[1] ?? m[2]).replace(/,/g, ''))
        if (!realPrices.has(price)) errors.push(`caption ที่ ${n}: ราคา ${price} ไม่ตรงกับราคาจริงของเมนูใด`)
      }
      for (const word of BANNED_CLAIMS) {
        if (text.includes(word)) errors.push(`caption ที่ ${n}: ห้ามอ้างเรื่องสุขภาพ (พบคำว่า "${word}")`)
      }
    }

    const tags = c.hashtags
    if (!Array.isArray(tags)) {
      errors.push(`caption ที่ ${n}: ไม่มี hashtags`)
    } else {
      if (tags.length < 3 || tags.length > 8) errors.push(`caption ที่ ${n}: hashtags ${tags.length} อัน (ต้อง 3–8)`)
      for (const t of tags) {
        if (typeof t !== 'string' || !t.startsWith('#') || /\s/.test(t)) {
          errors.push(`caption ที่ ${n}: hashtag "${String(t)}" ต้องขึ้นต้นด้วย # และไม่มีช่องว่าง`)
        }
      }
    }
  })

  return { ok: errors.length === 0, errors }
}
