// การเชื่อม Supabase ของ POS — ใช้เฉพาะ URL + publishable key (ปลอดภัยที่จะอยู่ใน bundle) · ห้ามเอา secret key มาใช้ที่นี่
import { createClient } from '@supabase/supabase-js'

// vite.config.ts ฝังเฉพาะ SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY จาก .env ที่ root · หรือกำหนด VITE_SUPABASE_* ตอน build
const env = import.meta.env
export const SUPABASE_URL: string = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
const KEY: string = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || ''
export const configured = SUPABASE_URL !== '' && KEY !== ''

// client ของพนักงาน: ล็อกอินแล้วเก็บ session ไว้ (คงอยู่หลังรีโหลด)
export const supabase = createClient(SUPABASE_URL || 'http://127.0.0.1:54321', KEY || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pos-staff-auth' },
})

// client ไม่ใช้ session ล็อกอิน (role anon) — ตาราง settings เปิดให้อ่านเฉพาะ anon จึงอ่านชื่อร้านด้วยตัวนี้
const anon = createClient(SUPABASE_URL || 'http://127.0.0.1:54321', KEY || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'pos-anon-unused' },
})

const SHOP_NAME_KEY = 'pos_shop_name'
export const cachedShopName = (): string => localStorage.getItem(SHOP_NAME_KEY) ?? ''

// อ่าน settings.shop_name แล้วเก็บค่าล่าสุดไว้ใช้ตอนไม่มีเน็ต · อ่านไม่ได้ = คืนค่าที่เก็บไว้
export async function loadShopName(): Promise<string> {
  try {
    const { data, error } = await anon.from('settings').select('value').eq('key', 'shop_name').maybeSingle()
    if (!error && typeof data?.value === 'string' && data.value.trim() !== '') {
      localStorage.setItem(SHOP_NAME_KEY, data.value)
      return data.value
    }
  } catch {
    // ออฟไลน์ — ใช้ค่าที่เก็บไว้
  }
  return cachedShopName()
}
