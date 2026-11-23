// Live sync settings. On the server they come from /config.js, which the container writes at
// startup from SUPABASE_URL and SUPABASE_ANON_KEY. A partner can also enter them in the app
// (Welcome -> Live sync settings); that copy is kept in this browser only.
// The anon key is meant to be public: row-level security decides what each signed-in user can see.

declare global {
  interface Window { __LEDGER_CONFIG__?: { supabaseUrl?: string; supabaseAnonKey?: string } }
}

const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } }

export const AppConfig = {
  get serverUrl() { return (window.__LEDGER_CONFIG__?.supabaseUrl ?? '').trim() },
  get serverKey() { return (window.__LEDGER_CONFIG__?.supabaseAnonKey ?? '').trim() },
  get supabaseUrl() { return get('ledger.supabaseUrl') || this.serverUrl },
  set supabaseUrl(v: string) { set('ledger.supabaseUrl', v.trim() || null) },
  get supabaseAnonKey() { return get('ledger.supabaseAnonKey') || this.serverKey },
  set supabaseAnonKey(v: string) { set('ledger.supabaseAnonKey', v.trim() || null) },
  get isLiveConfigured() {
    try { return !!new URL(this.supabaseUrl).host && !!this.supabaseAnonKey } catch { return false }
  },
  get lastMode() { return get('ledger.lastMode') },
  set lastMode(v: string | null) { set('ledger.lastMode', v) },
  get lastWorkspace() { return get('ledger.lastWorkspace') },
  set lastWorkspace(v: string | null) { set('ledger.lastWorkspace', v) },
}
