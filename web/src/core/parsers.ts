// "Say it": turns a spoken sentence into suggested fields (LedgerCore/Parsers.swift VoiceParser).
// The user always reviews the suggestion before posting.
import { Money, Days, type Cents, type Day } from './money'
import type { BudgetCategory, Project, Vendor } from './models'

export interface Suggestion {
  vendor_name?: string
  vendor_id?: string
  date?: Day
  total_cents?: Cents
  tax_cents?: Cents
  invoice_number?: string
  description?: string
  project_id?: string
  category_id?: string
  paid_by_me?: boolean
  payment_method?: string
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export function findDate(text: string): Day | undefined {
  let m = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/.exec(text)
  if (m) {
    const mo = Number(m[1]), d = Number(m[2])
    let y = Number(m[3])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      if (y < 100) y += 2000
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  m = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(text)
  if (m) return `${m[3]}-${String(months.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
  return undefined
}

export function parseVoice(transcript: string, projects: Project[], vendors: Vendor[], categories: BudgetCategory[], today: Day = Days.today): Suggestion {
  const s: Suggestion = {}
  const t = transcript.toLowerCase()
  const num = String.raw`((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)`

  let m = new RegExp(String.raw`\$\s?` + num).exec(transcript)
    ?? new RegExp(num + String.raw`\s*(?:dollars|bucks|usd)`).exec(t)
    ?? new RegExp(String.raw`(?:spent|paid|cost|was|for)\s+` + num).exec(t)
  if (m) s.total_cents = Money.parse(m[1]) ?? undefined

  const v = vendors.find((x) => t.includes(x.name.toLowerCase()))
  if (v) {
    s.vendor_id = v.id
    s.vendor_name = v.name
  } else {
    m = /\b(?:at|from)\s+([a-z0-9'&. ]{2,40}?)(?=\s+(?:on|for|with|paid|using|to|yesterday|today)\b|[,.]|$)/.exec(t)
    if (m) s.vendor_name = titleCase(m[1].trim())
  }

  const words = new Set(t.split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const ignore = new Set(['st', 'street', 'rd', 'road', 'ave', 'the', 'flip', 'new', 'build', 'house', 'lot'])
  const scored = projects
    .map((p) => [p, p.nickname.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !ignore.has(w) && words.has(w)).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  if (scored.length) s.project_id = scored[0][0].id

  s.category_id = categories.find((c) => t.includes(c.name.toLowerCase()))?.id
  if (!s.category_id) {
    const hints: [string, string[]][] = [
      ['Materials', ['drywall', 'lumber', 'tile', 'paint', 'materials', 'supplies', 'screws', 'fixtures', 'flooring']],
      ['Plumbing', ['plumb', 'pipe', 'faucet', 'water heater']], ['Electrical', ['electric', 'wiring', 'panel', 'outlet']],
      ['Permits', ['permit', 'inspection fee']], ['Utilities', ['water bill', 'electric bill', 'utility', 'utilities']],
      ['Equipment Rentals', ['rental', 'rent a', 'dumpster', 'excavator']], ['Labor', ['labor', 'worker', 'crew', 'helper']],
      ['HVAC', ['hvac', 'furnace', 'air condition', 'duct']], ['Framing', ['framing', 'framer']], ['Demolition', ['demo', 'demolition']],
    ]
    for (const [name, keys] of hints) {
      if (keys.some((k) => t.includes(k))) {
        const c = categories.find((x) => x.name === name)
        if (c) { s.category_id = c.id; break }
      }
    }
  }

  if (['my card', 'my own', 'i paid', 'personal', 'my credit', 'my debit', 'out of pocket', 'my cash', 'my money'].some((k) => t.includes(k))) s.paid_by_me = true
  else if (['llc', 'company', 'business account', 'business card', 'company card'].some((k) => t.includes(k))) s.paid_by_me = false
  if (t.includes('zelle')) s.payment_method = 'zelle'
  else if (t.includes('check')) s.payment_method = 'check'
  else if (t.includes('cash')) s.payment_method = 'cash'
  else if (t.includes('card')) s.payment_method = 'card'

  s.date = t.includes('yesterday') ? Days.adding(-1, today) : (findDate(transcript) ?? today)

  m = /\b(?:on|for)\s+([a-z0-9 ,'&-]{3,60}?)(?=\s+(?:for|at|on|paid|using|with)\b|[.]|$)/.exec(t)
  if (m) {
    const d = m[1].trim()
    s.description = d.charAt(0).toUpperCase() + d.slice(1)
  }
  return s
}
