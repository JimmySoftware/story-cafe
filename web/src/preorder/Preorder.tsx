import { useEffect, useMemo, useState } from 'react'
import { supabase } from './client'
import { thaiError } from './errors'
import { bangkokDay, dateTimeLabel, dayLabel, timeLabel } from './time'

type MenuItem = { id: string; category: string; name: string; price: number; is_drink: boolean; cup_units: number }
type Option = { kind: string; label: string; price_delta: number; sort: number }
type Slot = { slot_start: string; cups_left: number; bookable: boolean }
type Line = { key: number; item: MenuItem; qty: number; picked: Record<string, string> } // picked: kind → label
type Done = { code: string; total: number; pickup_at: string }

const kindName: Record<string, string> = { size: 'ไซซ์', sweetness: 'ความหวาน', milk: 'นม', extra: 'เพิ่มเติม' }
const baht = (n: number) => n.toLocaleString('th-TH')

export default function Preorder() {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [options, setOptions] = useState<Option[]>([])
  const [days, setDays] = useState(1)
  const [loadError, setLoadError] = useState<string>()
  const [lines, setLines] = useState<Line[]>([])
  const [dayOffset, setDayOffset] = useState(0)
  const [slots, setSlots] = useState<Slot[]>()
  const [slotError, setSlotError] = useState<string>()
  const [pickup, setPickup] = useState<string>()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<Done>()
  const [reload, setReload] = useState(0)

  // เมนู ตัวเลือก และจำนวนวันที่สั่งล่วงหน้าได้ (settings.preorder_days) จากฐานข้อมูล
  useEffect(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('menu_items').select('id,category,name,price,is_drink,cup_units').order('sort'),
      supabase.from('options').select('kind,label,price_delta,sort').order('sort'),
      supabase.from('settings').select('value').eq('key', 'preorder_days').maybeSingle(),
    ]).then(([m, o, s]) => {
      if (m.error || o.error) return setLoadError('โหลดเมนูไม่ได้ กรุณาลองใหม่อีกครั้ง')
      setMenu(m.data as MenuItem[])
      setOptions(o.data as Option[])
      if (typeof s.data?.value === 'number') setDays(s.data.value)
    }, () => setLoadError('เชื่อมต่อร้านไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'))
  }, [])

  const day = bangkokDay(dayOffset)
  useEffect(() => {
    if (!supabase) return
    let stale = false
    setSlots(undefined); setSlotError(undefined)
    supabase.rpc('available_slots', { p_day: day }).then(({ data, error: e }) => {
      if (stale) return
      if (e) setSlotError('โหลดช่องเวลารับไม่ได้ กรุณาลองใหม่อีกครั้ง')
      else setSlots(data as Slot[])
    }, () => !stale && setSlotError('เชื่อมต่อร้านไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'))
    return () => { stale = true }
  }, [day, reload])

  const categories = useMemo(() => [...new Set(menu.map((m) => m.category))], [menu])
  const kinds = useMemo(() => [...new Set(options.map((o) => o.kind))], [options])
  const cupsNeeded = lines.reduce((n, l) => n + l.item.cup_units * l.qty, 0)

  // ช่วยลูกค้าไม่ให้กดผิดเท่านั้น — กฎจริงบังคับที่ place_preorder
  const slotOk = (s: Slot) => s.bookable && s.cups_left >= cupsNeeded

  const addLine = (item: MenuItem) => setLines((ls) => [...ls, { key: Date.now() + Math.random(), item, qty: 1, picked: {} }])
  const patch = (key: number, f: (l: Line) => Line) => setLines((ls) => ls.map((l) => (l.key === key ? f(l) : l)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase || busy) return
    setError(undefined)
    if (!lines.length) return setError(thaiError('empty_order'))
    if (!pickup) return setError('กรุณาเลือกช่องเวลารับ')
    if (!name.trim() || !phone.trim()) return setError(thaiError('bad_customer'))
    setBusy(true)
    const items = lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty, options: Object.values(l.picked).filter(Boolean) }))
    try {
      const { data, error: err } = await supabase.rpc('place_preorder', { p_name: name.trim(), p_phone: phone.trim(), p_pickup: pickup, p_items: items })
      if (err) {
        setError(thaiError(err))
        setReload((n) => n + 1) // ช่องอาจเต็มไปแล้ว โหลดใหม่
        setPickup(undefined)
      } else setDone(data as Done)
    } catch (x) {
      setError(thaiError(x))
    } finally {
      setBusy(false)
    }
  }

  const back = <a className="btn btn-ghost" href="#/">กลับหน้าร้าน</a>

  if (!supabase) {
    return <main className="wrap po"><h1>สั่งกาแฟล่วงหน้า</h1><p className="note" role="alert">ตอนนี้ระบบสั่งล่วงหน้ายังไม่พร้อมใช้งาน กรุณาติดต่อร้านทาง LINE</p>{back}</main>
  }
  if (done) {
    return (
      <main className="wrap po">
        <h1>สั่งเรียบร้อยแล้ว</h1>
        <div className="po-done" role="status">
          <p>เลขออเดอร์</p>
          <strong className="po-code">{done.code}</strong>
          <p>รับที่ร้าน {dateTimeLabel(done.pickup_at)} น.</p>
          <p>ยอดรวม {baht(done.total)} บาท · จ่ายที่เคาน์เตอร์ตอนรับของ</p>
          <p className="note">จดเลขออเดอร์ไว้ และใช้เบอร์ที่กรอกตอนสั่งถ้าต้องการยกเลิก</p>
        </div>
        {back}
      </main>
    )
  }

  return (
    <main className="wrap po">
      <h1>สั่งกาแฟล่วงหน้า</h1>
      <p className="note">เลือกเมนู เลือกเวลารับ แล้วมารับที่ร้าน · จ่ายเงินที่เคาน์เตอร์ตอนรับของ</p>
      {loadError && <p className="po-error" role="alert">{loadError}</p>}

      <section aria-labelledby="po-menu">
        <h2 id="po-menu">1. เลือกเมนู</h2>
        {categories.map((cat) => (
          <div key={cat} className="po-cat">
            <h3>{cat}</h3>
            <ul className="po-menu">
              {menu.filter((m) => m.category === cat).map((m) => (
                <li key={m.id}>
                  <span>{m.name}</span>
                  <span className="po-price">{baht(m.price)}</span>
                  <button type="button" className="btn btn-ghost po-small" onClick={() => addLine(m)} aria-label={`เพิ่ม ${m.name}`}>เพิ่ม</button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h3>ตะกร้า</h3>
        {!lines.length && <p className="note">ยังไม่ได้เลือกเมนู</p>}
        <ul className="po-lines">
          {lines.map((l) => (
            <li key={l.key}>
              <div className="po-line-head">
                <strong>{l.item.name}</strong>
                <span className="po-qty">
                  <button type="button" className="btn btn-ghost po-small" aria-label="ลดจำนวน" onClick={() => patch(l.key, (x) => ({ ...x, qty: Math.max(1, x.qty - 1) }))}>−</button>
                  <span aria-live="polite">{l.qty}</span>
                  <button type="button" className="btn btn-ghost po-small" aria-label="เพิ่มจำนวน" onClick={() => patch(l.key, (x) => ({ ...x, qty: Math.min(20, x.qty + 1) }))}>+</button>
                </span>
                <button type="button" className="btn btn-ghost po-small" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`เอา ${l.item.name} ออก`}>เอาออก</button>
              </div>
              {l.item.is_drink && (
                <div className="po-opts">
                  {kinds.map((k) => (
                    <label key={k}>
                      <span>{kindName[k] ?? k}</span>
                      <select value={l.picked[k] ?? ''} onChange={(e) => patch(l.key, (x) => ({ ...x, picked: { ...x.picked, [k]: e.target.value } }))}>
                        <option value="">ไม่เลือก</option>
                        {options.filter((o) => o.kind === k).map((o) => (
                          <option key={o.label} value={o.label}>{o.label}{o.price_delta ? ` (+${o.price_delta})` : ''}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form onSubmit={submit} noValidate>
        <section aria-labelledby="po-time">
          <h2 id="po-time">2. เลือกเวลารับ</h2>
          <div className="po-days" role="group" aria-label="เลือกวัน">
            {Array.from({ length: days + 1 }, (_, i) => (
              <button type="button" key={i} className={`btn ${dayOffset === i ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={dayOffset === i}
                onClick={() => { setDayOffset(i); setPickup(undefined) }}>
                {i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : dayLabel(bangkokDay(i))}
              </button>
            ))}
          </div>
          <p className="note">{dayLabel(day)}</p>
          {slotError && <p className="po-error" role="alert">{slotError}</p>}
          {!slots && !slotError && <p className="note">กำลังโหลดช่องเวลา…</p>}
          <div className="po-slots" role="group" aria-label="ช่องเวลารับ">
            {slots?.map((s) => {
              const ok = slotOk(s)
              return (
                <button type="button" key={s.slot_start} disabled={!ok} aria-pressed={pickup === s.slot_start}
                  className={`po-slot${pickup === s.slot_start ? ' on' : ''}`} onClick={() => setPickup(s.slot_start)}
                  title={!s.bookable ? (s.cups_left === 0 ? 'เต็มแล้ว' : 'ปิดรับช่องนี้แล้ว') : !ok ? 'แก้วไม่พอ' : `เหลือ ${s.cups_left} แก้ว`}>
                  <span>{timeLabel(s.slot_start)}</span>
                  <small>{s.cups_left === 0 ? 'เต็ม' : !s.bookable ? 'ปิดรับ' : `เหลือ ${s.cups_left}`}</small>
                </button>
              )
            })}
          </div>
        </section>

        <section aria-labelledby="po-who">
          <h2 id="po-who">3. ชื่อและเบอร์โทร</h2>
          <label className="po-field"><span>ชื่อ</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
          </label>
          <label className="po-field"><span>เบอร์โทร</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required maxLength={20} />
          </label>
        </section>

        {error && <p className="po-error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'กำลังสั่ง…' : 'สั่งเลย'}</button>
          {back}
        </div>
      </form>
    </main>
  )
}
