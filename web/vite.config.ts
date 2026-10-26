import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// พอร์ตเริ่มต้น 5173 (ถ้าไม่ว่าง Vite เลือกพอร์ตถัดไปให้เอง) · อ่านข้อมูลร้านจาก ../data ได้
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5173, fs: { allow: ['..'] } },
})
