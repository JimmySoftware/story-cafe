// เปลือกบาง ๆ สำหรับ Deno — logic อยู่ใน handler.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import handler from './handler.ts'

Deno.serve((req) => {
  const env = Deno.env.toObject()
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return handler(req, { env, fetch, db })
})
