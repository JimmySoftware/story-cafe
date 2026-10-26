import { createRoot } from 'react-dom/client'
import { App } from './App'
import './style.css'

createRoot(document.getElementById('root')!).render(<App />)

// ติดตั้งเปลือกแอปไว้ใช้ตอนออฟไลน์ (ตอน dev ไม่ลงทะเบียน กันไฟล์ของ dev server ค้างใน cache)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
