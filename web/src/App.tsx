import './style.css'
import { useEffect, useState } from 'react'
import { menu, categories, loadShop, type Shop } from './menu'

const baht = (n: number) => n.toLocaleString('th-TH')
function LatteArt() {
  return (
    <svg className="cup" viewBox="0 0 240 240" role="img" aria-label="ภาพวาดลายลาเต้อาร์ตมองจากด้านบน">
      <circle cx="120" cy="120" r="116" className="cup-saucer" />
      <circle cx="120" cy="120" r="92" className="cup-rim" />
      <circle cx="120" cy="120" r="80" className="cup-coffee" />
      <g className="cup-foam">
        <path d="M120 188 C84 176 64 146 72 118 C80 90 108 82 120 96 C132 82 160 90 168 118 C176 146 156 176 120 188 Z" />
      </g>
      <g className="cup-lines" fill="none">
        <path d="M120 176 C98 166 88 146 94 126" />
        <path d="M120 176 C142 166 152 146 146 126" />
        <path d="M120 160 C106 152 102 140 106 128" />
        <path d="M120 160 C134 152 138 140 134 128" />
        <path d="M120 100 L120 184" />
      </g>
      <path className="cup-handle" d="M208 100 h22 a14 14 0 0 1 0 40 h-22" fill="none" />
    </svg>
  )
}

export default function App() {
  const [shop, setShop] = useState<Shop>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    loadShop().then(setShop, (e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  if (error) return <p className="note" role="alert">ผิดพลาด: {error}</p>
  if (!shop) return <p className="note">กำลังโหลดข้อมูลร้าน…</p>
  return <Page shop={shop} />
}

function Page({ shop }: { shop: Shop }) {
  const phoneDigits = shop.phone.replace(/[\s-]/g, '')
  const phoneIsReal = /^\d+$/.test(phoneDigits)
  const lineHandle = shop.line.replace(/^@/, '')
  const lineUrl = `https://line.me/R/ti/p/%40${encodeURIComponent(lineHandle)}`
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${shop.address}`)}`
  const hours = shop.open.replace('-', '–')

  return (
    <>
      <header className="hero">
        <div className="wrap hero-grid">
          <div className="hero-text">
            <h1>{shop.name}</h1>
            <p className="tagline">{shop.tagline}</p>
            <p className="hours-line">เปิดทุกวัน {hours} น.</p>
            <div className="actions">
              <a className="btn btn-primary" href={lineUrl} target="_blank" rel="noopener noreferrer">
                แชทผ่าน LINE
              </a>
              {phoneIsReal ? (
                <a className="btn btn-ghost" href={`tel:${phoneDigits}`}>
                  โทร {shop.phone}
                </a>
              ) : (
                <span className="btn btn-ghost btn-static" role="note">
                  โทร {shop.phone} (เบอร์สมมติ)
                </span>
              )}
            </div>
          </div>
          <LatteArt />
        </div>
      </header>

      <main>
        <section className="section" aria-labelledby="menu-h">
          <div className="wrap">
            <h2 id="menu-h">เมนู</h2>
            <div className="menu-cols">
              {categories.map((cat) => (
                <div className="menu-cat" key={cat}>
                  <h3>{cat}</h3>
                  <ul>
                    {menu
                      .filter((i) => i.category === cat)
                      .map((i) => (
                        <li key={i.name}>
                          <span className="item-name">{i.name}</span>
                          <span className="leader" aria-hidden="true" />
                          <span className="item-price">{baht(i.price)}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="note">ราคาเป็นบาท</p>
          </div>
        </section>

        <section className="section tint" aria-labelledby="shop-h">
          <div className="wrap">
            <h2 id="shop-h">ของขายออนไลน์</h2>
            <ul className="products">
              {shop.products.map((p) => (
                <li key={p.name}>
                  <span className="product-name">{p.name}</span>
                  <span className="product-price">{baht(p.price)} บาท</span>
                </li>
              ))}
            </ul>
            <p className="note">สั่งผ่าน LINE {shop.line}</p>
          </div>
        </section>

        <section className="section" aria-labelledby="ws-h">
          <div className="wrap">
            <div className="workshop">
              <h2 id="ws-h">{shop.workshop.name}</h2>
              <dl>
                <div>
                  <dt>วันและเวลา</dt>
                  <dd>{shop.workshop.when} น.</dd>
                </div>
                <div>
                  <dt>ที่นั่ง</dt>
                  <dd>{shop.workshop.seats} ที่นั่ง</dd>
                </div>
                <div>
                  <dt>ราคา</dt>
                  <dd>{baht(shop.workshop.price)} บาท</dd>
                </div>
              </dl>
              <a className="btn btn-light" href={lineUrl} target="_blank" rel="noopener noreferrer">
                จองที่นั่งทาง LINE
              </a>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="loc-h">
          <div className="wrap loc">
            <div>
              <h2 id="loc-h">ที่ตั้งและเวลาเปิด</h2>
              <p className="loc-address">{shop.address}</p>
              <p className="loc-hours">เปิดทุกวัน {hours} น.</p>
            </div>
            <a className="btn btn-primary" href={mapUrl} target="_blank" rel="noopener noreferrer">
              เปิดแผนที่
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-grid">
          <strong>{shop.name}</strong>
          <span>Instagram {shop.instagram}</span>
          <span>LINE {shop.line}</span>
          <span className="fake">ข้อมูลสมมติเพื่อการเรียน</span>
        </div>
      </footer>
    </>
  )
}
