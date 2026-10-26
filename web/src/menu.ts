// ข้อมูลร้านมาจากไฟล์ของร้าน (ไม่พิมพ์ซ้ำในโค้ด): ราคา = ../../data/menu.csv · ข้อมูลร้าน = ../../data/shop.json
import menuCsv from '../../data/menu.csv?raw'
import shopJson from '../../data/shop.json'

export type Item = { category: string; name: string; price: number; isDrink: boolean }

export const menu: Item[] = menuCsv
  .trim()
  .split('\n')
  .slice(1)
  .map((line) => {
    const [category, name, price, drink] = line.split(',')
    return { category, name, price: Number(price), isDrink: drink.trim() === '1' }
  })

export type Shop = { name: string; tagline: string; open: string; phone: string; address: string; line: string; instagram: string; products: { name: string; price: number }[]; workshop: { name: string; when: string; seats: number; price: number } }
export const shop = shopJson as Shop

export const categories = [...new Set(menu.map((i) => i.category))]
