// Money is always integer cents. Mirrors ios/LedgerCore/Sources/LedgerCore/Money.swift.
export type Cents = number
/** Calendar day as "yyyy-mm-dd". */
export type Day = string

const fmt = new Intl.NumberFormat('en-US')

export const Money = {
  /** "$1,234.56", negatives as "-$1,234.56". */
  format(cents: Cents, showCents = true): string {
    const neg = cents < 0
    const abs = Math.abs(cents)
    const dollars = Math.floor(abs / 100)
    const rem = abs % 100
    const body = showCents ? `$${fmt.format(dollars)}.${String(rem).padStart(2, '0')}` : `$${fmt.format(dollars)}`
    return neg ? `-${body}` : body
  },

  /** Plain "1234.56" for CSV and inputs. */
  plain(cents: Cents): string {
    const neg = cents < 0
    const a = Math.abs(cents)
    return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
  },

  /** Parses "$1,234.5", "1234", "1,234.56" into cents. Returns null if not a number. */
  parse(text: string | null | undefined): Cents | null {
    if (text == null) return null
    const cleaned = String(text).replace(/\$/g, '').replace(/,/g, '').trim()
    if (!cleaned || !/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
    const neg = cleaned.startsWith('-')
    const [whole, frac = ''] = cleaned.replace('-', '').split('.')
    // Round half away from zero on the third decimal, without floating point error.
    const f = (frac + '000').slice(0, 3)
    let cents = Number(whole || '0') * 100 + Number(f.slice(0, 2))
    if (Number(f[2]) >= 5) cents += 1
    return neg ? -cents : cents
  },

  /**
   * Splits `amount` across `weights` proportionally; shares always add up exactly to `amount`
   * (largest-remainder rounding). Same algorithm as the iPhone app, so both agree to the cent.
   */
  distribute(amount: Cents, weights: Cents[]): Cents[] {
    const total = weights.reduce((a, b) => a + b, 0)
    if (total === 0 || weights.length === 0) return weights.map(() => 0)
    if (weights.length === 1) return [amount]
    const shares: number[] = []
    const remainders: { index: number; rem: number }[] = []
    weights.forEach((w, i) => {
      const exact = (amount * w) / total
      const floored = Math.trunc(exact)
      shares.push(floored)
      remainders.push({ index: i, rem: Math.abs(exact - floored) })
    })
    let left = amount - shares.reduce((a, b) => a + b, 0)
    const step = left >= 0 ? 1 : -1
    remainders.sort((a, b) => (b.rem !== a.rem ? b.rem - a.rem : a.index - b.index))
    for (const r of remainders) {
      if (left === 0) break
      shares[r.index] += step
      left -= step
    }
    return shares
  },
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export const Days = {
  string(d: Date): Day {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },
  get today(): Day {
    return Days.string(new Date())
  },
  /** Local-midnight Date for a day string. */
  date(day: Day | null | undefined): Date | null {
    if (!day) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
    if (!m) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  },
  adding(days: number, day: Day): Day {
    const d = Days.date(day)
    if (!d) return day
    d.setDate(d.getDate() + days)
    return Days.string(d)
  },
  daysBetween(a: Day, b: Day): number {
    const da = Days.date(a)
    const db = Days.date(b)
    if (!da || !db) return 0
    const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())
    const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate())
    return Math.round((ub - ua) / 86_400_000)
  },
  display(day: Day | null | undefined): string {
    const d = Days.date(day)
    if (!d) return '-'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  },
}

export function uuid(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  // randomUUID only exists in secure contexts (https or localhost); plain http on a LAN IP falls back.
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
