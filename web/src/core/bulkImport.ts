// Bulk upload: many receipts and bills at once from a CSV file (from Excel, Numbers or Google Sheets).
// Each row becomes the same draft the Add form makes, so it goes through the same checks and posting.
import { Money, Days, uuid, type Day } from './money'
import { PaymentMethods, isActiveProject } from './models'
import type { Ledger } from './ledger'
import { newDraft, type TransactionDraft } from '../drafts'

export const importColumns = [
  'type', 'date', 'project', 'vendor', 'category', 'amount', 'tax', 'description',
  'paid_by', 'payment_method', 'reference', 'invoice_number', 'due_date', 'notes',
] as const

/** What each column means. Shown on the page and in the template's notes file. */
export const columnHelp: [string, string][] = [
  ['type', 'receipt (already paid), bill (still owed), or contribution (a partner putting money into the LLC account). Blank means receipt.'],
  ['date', 'Date on the receipt or bill: 2026-11-20 or 11/20/2026.'],
  ['project', 'Project nickname or address, exactly as in the app. Contributions can leave it blank for LLC-wide money.'],
  ['vendor', 'Vendor name. A new name creates the vendor. Leave blank for contributions.'],
  ['category', 'Budget category name, e.g. Materials. Blank leaves it uncategorized.'],
  ['amount', 'Total including tax, e.g. 1250.50. Negative for a refund receipt.'],
  ['tax', 'Optional. Tax included in the amount.'],
  ['description', 'Optional. What it was for.'],
  ['paid_by', 'Receipts: partner name or email if they paid personally, or LLC. Blank means you. Contributions: the partner who put the money in.'],
  ['payment_method', `Receipts: ${PaymentMethods.map(([k]) => k).join(', ')}. Blank means card.`],
  ['reference', 'Optional. Check #, confirmation #, last 4 of card.'],
  ['invoice_number', 'Bills: the vendor’s invoice number.'],
  ['due_date', 'Bills: when it’s due. Blank means no due date.'],
  ['notes', 'Optional. Any note to keep with the record, e.g. “rent deducted for renovation work”. Doesn’t change amounts.'],
]

const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Template with the header row and two example rows using this LLC's own names, so it imports as is. */
export function templateCSV(l: Ledger): string {
  const project = l.s.projects.find(isActiveProject)?.nickname ?? 'Oak St Flip'
  const cat = (name: string) => l.activeCategories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name ?? l.activeCategories[0]?.name ?? name
  const today = Days.today
  const rows = [
    ['receipt', Days.adding(-2, today), project, 'Home Depot', cat('Materials'), '186.40', '12.90', 'Drywall screws and joint compound', '', 'card', '4421', '', '', ''],
    ['bill', Days.adding(-1, today), project, 'ABC Plumbing', cat('Plumbing'), '4500.00', '', 'Rough-in plumbing', 'LLC', '', '', 'ABC-1010', Days.adding(29, today), 'Per contract, 50% at rough-in'],
  ]
  return '﻿' + [importColumns.join(','), ...rows.map((r) => r.map(q).join(','))].join('\r\n') + '\r\n'
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. Also reads tab- or semicolon-separated files. */
export function parseCSV(text: string): string[][] {
  const t = text.replace(/^﻿/, '')
  const firstLine = t.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t'
    : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let f = ''
  let inQ = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQ) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else inQ = false }
      else f += c
    } else if (c === '"' && f === '') inQ = true
    else if (c === sep) { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(f); rows.push(row); row = []; f = ''
    } else f += c
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

/** "2026-11-20", "11/20/2026", "11/20/26", "2026/11/20" → "2026-11-20". */
export function parseDay(v: string): Day | null {
  const s = v.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s)
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2])
  return null
}
function valid(y: number, mo: number, d: number): Day | null {
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? Days.string(dt) : null
}

export interface ImportRow {
  line: number            // spreadsheet row number (header is row 1)
  values: Record<string, string>
  draft: TransactionDraft | null
  errors: string[]
  warnings: string[]
  /** True when a matching receipt or bill is already in the books, or earlier in this file. Unchecked by default. */
  duplicate: boolean
  /** Set instead of draft for a contribution row. */
  contribution?: ImportContribution | null
}

/** A partner putting money into the LLC account. */
export interface ImportContribution {
  id: string
  partner_user_id: string
  project_id: string | null
  amount_cents: number
  contribution_date: Day
  payment_method: string
  reference: string
  notes: string
}

const contributionTypes = ['contribution', 'capital', 'capital contribution', 'deposit', 'money in']

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const headerKey = (h: string) => norm(h).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const aliases: Record<string, string> = {
  kind: 'type', total: 'amount', total_amount: 'amount', amount_usd: 'amount', property: 'project', supplier: 'vendor',
  payee: 'vendor', paid_by_partner: 'paid_by', payer: 'paid_by', method: 'payment_method', invoice: 'invoice_number',
  invoice_no: 'invoice_number', due: 'due_date', memo: 'description', note: 'notes', review_note: 'notes', comments: 'notes', comment: 'notes',
}

