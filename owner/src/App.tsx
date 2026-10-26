import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './supabase'

type Bucket = { bills: number; revenue: number; cups: number }
type Summary = Bucket & {
  day: string
  by_hour: (Bucket & { hour: number })[]
  by_source: Record<'pos' | 'preorder' | 'shop', Bucket>
}
type LowItem = { name: string; unit: string; stock: number; reorder_level: number }
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; summary: Summary; low: LowItem[] }

const SOURCE_NAME = { pos: 'หน้าร้าน (POS)', preorder: 'สั่งล่วงหน้า', shop: 'ร้านเมล็ดกาแฟออนไลน์' } as const

// ?day=YYYY-MM-DD ที่ถูกต้องเท่านั้น · ไม่ระบุ = ปล่อยให้ฐานข้อมูลใช้ "วันนี้เวลาไทย" เอง
function dayFromUrl(): string | undefined {
  const d = new URLSearchParams(window.location.search).get('day')
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : undefined
}

// แปลงข้อผิดพลาดเป็นข้อความไทยสำหรับเจ้าของร้าน (ไม่โชว์ stack trace)
function thaiError(err: { message?: string } | null, offline: boolean): string {
  if (offline) return 'ออฟไลน์อยู่ เชื่อมต่ออินเทอร์เน็ตไม่ได้ จึงยังไม่แสดงตัวเลข (ไม่ใช้ตัวเลขเก่าแทน) ลองใหม่เมื่อมีสัญญาณ'
  const m = err?.message ?? ''
  if (m.startsWith('forbidden')) return 'บัญชีนี้ไม่ใช่บัญชีพนักงานหรือเจ้าของร้าน จึงดูยอดขายไม่ได้'
  if (/fetch|network|Failed/i.test(m)) return 'ติดต่อฐานข้อมูลไม่ได้ ลองใหม่อีกครั้ง'
  return 'ดึงตัวเลขไม่สำเร็จ ลองใหม่อีกครั้ง หรือออกจากระบบแล้วเข้าใหม่'
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) setError(navigator.onLine ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : 'ออฟไลน์อยู่ ล็อกอินไม่ได้')
    } catch {
      setError('ติดต่อฐานข้อมูลไม่ได้ ลองใหม่อีกครั้ง')
    }
    setBusy(false)
  }

  return (
    <form className="card login" onSubmit={submit}>
      <h1>Story Cafe · เจ้าของร้าน</h1>
      <label>อีเมล
        <input data-testid="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>รหัสผ่าน
        <input data-testid="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button data-testid="login-submit" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
    </form>
  )
}

function Dashboard() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const day = dayFromUrl()

  const refresh = useCallback(async () => {
    try {
      // ตัวเลขทั้งหมดมาจากฟังก์ชันในฐานข้อมูลเท่านั้น หน้าจอไม่คิดยอดเอง
      const [s, l] = await Promise.all([
        supabase.rpc('sales_summary', day ? { p_day: day } : {}),
        supabase.rpc('stock_low'),
      ])
      const err = s.error ?? l.error
      if (err) {
        // ล้างตัวเลขเดิมทิ้ง ไม่โชว์ของเก่าเหมือนเป็นของปัจจุบัน
        setLoad({ state: 'error', message: thaiError(err, !navigator.onLine) })
        return
      }
      setLoad({ state: 'ok', summary: s.data as Summary, low: (l.data ?? []) as LowItem[] })
    } catch {
      setLoad({ state: 'error', message: thaiError(null, !navigator.onLine) })
    }
  }, [day])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60_000)
    window.addEventListener('online', refresh)
    return () => { clearInterval(t); window.removeEventListener('online', refresh) }
  }, [refresh])

  return (
    <>
      <header className="top">
        <h1>Story Cafe</h1>
        <div>
          <button className="ghost" onClick={refresh}>รีเฟรช</button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>ออกจากระบบ</button>
        </div>
      </header>

      {load.state === 'loading' && <p className="muted">กำลังโหลด…</p>}
      {load.state === 'error' && <p className="card error" role="alert" data-testid="load-error">{load.message}</p>}
      {load.state === 'ok' && <Numbers summary={load.summary} low={load.low} isToday={!day} />}
    </>
  )
}

function Numbers({ summary, low, isToday }: { summary: Summary; low: LowItem[]; isToday: boolean }) {
  const maxCups = Math.max(1, ...summary.by_hour.map((h) => h.cups))
  const maxRevenue = Math.max(1, ...summary.by_hour.map((h) => h.revenue))
  return (
    <>
      <p className="muted" data-testid="day">{isToday ? 'วันนี้' : 'ย้อนหลัง'} · {summary.day}</p>

      <section className="stats">
        <div className="card stat">
          <span className="label">ยอดขาย</span>
          <b data-testid="today-total">{summary.revenue}</b>
          <span className="unit">บาท</span>
        </div>
        <div className="card stat">
          <span className="label">บิล</span>
          <b data-testid="today-bills">{summary.bills}</b>
          <span className="unit">ใบ</span>
        </div>
        <div className="card stat">
          <span className="label">แก้ว</span>
          <b data-testid="today-cups">{summary.cups}</b>
          <span className="unit">แก้ว</span>
        </div>
      </section>

      <section className="card">
        <h2>แก้วต่อชั่วโมง</h2>
        {summary.by_hour.length === 0 && <p className="muted">ยังไม่มีการขายในวันนี้</p>}
        <ul className="bars">
          {summary.by_hour.map((h) => {
            // แท่งยาวตามจำนวนแก้ว · ชั่วโมงที่ขายแต่ไม่มีแก้ว (เช่นร้านออนไลน์) ยาวตามยอดแทน เพื่อไม่ให้หายไป
            const pct = h.cups > 0 ? (h.cups / maxCups) * 100 : Math.max(4, (h.revenue / maxRevenue) * 30)
            return (
              <li key={h.hour}>
                <span className="hour">{String(h.hour).padStart(2, '0')}:00</span>
                <div className="track">
                  <div className="bar" data-testid={`hour-bar-${h.hour}`} data-cups={h.cups} data-revenue={h.revenue} data-bills={h.bills} style={{ width: `${pct}%` }} />
                </div>
                <span className="val">{h.cups} แก้ว · {h.revenue} บาท</span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card">
        <h2>แยกตามช่องทาง</h2>
        <ul className="sources">
          {(Object.keys(SOURCE_NAME) as (keyof typeof SOURCE_NAME)[]).map((k) => (
            <li key={k} data-testid={`source-${k}`}>
              <span>{SOURCE_NAME[k]}</span>
              <span>{summary.by_source[k].bills} บิล · {summary.by_source[k].cups} แก้ว · {summary.by_source[k].revenue} บาท</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>ของที่ใกล้หมด</h2>
        {low.length === 0 && <p className="muted" data-testid="stock-ok">ยังไม่มีของใกล้หมด</p>}
        <ul className="low">
          {low.map((i) => (
            <li key={i.name} data-testid={`stock-low-${i.name}`}>
              <span>{i.name}</span>
              <span>เหลือ {i.stock} {i.unit} (ควรสั่งเมื่อต่ำกว่า {i.reorder_level})</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).catch(() => setSession(null))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured) {
    return <p className="card error">ตั้งค่าแอปไม่ครบ: ไม่พบที่อยู่ฐานข้อมูล (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) ตอน build</p>
  }
  if (session === undefined) return <p className="muted pad">กำลังโหลด…</p>
  return <main>{session ? <Dashboard /> : <Login />}</main>
}
