import { menu, shop } from './menu'

// หน้าชั่วคราว — แทนที่ด้วยหน้าร้านจริงตาม briefs/landing.md
export default function App() {
  return (
    <main>
      <h1>{shop.name}</h1>
      <p>กำลังสร้างหน้าร้าน ({menu.length} เมนู)</p>
    </main>
  )
}