/** Turns the parsed file into checked rows. Nothing is saved here. */
export function readImport(table: string[][], l: Ledger, me: string | null): { rows: ImportRow[]; missingColumns: string[] } {
  if (table.length === 0) return { rows: [], missingColumns: ['type', 'date', 'project', 'vendor', 'amount'] }
  const keys = table[0].map((h) => { const k = headerKey(h); return aliases[k] ?? k })
  const missingColumns = ['date', 'amount'].filter((k) => !keys.includes(k))
  if (missingColumns.length) return { rows: [], missingColumns }
  const seen = new Map<string, number>()
  const rows = table.slice(1).map((cells, i): ImportRow => {
    const v: Record<string, string> = {}
    keys.forEach((k, j) => { v[k] = (cells[j] ?? '').trim() })
    const errors: string[] = []
    const warnings: string[] = []
    const type = norm(v.type ?? '')
    if (contributionTypes.includes(type)) return readContribution(v, i, l, me, seen)
    const kind: 'receipt' | 'bill' | null = !type || ['receipt', 'expense', 'paid'].includes(type) ? 'receipt' : ['bill', 'invoice', 'owed'].includes(type) ? 'bill' : null
    if (!kind) errors.push(`Type “${v.type}” should be receipt, bill or contribution.`)
    const d = newDraft(kind ?? 'receipt')

    const date = parseDay(v.date ?? '')
    if (!date) errors.push(v.date ? `Date “${v.date}” isn’t a date like 2026-11-20 or 11/20/2026.` : 'Date is missing.')
    else d.date = date

    const pname = norm(v.project ?? '')
    const project = l.s.projects.find((p) => norm(p.nickname) === pname) ?? l.s.projects.find((p) => norm(p.address) === pname)
    if (!pname) errors.push('Project is missing.')
    else if (!project) errors.push(`No project named “${v.project}”.`)
    else d.project_id = project.id

    const vname = (v.vendor ?? '').trim()
    const vendor = l.s.vendors.find((x) => norm(x.name) === norm(vname))
    if (!vname) errors.push('Vendor is missing.')
    else if (vendor) d.vendor_id = vendor.id
    else { d.new_vendor_name = vname; warnings.push(`New vendor “${vname}” will be added.`) }

    const amount = Money.parse(v.amount)
    if (amount == null) errors.push(v.amount ? `Amount “${v.amount}” isn’t a number.` : 'Amount is missing.')
    else if (amount === 0) errors.push('Amount is zero.')
    else if (amount < 0 && kind === 'bill') errors.push('A bill amount must be positive. Enter vendor credits on the bill instead.')
    else { d.total_text = Money.plain(Math.abs(amount)); d.is_refund = amount < 0 }

    if (v.tax) {
      const tax = Money.parse(v.tax)
      if (tax == null || tax < 0) errors.push(`Tax “${v.tax}” isn’t a number.`)
      else if (amount != null && tax > Math.abs(amount)) errors.push('Tax is more than the amount.')
      else d.tax_text = Money.plain(tax)
    }

    if (v.category) {
      const c = l.s.categories.find((x) => norm(x.name) === norm(v.category))
      if (!c) errors.push(`No budget category named “${v.category}”.`)
      else {
        d.splits = [{ ...d.splits[0], category_id: c.id }]
        if (c.archived) warnings.push(`Category “${c.name}” is hidden.`)
      }
    }
    // An older file with only a Notes column (no Description) keeps using it as the description.
    if (v.description === undefined && v.notes) d.description = v.notes
    else { d.description = v.description ?? ''; d.notes = v.notes ?? '' }
    d.reference = v.reference ?? ''

    if (kind === 'receipt') {
      const who = norm(v.paid_by ?? '')
      if (!who || who === 'me') d.payer = me ? 'me' : 'llc'
      else if (['llc', 'company', 'business', 'llc account'].includes(who)) d.payer = 'llc'
      else {
        const m = l.s.members.find((x) => norm(x.display_name) === who || norm(x.email ?? '') === who)
        if (!m) errors.push(`No partner named “${v.paid_by}”. Use a partner’s name or email, or LLC.`)
        else { d.payer = m.user_id === me ? 'me' : m.user_id; if (m.access_revoked_at) warnings.push(`${m.display_name}’s access was removed.`) }
      }
      const method = norm(v.payment_method ?? '')
      if (method) {
        const pm = PaymentMethods.find(([k, label]) => k === method || norm(label) === method || (method === 'credit card' && k === 'card') || (method === 'debit card' && k === 'card'))
        if (!pm) errors.push(`Payment method “${v.payment_method}” should be one of ${PaymentMethods.map(([k]) => k).join(', ')}.`)
        else d.payment_method = pm[0]
      }
      if (v.invoice_number && !d.reference) d.reference = v.invoice_number
    } else if (kind === 'bill') {
      d.invoice_number = v.invoice_number ?? ''
      if (v.due_date) {
        const due = parseDay(v.due_date)
        if (!due) errors.push(`Due date “${v.due_date}” isn’t a date.`)
        else if (date && due < date) errors.push('Due date is before the bill date.')
        else d.due_date = due
      }
      if (v.paid_by && !['llc', ''].includes(norm(v.paid_by))) warnings.push('Paid by is ignored for bills. Record payments on the bill after importing.')
    }

    // Duplicates: already in the books (same vendor and amount within 3 days, or same invoice #), or repeated in this file.
    let duplicate = false
    if (!errors.length && amount != null) {
      const inBooks = d.vendor_id ? l.possibleDuplicates(d.vendor_id, d.date, Math.abs(amount), d.invoice_number) : []
      if (inBooks.length) { duplicate = true; warnings.push(`Looks like ${inBooks[0].title} on ${Days.display(inBooks[0].date)}, already entered.`) }
      // A different reference (check #, confirmation #) means a different payment, even for the same vendor, day and amount.
      const key = [kind, norm(vname), d.date, amount, norm(d.invoice_number), norm(d.reference)].join('|')
      const earlier = seen.get(key)
      if (earlier) { duplicate = true; warnings.push(`Same as row ${earlier} in this file.`) } else seen.set(key, i + 2)
    }
    return { line: i + 2, values: v, draft: errors.length ? null : d, errors, warnings, duplicate }
  })
  return { rows, missingColumns }
}


