// อ่านเมนูจากไฟล์ และข้อมูลร้านจากตาราง settings (ราคาอยู่ที่ data/menu.csv ที่เดียว ห้ามพิมพ์ราคาซ้ำในโค้ด)
import { readFileSync } from 'node:fs'

export type Item = { category: string; name: string; price: number; isDrink: boolean }
export type Shop = { name: string; tagline: string; open: string; phone: string; address: string }

export function loadCatalog(file = 'data/menu.csv'): Item[] {
  const [head, ...rows] = readFileSync(file, 'utf8').trim().split('\n')
  if (head !== 'category,name,price,is_drink') throw new Error(`หัวตารางของ ${file} ไม่ตรงรูปแบบ`)
  return rows.map((l) => {
    const [category, name, price, drink] = l.split(',')
    return { category, name, price: Number(price), isDrink: drink === '1' }
  })
}

export type SettingRow = { key: string; value: unknown }

// แปลงแถวจากตาราง settings เป็นข้อมูลร้าน (ขาด key ไหนให้บอกชื่อ key นั้น)
export function parseShop(rows: SettingRow[]): Shop {
  const get = (key: string): string => {
    const v = rows.find((r) => r.key === key)?.value
    if (typeof v !== 'string') throw new Error(`ตาราง settings ไม่มีข้อมูลร้าน "${key}"`)
    return v
  }
  return {
    name: get('shop_name'),
    tagline: get('tagline'),
    open: `${get('open_time')}-${get('close_time')}`,
    phone: get('phone'),
    address: get('address'),
  }
}

// อ่านข้อมูลร้านจากตาราง settings ผ่าน SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY
export async function loadShop(env: Record<string, string | undefined> = process.env): Promise<Shop> {
  const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key } = env
  if (!url || !key) throw new Error('ยังไม่ได้ตั้ง SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY (ดู .env.example)')
  let res: Response
  try {
    res = await fetch(`${url}/rest/v1/settings?select=key,value`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  } catch {
    throw new Error(`เชื่อมต่อฐานข้อมูลที่ ${url} ไม่ได้ (รัน npx supabase start แล้วหรือยัง)`)
  }
  if (!res.ok) throw new Error(`อ่านตาราง settings ไม่ได้ (สถานะ ${res.status}) ตรวจ SUPABASE_PUBLISHABLE_KEY`)
  return parseShop((await res.json()) as SettingRow[])
}
