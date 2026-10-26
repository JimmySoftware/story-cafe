/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly SUPABASE_URL: string
  readonly SUPABASE_PUBLISHABLE_KEY: string
}
