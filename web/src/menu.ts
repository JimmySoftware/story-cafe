// ราคา = ../../data/menu.csv · ข้อมูลร้านอ่านจากตาราง settings ของ Supabase (ไม่พิมพ์ซ้ำในโค้ด)
import menuCsv from '../../data/menu.csv?raw'

export type Item = { category: string; name: string; price: number; isDrink: boolean }

export const menu: Item[] = menuCsv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [category, name, price, drink] = line.split(',')
    return { category, name, price: Number(price), isDrink: drink.trim() === '1' }
  })

export type Shop = { name: string; tagline: string; open: string; phone: string; address: string; line: string; instagram: string; workshop: { name: string; when: string; seats: number; price: number } }

export const categories = [...new Set(menu.map((i) => i.category))]

type Row = { key: string; value: unknown }

export function parseShop(rows: Row[]): Shop {
  const v = (key: string): any => {
    const r = rows.find((x) => x.key === key)
    if (!r) throw new Error(`ตาราง settings ไม่มีข้อมูลร้าน "${key}"`)
    return r.value
  }
  return {
    name: v('shop_name'), tagline: v('tagline'), open: `${v('open_time')}-${v('close_time')}`,
    phone: v('phone'), address: v('address'), line: v('line_id'), instagram: v('instagram'),
    workshop: v('workshop'),
  }
}

export type LoadedShop = Shop & { fromFallback?: boolean }

async function loadFromSupabase(): Promise<Shop> {
  const url = import.meta.env.SUPABASE_URL
  const key = import.meta.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('ยังไม่ได้ตั้ง SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY')
  const res = await fetch(`${url}/rest/v1/settings?select=key,value`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`อ่านข้อมูลร้านไม่ได้ (สถานะ ${res.status})`)
  return parseShop(await res.json())
}

// ไฟล์สำรอง = tools/menu-fallback.mjs (สร้างจาก seed_settings.sql) ใช้เมื่อ Supabase หลับหรือล่ม
async function loadFromFallback(): Promise<Shop> {
  const res = await fetch('/menu-fallback.json')
  if (!res.ok) throw new Error(`อ่านไฟล์สำรองไม่ได้ (สถานะ ${res.status})`)
  const { shop } = (await res.json()) as { shop: Record<string, unknown> }
  return parseShop(Object.entries(shop).map(([key, value]) => ({ key, value })))
}

// SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY ถูกฝังตอน build โดย vite.config.ts (เฉพาะสองตัวนี้)
// เมนูกับราคามาจาก data/menu.csv ที่ฝังในเว็บอยู่แล้ว จึงโชว์ได้แม้ Supabase ใช้ไม่ได้
export async function loadShop(): Promise<LoadedShop> {
  try {
    return await loadFromSupabase()
  } catch (e) {
    try {
      return { ...(await loadFromFallback()), fromFallback: true }
    } catch {
      throw e
    }
  }
}