function readContribution(v: Record<string, string>, i: number, l: Ledger, me: string | null, seen: Map<string, number>): ImportRow {
  const errors: string[] = []
  const warnings: string[] = []
  const date = parseDay(v.date ?? '')
  if (!date) errors.push(v.date ? `Date “${v.date}” isn’t a date like 2026-11-20 or 11/20/2026.` : 'Date is missing.')
  let project_id: string | null = null
  const pname = norm(v.project ?? '')
  if (pname) {
    const project = l.s.projects.find((p) => norm(p.nickname) === pname) ?? l.s.projects.find((p) => norm(p.address) === pname)
    if (!project) errors.push(`No project named “${v.project}”.`)
    else project_id = project.id
  }
  const who = norm(v.paid_by ?? '')
  let partner: string | null = null
  if (!who || who === 'me') { partner = me; if (!me) errors.push('Paid by is missing: name the partner who put the money in.') }
  else {
    const m = l.s.members.find((x) => norm(x.display_name) === who || norm(x.email ?? '') === who)
    if (!m) errors.push(`No partner named “${v.paid_by}”. A contribution needs a partner’s name or email.`)
    else { partner = m.user_id; if (m.access_revoked_at) warnings.push(`${m.display_name}’s access was removed.`) }
  }
  const amount = Money.parse(v.amount)
  if (amount == null) errors.push(v.amount ? `Amount “${v.amount}” isn’t a number.` : 'Amount is missing.')
  else if (amount <= 0) errors.push('A contribution must be more than zero.')
  let payment_method = 'ach'
  const method = norm(v.payment_method ?? '')
  if (method) {
    const pm = PaymentMethods.find(([k, label]) => k === method || norm(label) === method)
    if (!pm) errors.push(`Payment method “${v.payment_method}” should be one of ${PaymentMethods.map(([k]) => k).join(', ')}.`)
    else payment_method = pm[0]
  }
  if (v.vendor) warnings.push('Vendor is ignored for contributions.')
  let duplicate = false
  if (!errors.length && partner && date && amount != null) {
    const inBooks = l.s.contributions.find((c) => c.status !== 'void' && c.partner_user_id === partner && c.amount_cents === amount && c.contribution_date === date)
    if (inBooks) { duplicate = true; warnings.push('Looks like a contribution already entered.') }
    const key = ['contribution', partner, date, amount, project_id ?? ''].join('|')
    const earlier = seen.get(key)
    if (earlier) { duplicate = true; warnings.push(`Same as row ${earlier} in this file.`) } else seen.set(key, i + 2)
  }
  const contribution: ImportContribution | null = errors.length ? null : {
    id: uuid(), partner_user_id: partner!, project_id, amount_cents: amount!, contribution_date: date!,
    payment_method, reference: v.reference ?? '', notes: [v.description, v.notes].filter(Boolean).join(' · '),
  }
  return { line: i + 2, values: v, draft: null, errors, warnings, duplicate, contribution }
}
