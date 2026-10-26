import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// พอร์ต 1430 (POS ใช้ 1420) · เปลี่ยนด้วย env PORT ได้ · URL/key ของ Supabase อ่านจาก env VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 1430, strictPort: true },
})
