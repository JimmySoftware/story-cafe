// service worker ของแอปเจ้าของร้าน: เก็บ "เปลือกแอป" (HTML/JS/CSS/ไอคอน) ไว้เปิดตอนออฟไลน์
// ตัวเลขเงินและสต็อกไม่ผ่านที่นี่เลย: จับเฉพาะคำขอ GET ของที่มาจากเว็บเดียวกับแอป
// คำขอไปฐานข้อมูลเป็นคนละที่มา (หรือไม่ใช่ GET) จึงปล่อยผ่านไปเครือข่ายตรง ๆ ไม่เคยถูกเก็บ
const CACHE = 'owner-shell-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await self.caches.open(CACHE)
    await cache.addAll(SHELL)
    // ไฟล์ JS/CSS ของ build มีชื่อแฮช: อ่านชื่อจาก index.html แล้วเก็บไว้ด้วย
    const html = await (await cache.match('/index.html')).text()
    const found = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1])
    // addAll ล้มทั้งชุดถ้ามี URL ซ้ำกัน จึงตัดตัวที่ซ้ำหรือเก็บไปแล้วออก
    const assets = [...new Set(found)].filter((u) => !SHELL.includes(u))
    await cache.addAll(assets)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await self.caches.keys()) if (k !== CACHE) await self.caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    // เปิดหน้า: ลองเครือข่ายก่อน (ได้เปลือกใหม่ล่าสุด) ถ้าออฟไลน์ใช้เปลือกที่เก็บไว้
    event.respondWith(fetch(req).catch(() => self.caches.match('/index.html')))
    return
  }
  // ไฟล์ของแอป: ใช้ที่เก็บไว้ก่อน ไม่มีค่อยโหลดแล้วเก็บ
  event.respondWith((async () => {
    const hit = await self.caches.match(req)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok) (await self.caches.open(CACHE)).put(req, res.clone())
    return res
  })())
})
