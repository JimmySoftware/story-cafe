import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// พอร์ตเริ่มต้น 5173 (ถ้าไม่ว่าง Vite เลือกพอร์ตถัดไปให้เอง) · อ่านราคาจาก ../data ได้
// ฝังเฉพาะ SUPABASE_URL กับ SUPABASE_PUBLISHABLE_KEY (publishable ปลอดภัยที่จะเปิดเผย) — ไม่ฝังตัวแปรอื่นใน .env (เช่น secret)
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '..', 'SUPABASE_'), ...process.env }
  return {
    plugins: [react()],
    define: {
      'import.meta.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL ?? ''),
      'import.meta.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY ?? ''),
    },
    server: { port: Number(process.env.PORT) || 5173, fs: { allow: ['..'] } },
  }
})
