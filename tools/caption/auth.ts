export interface AuthInfo {
  mode: 'login' | 'api-key'
  keyOk: boolean | null
}

// ตรวจแค่รูปแบบของ key (ไม่ยิงเน็ต และไม่คืนค่า key ออกไป)
export function checkAuth(env: Record<string, string | undefined>): AuthInfo {
  const key = env.ANTHROPIC_API_KEY?.trim()
  if (!key) return { mode: 'login', keyOk: null }
  return { mode: 'api-key', keyOk: key.startsWith('sk-ant-') && key.length >= 20 }
}
