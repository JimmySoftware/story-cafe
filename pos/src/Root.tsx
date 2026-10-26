import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { App } from './App.tsx'
import { configured, supabase } from './supabase.ts'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) setError(err.status === 400 ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : 'ล็อกอินไม่ได้ เช็กอินเทอร์เน็ตแล้วลองใหม่')
    } catch {
      setError('ล็อกอินไม่ได้ เช็กอินเทอร์เน็ตแล้วลองใหม่')
    }
    setBusy(false)
  }

  return (
    <main className="login">
      <form className="panel" onSubmit={submit}>
        <h1>Story Cafe POS</h1>
        <h2>เข้าสู่ระบบพนักงาน</h2>
        <label>อีเมล<input data-testid="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>รหัสผ่าน<input data-testid="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" className="primary" data-testid="login-submit" disabled={busy}>เข้าสู่ระบบ</button>
      </form>
    </main>
  )
}

export function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).catch(() => setSession(null))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured) return <p role="alert" className="error">ยังไม่ได้ตั้งค่าฐานข้อมูล: ใส่ SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY ใน .env แล้ว build ใหม่</p>
  if (session === undefined) return <p>กำลังตรวจสอบการเข้าสู่ระบบ…</p>
  return session ? <App onSignOut={() => void supabase.auth.signOut()} /> : <Login />
}
