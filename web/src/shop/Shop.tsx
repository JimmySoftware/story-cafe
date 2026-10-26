import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../preorder/client'
import { thaiError } from './errors'

type Product = { id: string; sku: string; name: string; price: number; stock: number }
type MyOrder = { id: string; code: string; status: string; total: number; created_at: string; shop_order_items: { qty: number; unit_price: number; products: { name: string } | null }[] }

const baht = (n: number) => n.toLocaleString('th-TH')
const statusName: Record<string, string> = { pending: 'รอดำเนินการ', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก', shipped: 'จัดส่งแล้ว' }
const MAX_QTY = 10

function useSession() {
  const [session, setSession] = useState<Session | null>()
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

function Nav({ session, view }: { session: Session | null | undefined; view: 'shop' | 'orders' }) {
  return (
    <nav className="po-days" aria-label="เมนูร้านค้า">
      <a className="btn btn-ghost" href="#/">กลับหน้าร้าน</a>
      {view === 'orders' ? <a className="btn btn-ghost" href="#/shop">สินค้า</a> : <a className="btn btn-ghost" href="#/shop/orders">ออเดอร์ของฉัน</a>}
      {session && <button type="button" className="btn btn-ghost" onClick={() => supabase?.auth.signOut()}>ออกจากระบบ</button>}
    </nav>
  )
}

function AuthForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy) return
    setError(undefined); setInfo(undefined)
    if (!email.trim() || !password) return setError('กรุณากรอกอีเมลและรหัสผ่าน')
    setBusy(true)
    try {
      const creds = { email: email.trim(), password }
      const { data, error: err } = mode === 'in' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds)
      if (err) setError(thaiError(err))
      else if (mode === 'up' && !data.session) setInfo('สมัครแล้ว กรุณายืนยันอีเมลที่ร้านส่งให้ แล้วเข้าสู่ระบบ')
    } catch (x) {
      setError(thaiError(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="auth-h">
      <h2 id="auth-h">{mode === 'in' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</h2>
      <p className="note">ต้องเข้าสู่ระบบก่อนสั่งซื้อ</p>
      <label className="po-field">อีเมล
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="po-field">รหัสผ่าน
        <input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="po-error" role="alert">{error}</p>}
      {info && <p className="note" role="status">{info}</p>}
      <div className="po-days">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'กำลังดำเนินการ…' : mode === 'in' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</button>
        <button type="button" className="btn btn-ghost" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(undefined); setInfo(undefined) }}>
          {mode === 'in' ? 'ยังไม่มีบัญชี? สมัครสมาชิก' : 'มีบัญชีแล้ว? เข้าสู่ระบบ'}
        </button>
      </div>
    </form>
  )
}

export default function Shop({ view }: { view: 'shop' | 'orders' }) {
  const session = useSession()
  if (!supabase) {
    return <main className="wrap po"><h1>ร้านเมล็ดกาแฟ</h1><p className="note" role="alert">ตอนนี้ร้านออนไลน์ยังไม่พร้อมใช้งาน กรุณาติดต่อร้านทาง LINE</p><a className="btn btn-ghost" href="#/">กลับหน้าร้าน</a></main>
  }
  return (
    <main className="wrap po">
      <h1>{view === 'shop' ? 'ร้านเมล็ดกาแฟและ drip bag' : 'ออเดอร์ของฉัน'}</h1>
      <Nav session={session} view={view} />
      {view === 'shop' && <Catalog session={session} />}
      {view === 'orders' && (session === undefined ? <p className="note">กำลังโหลด…</p> : session ? <Orders /> : <AuthForm />)}
    </main>
  )
}

