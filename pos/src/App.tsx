import { useEffect, useMemo, useState } from 'react'
import { computeBill, type Bill, type BillInput, type BillLine, type Catalog } from './bill.ts'

type Options = NonNullable<BillLine['options']>
type Kind = 'size' | 'milk' | 'sweetness'

// ช่องกรอกว่าง = ไม่ระบุ · ไม่ใช่ตัวเลข = NaN เพื่อให้ computeBill เป็นคนบอกว่าผิด
const parseField = (text: string): number | undefined => (text.trim() === '' ? undefined : Number(text))

// ข้อความ error ของ computeBill คือ '<code>: ข้อความไทย' — แสดงเฉพาะข้อความไทย
const thaiMessage = (e: unknown): string => String(e instanceof Error ? e.message : e).replace(/^[a-z_]+: /, '')
const errorCode = (e: unknown): string => String(e instanceof Error ? e.message : e).split(':')[0]

export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lines, setLines] = useState<BillLine[]>([])
  const [item, setItem] = useState<string | null>(null)
  const [options, setOptions] = useState<Options>({})
  const [balance, setBalance] = useState('')
  const [redeem, setRedeem] = useState('')
  const [cash, setCash] = useState('')

  useEffect(() => {
    fetch('/catalog.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setCatalog)
      .catch(() => setLoadError('โหลดรายการเมนูไม่ได้ (catalog.json) ให้รัน npm run catalog ในโฟลเดอร์ pos/ แล้วเปิดใหม่'))
  }, [])

  // ตัวเลขทุกตัวในหน้าจอมาจาก computeBill เท่านั้น
  const result = useMemo(() => {
    if (!catalog || lines.length === 0) return { bill: null as Bill | null, short: false, error: null as string | null }
    const base: BillInput = { lines, points_balance: parseField(balance), redeem_points: parseField(redeem) }
    try {
      const bill = computeBill(base, catalog)
      const cashValue = parseField(cash)
      if (cashValue === undefined) return { bill, short: false, error: null }
      try {
        return { bill: computeBill({ ...base, cash_received: cashValue }, catalog), short: false, error: null }
      } catch (e) {
        if (errorCode(e) === 'cash_short') return { bill, short: true, error: null }
        throw e
      }
    } catch (e) {
      return { bill: null, short: false, error: thaiMessage(e) }
    }
  }, [catalog, lines, balance, redeem, cash])

  if (loadError) return <p role="alert" className="error">{loadError}</p>
  if (!catalog) return <p>กำลังโหลดเมนู…</p>

  const selected = catalog.items.find((i) => i.name === item)
  const isDrink = selected?.is_drink ?? false
  const labelsOf = (kind: Kind) => catalog.options.filter((o) => o.kind === kind)
  const extra = catalog.options.find((o) => o.kind === 'extra')
  const shots = options.extra_shots ?? 0

  const pick = (name: string) => {
    setItem(name)
    setOptions({})
  }
  const toggle = (kind: Kind, label: string) =>
    setOptions((o) => ({ ...o, [kind]: o[kind] === label ? undefined : label }))
  const addLine = () => {
    if (!item) return
    const clean = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined && v !== 0))
    setLines((l) => [...l, { item, qty: 1, ...(Object.keys(clean).length ? { options: clean as Options } : {}) }])
    setItem(null)
    setOptions({})
  }
  const optionButton = (kind: Kind, label: string, priceDelta: number) => (
    <button
      key={`${kind}-${label}`}
      type="button"
      data-testid={`opt-${kind}-${label}`}
      aria-pressed={options[kind] === label}
      disabled={!isDrink}
      onClick={() => toggle(kind, label)}
    >
      {label}
      {priceDelta !== 0 && <small> +{priceDelta}</small>}
    </button>
  )
  const bill = result.bill

  return (
    <main className="pos">
      <section className="panel">
        <h1>Story Cafe POS</h1>
        <h2>เมนู</h2>
        <div className="grid">
          {catalog.items.map((i) => (
            <button key={i.name} type="button" data-testid={`menu-${i.name}`} aria-pressed={item === i.name} onClick={() => pick(i.name)}>
              {i.name}
              <small>{i.price}</small>
            </button>
          ))}
        </div>

        <h2>ตัวเลือก {selected ? `· ${selected.name}` : '(เลือกเมนูก่อน)'}{selected && !isDrink && ' (ไม่ใช่เครื่องดื่ม)'}</h2>
        <fieldset>
          <legend>ขนาด</legend>
          {labelsOf('size').map((o) => optionButton('size', o.label, o.price_delta))}
        </fieldset>
        <fieldset>
          <legend>นม</legend>
          {labelsOf('milk').map((o) => optionButton('milk', o.label, o.price_delta))}
        </fieldset>
        <fieldset>
          <legend>ความหวาน</legend>
          {labelsOf('sweetness').map((o) => optionButton('sweetness', o.label, o.price_delta))}
        </fieldset>
        <fieldset>
          <legend>{extra?.label ?? 'ช็อตเพิ่ม'}</legend>
          <button type="button" data-testid="shots-minus" disabled={!isDrink || shots <= 0} onClick={() => setOptions((o) => ({ ...o, extra_shots: shots - 1 }))}>−</button>
          <output data-testid="shots-count" className="count">{shots}</output>
          <button type="button" data-testid="shots-plus" disabled={!isDrink || shots >= 4} onClick={() => setOptions((o) => ({ ...o, extra_shots: shots + 1 }))}>+</button>
        </fieldset>
        <button type="button" className="primary" data-testid="add-line" disabled={!item} onClick={addLine}>เพิ่มลงบิล</button>
      </section>

      <section className="panel">
        <h2>บิล</h2>
        {lines.length === 0 && <p>ยังไม่มีรายการ</p>}
        <ul className="bill-lines">
          {lines.map((l, idx) => {
            const b = bill?.lines[idx]
            return (
              <li key={idx} data-testid="bill-line">
                <span>{b?.label ?? l.item}</span>
                <span>{b ? `${b.line_total}` : ''}</span>
                <button type="button" aria-label={`ลบ ${l.item}`} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}>ลบ</button>
              </li>
            )
          })}
        </ul>

        <label>แต้มคงเหลือของลูกค้า<input data-testid="balance-input" type="number" inputMode="numeric" min="0" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label>แต้มที่ขอใช้<input data-testid="redeem-input" type="number" inputMode="numeric" min="0" value={redeem} onChange={(e) => setRedeem(e.target.value)} /></label>
        <label>เงินที่รับ (บาท)<input data-testid="cash-input" type="number" inputMode="numeric" min="0" value={cash} onChange={(e) => setCash(e.target.value)} /></label>

        {result.error && <p role="alert" className="error">{result.error}</p>}

        <dl className="sums">
          <dt>รวม (บาท)</dt><dd data-testid="subtotal">{bill ? bill.subtotal : '–'}</dd>
          <dt>ส่วนลดจากแต้ม (บาท)</dt><dd data-testid="discount">{bill ? bill.discount : '–'}</dd>
          <dt className="big">สุทธิ (บาท)</dt><dd className="big" data-testid="total">{bill ? bill.total : '–'}</dd>
          <dt>เงินทอน (บาท)</dt>
          <dd data-testid="change" className={result.short ? 'error' : undefined}>
            {result.short ? 'เงินไม่พอ' : bill && bill.change !== null ? bill.change : '–'}
          </dd>
          <dt>แต้มที่ได้</dt><dd data-testid="points-earned">{bill ? bill.points_earned : '–'}</dd>
        </dl>
      </section>
    </main>
  )
}
