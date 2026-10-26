import { createClient } from '@supabase/supabase-js'

// ใช้เฉพาะ URL กับ publishable key (สาธารณะได้) · ห้ามใส่ secret key ในแอปนี้
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const configured = Boolean(url && key)
export const supabase = createClient(url || 'http://localhost', key || 'missing')
