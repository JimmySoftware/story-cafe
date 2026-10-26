import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// พอร์ต 1420 ตรงกับ devUrl ใน src-tauri/tauri.conf.json (เปลี่ยนด้วย env PORT ได้ตอนทดสอบหลายเครื่อง)
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: Number(process.env.PORT) || 1420, strictPort: true },
})