function Catalog({ session }: { session: Session | null | undefined }) {
  const [products, setProducts] = useState<Product[]>()
  const [loadError, setLoadError] = useState<string>()
  const [cart, setCart] = useState<Record<string, number>>({}) // sku → qty
  const [ship, setShip] = useState({ name: '', phone: '', address: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<{ code: string; total: number }>()

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error: err } = await supabase.from('products').select('id,sku,name,price,stock').order('sort')
    if (err) setLoadError(thaiError(err)); else { setLoadError(undefined); setProducts(data as Product[]) }
  }, [])
  useEffect(() => { load().catch((x) => setLoadError(thaiError(x))) }, [load])

  const lines = (products ?? []).filter((p) => cart[p.sku] > 0)
  // ยอดนี้ไว้ดูเฉย ๆ — ราคาจริงคิดที่ create_order
  const estimate = lines.reduce((n, p) => n + p.price * cart[p.sku], 0)
  const setQty = (p: Product, q: number) => setCart((c) => ({ ...c, [p.sku]: Math.max(0, Math.min(q, MAX_QTY, p.stock)) }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy) return
    setError(undefined)
    if (!lines.length) return setError(thaiError('empty_order'))
    if (!ship.name.trim() || !ship.phone.trim() || !ship.address.trim()) return setError(thaiError('bad_ship'))
    setBusy(true)
    try {
      const { data, error: err } = await supabase.rpc('create_order', {
        p_items: lines.map((p) => ({ sku: p.sku, qty: cart[p.sku] })),
        p_ship: { name: ship.name.trim(), phone: ship.phone.trim(), address: ship.address.trim() },
        p_channel: 'web',
      })
      if (err) { setError(thaiError(err)); await load() } // สต็อกอาจเปลี่ยนไปแล้ว
      else { setDone(data as { code: string; total: number }); setCart({}); await load() }
    } catch (x) {
      setError(thaiError(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {done && (
        <div className="po-done" role="status">
          <p>สั่งเรียบร้อยแล้ว เลขออเดอร์</p>
          <strong className="po-code">{done.code}</strong>
          <p>ยอดรวม {baht(done.total)} บาท · ร้านจะติดต่อเรื่องการชำระเงิน</p>
          <a className="btn btn-ghost" href="#/shop/orders">ดูออเดอร์ของฉัน</a>
        </div>
      )}
      <section aria-labelledby="sh-products">
        <h2 id="sh-products">สินค้า</h2>
        {loadError && <p className="po-error" role="alert">{loadError}</p>}
        {!products && !loadError && <p className="note">กำลังโหลดสินค้า…</p>}
        <ul className="po-menu">
          {products?.map((p) => (
            <li key={p.id}>
              <span>{p.name}<br /><small className="note">{p.stock > 0 ? `เหลือ ${baht(p.stock)} ชิ้น` : 'สินค้าหมด'}</small></span>
              <span className="po-price">{baht(p.price)} บาท</span>
              <button type="button" className="btn btn-ghost po-small" disabled={p.stock <= 0 || (cart[p.sku] ?? 0) >= Math.min(MAX_QTY, p.stock)} onClick={() => setQty(p, (cart[p.sku] ?? 0) + 1)} aria-label={`เพิ่ม ${p.name} ลงตะกร้า`}>เพิ่ม</button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sh-cart">
        <h2 id="sh-cart">ตะกร้า</h2>
        {!lines.length && <p className="note">ยังไม่มีสินค้าในตะกร้า</p>}
        <ul className="po-lines">
          {lines.map((p) => (
            <li key={p.id} className="po-line-head">
              <strong>{p.name}</strong>
              <span className="po-qty">
                <button type="button" className="btn btn-ghost po-small" onClick={() => setQty(p, cart[p.sku] - 1)} aria-label={`ลด ${p.name}`}>−</button>
                <span aria-live="polite">{cart[p.sku]}</span>
                <button type="button" className="btn btn-ghost po-small" disabled={cart[p.sku] >= Math.min(MAX_QTY, p.stock)} onClick={() => setQty(p, cart[p.sku] + 1)} aria-label={`เพิ่ม ${p.name}`}>+</button>
              </span>
              <span className="po-price">{baht(p.price * cart[p.sku])} บาท</span>
            </li>
          ))}
        </ul>
        {!!lines.length && <p><strong>รวมประมาณ {baht(estimate)} บาท</strong> <small className="note">(ยอดจริงคิดตอนยืนยันออเดอร์)</small></p>}
      </section>

      {session === undefined ? null : !session ? (
        <AuthForm />
      ) : (
        <form onSubmit={submit} aria-labelledby="sh-ship">
          <h2 id="sh-ship">ที่อยู่จัดส่ง</h2>
          <p className="note">สั่งในชื่อ {session.user.email}</p>
          <label className="po-field">ชื่อผู้รับ<input autoComplete="name" value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} /></label>
          <label className="po-field">เบอร์โทร<input type="tel" autoComplete="tel" value={ship.phone} onChange={(e) => setShip({ ...ship, phone: e.target.value })} /></label>
          <label className="po-field">ที่อยู่<input autoComplete="street-address" value={ship.address} onChange={(e) => setShip({ ...ship, address: e.target.value })} /></label>
          {error && <p className="po-error" role="alert">{error}</p>}
          <div className="po-days">
            <button type="submit" className="btn btn-primary" disabled={busy || !lines.length}>{busy ? 'กำลังสั่ง…' : 'ยืนยันสั่งซื้อ'}</button>
          </div>
        </form>
      )}
    </>
  )
}

function Orders() {
  const [orders, setOrders] = useState<MyOrder[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    supabase!.from('shop_orders').select('id,code,status,total,created_at,shop_order_items(qty,unit_price,products(name))').order('created_at', { ascending: false })
      .then(({ data, error: err }) => { if (err) setError(thaiError(err)); else setOrders(data as unknown as MyOrder[]) }, (x) => setError(thaiError(x)))
  }, [])
  if (error) return <p className="po-error" role="alert">{error}</p>
  if (!orders) return <p className="note">กำลังโหลดออเดอร์…</p>
  if (!orders.length) return <p className="note">ยังไม่มีออเดอร์ <a href="#/shop">ไปเลือกสินค้า</a></p>
  return (
    <ul className="po-lines">
      {orders.map((o) => (
        <li key={o.id}>
          <div className="po-line-head"><strong>{o.code}</strong><span>{statusName[o.status] ?? o.status}</span><span className="po-price">{baht(o.total)} บาท</span></div>
          <small className="note">{new Date(o.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })} น.</small>
          <ul>{o.shop_order_items.map((i, k) => <li key={k}>{i.products?.name ?? 'สินค้า'} × {i.qty} · {baht(i.unit_price)} บาท</li>)}</ul>
        </li>
      ))}
    </ul>
  )
}
