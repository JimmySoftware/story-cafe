import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY ตาม brief (ถ้าไม่ตั้ง ใช้ SUPABASE_* ที่ vite.config.ts ฝังไว้ให้ส่วนอื่นของเว็บ)
// ไม่ตั้งค่าเลย → null (build ผ่าน หน้าจะบอกลูกค้าเป็นภาษาไทย)
const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.SUPABASE_PUBLISHABLE_KEY

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
