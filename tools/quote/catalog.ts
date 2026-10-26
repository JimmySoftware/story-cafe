// อ่านเมนูและข้อมูลร้านจากไฟล์ (ราคาอยู่ที่ data/menu.csv ที่เดียว ห้ามพิมพ์ราคาซ้ำในโค้ด)
import { readFileSync } from 'node:fs'

export type Item = { category: string; name: string; price: number; isDrink: boolean }
export type Shop = { name: string; tagline: string; open: string; phone: string; address: string }

export function loadCatalog(file = 'data/menu.csv'): Item[] {
  const [head, ...rows] = readFileSync(file, 'utf8').trim().split('\n')
  if (head !== 'category,name,price,is_drink') throw new Error(`หัวตารางของ ${file} ไม่ตรงรูปแบบ`)
  return rows.map((l) => {
    const [category, name, price, drink] = l.split(',')
    return { category, name, price: Number(price), isDrink: drink === '1' }
  })
}

export function loadShop(file = 'data/shop.json'): Shop {
  const { name, tagline, open, phone, address } = JSON.parse(readFileSync(file, 'utf8'))
  return { name, tagline, open, phone, address }
}
