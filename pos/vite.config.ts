import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// พอร์ต 1420 ตรงกับ devUrl ใน src-tauri/tauri.conf.json (เปลี่ยนด้วย env PORT ได้ตอนทดสอบหลายเครื่อง)
// ฝังเฉพาะ SUPABASE_URL กับ SUPABASE_PUBLISHABLE_KEY จาก .env ที่ root (publishable ปลอดภัยที่จะเปิดเผย)
// ไม่ฝังตัวแปรอื่น (เช่น SUPABASE_SECRET_KEY) · หรือกำหนด VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY ตอน build ก็ได้
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '..', 'SUPABASE_'), ...process.env }
  return {
    plugins: [react()],
    clearScreen: false,
    define: {
      'import.meta.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL ?? ''),
      'import.meta.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY ?? ''),
    },
    server: { port: Number(process.env.PORT) || 1420, strictPort: true },
  }
})
