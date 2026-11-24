// Statement matching, missing receipts, weekly review, 30-day cash needs and flip profit forecasts.
// Pure functions over the Ledger, so the web app (and its tests) and the iPhone app can apply the same rules.
import { Money, Days, type Cents, type Day } from './money'
import { RecordStatus, refKey, type Entry, type EntryRef, type Expense, type BillPayment, type StatementLine, type Claim, type ClaimKind, type InboxItem, type Project } from './models'
import type { Ledger } from './ledger'
import { parseCSV, parseDay } from './bulkImport'

const isVoid = (r: { status: string }) => r.status === RecordStatus.void
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Statement CSV import
// ---------------------------------------------------------------------------

export interface ParsedStatement {
  lines: { posted_date: Day; description: string; amount_cents: Cents }[]
  /** Rows that couldn't be read, with the reason. */
  skipped: { row: number; reason: string }[]
  /** True when charges appear as negative numbers in the file (most card exports). */
  chargesNegative: boolean
  error?: string
}

const pickCol = (keys: string[], names: string[]) => keys.findIndex((k) => names.includes(k))

/**
 * Reads the CSV a bank or card site exports. Finds the date, description and amount columns by their usual names
 * (or separate Debit/Credit columns). Returns money out as positive amounts.
 * `chargesNegative`: undefined = decide from the file (most rows negative means charges are negative).
 */
export function parseStatement(text: string, chargesNegative?: boolean): ParsedStatement {
  const table = parseCSV(text)
  const empty = { lines: [], skipped: [], chargesNegative: chargesNegative ?? true }
  // Some banks put a few lines of account info above the header; use the first row that names a date column.
  const headerAt = table.findIndex((r) => r.some((c) => /date/i.test(c)))
  if (headerAt < 0) return { ...empty, error: 'Couldn’t find a header row with a Date column. Export the statement as CSV from your bank’s website.' }
  const keys = table[headerAt].map((h) => norm(h))
  const dateCol = pickCol(keys, ['transaction date', 'trans date', 'date', 'posted date', 'post date', 'posting date'])
  const descCol = pickCol(keys, ['description', 'payee', 'merchant', 'name', 'details', 'memo', 'transaction description'])
  const amtCol = pickCol(keys, ['amount', 'transaction amount', 'amount usd'])
  const debitCol = pickCol(keys, ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'charge'])
  const creditCol = pickCol(keys, ['credit', 'credits', 'deposit', 'deposits', 'money in', 'payment'])
  if (dateCol < 0) return { ...empty, error: 'No Date column found.' }
  if (amtCol < 0 && debitCol < 0) return { ...empty, error: 'No Amount (or Debit/Credit) column found.' }
  const raw: { row: number; date: Day | null; desc: string; amount: Cents | null; split: boolean; rawDate: string }[] = []
  table.slice(headerAt + 1).forEach((r, i) => {
    const row = headerAt + i + 2
    const date = parseDay(r[dateCol] ?? '')
    const desc = (descCol >= 0 ? r[descCol] : '')?.trim() ?? ''
    if (amtCol >= 0) {
      const v = (r[amtCol] ?? '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''))
      raw.push({ row, date, desc, amount: Money.parse(v), split: false, rawDate: r[dateCol] ?? '' })
    } else {
      const d = Money.parse(r[debitCol] ?? ''), c = creditCol >= 0 ? Money.parse(r[creditCol] ?? '') : null
      raw.push({ row, date, desc, amount: d ? Math.abs(d) : c ? -Math.abs(c) : null, split: true, rawDate: r[dateCol] ?? '' })
    }
  })
  const signed = raw.filter((x) => !x.split && x.amount)
  const neg = chargesNegative ?? (signed.filter((x) => x.amount! < 0).length >= signed.length / 2)
  const lines: ParsedStatement['lines'] = []
  const skipped: ParsedStatement['skipped'] = []
  for (const x of raw) {
    if (!x.date) { skipped.push({ row: x.row, reason: x.rawDate ? `Date “${x.rawDate}” not understood` : 'No date' }); continue }
    if (!x.amount) { skipped.push({ row: x.row, reason: 'No amount' }); continue }
    lines.push({ posted_date: x.date, description: x.desc, amount_cents: x.split ? x.amount : neg ? -x.amount : x.amount })
  }
  return { lines, skipped, chargesNegative: neg }
}

/** Same statement row imported twice gets the same fingerprint, so it's skipped. `n` counts identical rows within one file. */
export function fingerprint(account: string, l: { posted_date: Day; description: string; amount_cents: Cents }, n: number): string {
  return [norm(account), l.posted_date, l.amount_cents, norm(l.description), n].join('|')
}

/** Store names on card statements are noisy ("HOMEDEPOT #6512 ATLANTA GA"); this guesses a readable vendor name. */
export function vendorFromDescription(desc: string, l: Ledger): { vendor_id: string | null; name: string } {
  const d = norm(desc).replace(/\s+/g, '')
  const known = [...l.s.vendors].sort((a, b) => b.name.length - a.name.length).find((v) => {
    const n = norm(v.name).replace(/\s+/g, '')
    return n.length >= 3 && d.includes(n)
  })
  if (known) return { vendor_id: known.id, name: known.name }
  const cleaned = desc.replace(/^(sq \*|tst\* |pos |debit card purchase |purchase )/i, '').replace(/[#*]\s*\d+.*$/, '').replace(/\s{2,}.*$/, '')
    .replace(/\b\d{3,}\b.*$/, '').trim()
  const name = cleaned.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 60)
  return { vendor_id: null, name: name || desc.slice(0, 60) }
}

// ---------------------------------------------------------------------------
// Matching statement lines to receipts and bill payments
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  ref: EntryRef
  entry: Entry
  amount_cents: Cents
  score: number
  why: string
}

/** Days a card charge can post after the receipt date (and a little before, for pre-authorizations). */
export const MATCH_DAYS_AFTER = 5
export const MATCH_DAYS_BEFORE = 2

export function matchedRecordIds(l: Ledger): Set<string> {
  return new Set(l.s.statement_matches.flatMap((m) => [m.expense_id, m.bill_payment_id].filter(Boolean) as string[]))
}

export function lineMatchedCents(l: Ledger, lineId: string): Cents {
  return l.s.statement_matches.filter((m) => m.statement_line_id === lineId).reduce((a, m) => {
    if (m.expense_id) { const e = l.s.expenses.find((x) => x.id === m.expense_id); return a + (e ? (e.is_refund ? -e.total_cents : e.total_cents) : 0) }
    const p = l.s.payments.find((x) => x.id === m.bill_payment_id)
    return a + (p ? (p.kind === 'refund' ? -p.amount_cents : p.amount_cents) : 0)
  }, 0)
}

/**
 * Receipts and bill payments that could explain a statement line: same amount (or the part not matched yet),
 * dated within a few days, paid from the same card's owner (or the LLC), not already matched.
 * Best first. Both apps use these rules so they suggest the same matches.
 */
export function suggestMatches(l: Ledger, line: StatementLine): MatchCandidate[] {
  const used = matchedRecordIds(l)
  const left = line.amount_cents - lineMatchedCents(l, line.id)
  if (left === 0) return []
  const desc = norm(line.description).replace(/\s+/g, '')
  const out: MatchCandidate[] = []
  const consider = (ref: EntryRef, date: Day, amount: Cents, payer: string | null | undefined, vendorId: string) => {
    if (used.has(ref.id) || amount !== left) return
    const days = Days.daysBetween(date, line.posted_date)
    if (days > MATCH_DAYS_AFTER || days < -MATCH_DAYS_BEFORE) return
    const samePayer = (payer ?? null) === (line.account_owner ?? null)
    const vname = norm(l.vendor(vendorId)?.name ?? '').replace(/\s+/g, '')
    const vendorHit = vname.length >= 3 && desc.includes(vname.slice(0, Math.min(vname.length, 8)))
    const entry = l.entry(ref)
    if (!entry) return
    const score = 100 - Math.abs(days) * 8 + (samePayer ? 25 : -30) + (vendorHit ? 30 : 0)
    const why = [Math.abs(days) === 0 ? 'same day' : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} apart`,
      vendorHit ? 'vendor name matches' : null, samePayer ? null : 'paid by someone else'].filter(Boolean).join(' · ')
    out.push({ ref, entry, amount_cents: amount, score, why })
  }
  for (const e of l.s.expenses) if (e.status === RecordStatus.posted) consider({ kind: 'expense', id: e.id }, e.expense_date, e.is_refund ? -e.total_cents : e.total_cents, e.paid_by_user_id, e.vendor_id)
  for (const p of l.s.payments) {
    if (p.status !== RecordStatus.posted || p.kind === 'credit') continue
    const b = l.bill(p.bill_id)
    if (b) consider({ kind: 'payment', id: p.id }, p.payment_date, p.kind === 'refund' ? -p.amount_cents : p.amount_cents, p.paid_by_user_id, b.vendor_id)
  }
  return out.sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// Missing receipts
// ---------------------------------------------------------------------------

export interface MissingReceipt {
  /** A posted receipt with no document, or a card charge with no receipt entered yet. */
  kind: 'no_document' | 'unmatched_charge'
  key: string
  date: Day
  title: string
  subtitle: string
  amount_cents: Cents
  /** Partner who should clean it up: who paid (or whose card), else who entered it. */
  owner: string | null
  expense?: Expense
  payment?: BillPayment
  line?: StatementLine
}

export function missingReceipts(l: Ledger): MissingReceipt[] {
  const withDocs = new Set(l.s.attachments.flatMap((a) => [a.expense_id, a.bill_payment_id].filter(Boolean) as string[]))
  const out: MissingReceipt[] = []
  for (const e of l.s.expenses) {
    if (e.status !== RecordStatus.posted || withDocs.has(e.id)) continue
    out.push({ kind: 'no_document', key: `expense:${e.id}`, date: e.expense_date, title: l.vendor(e.vendor_id)?.name ?? 'Receipt',
      subtitle: `Receipt · ${l.project(e.project_id)?.nickname ?? ''} · no document attached`, amount_cents: e.is_refund ? -e.total_cents : e.total_cents,
      owner: e.paid_by_user_id ?? e.created_by ?? null, expense: e })
  }
  for (const line of l.s.statement_lines) {
    if (line.status !== 'unmatched' || line.amount_cents <= 0) continue
    out.push({ kind: 'unmatched_charge', key: `line:${line.id}`, date: line.posted_date, title: line.description || 'Card charge',
      subtitle: `${line.account} · charge with no receipt entered`, amount_cents: line.amount_cents, owner: line.account_owner ?? line.created_by ?? null, line })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

// ---------------------------------------------------------------------------
// Weekly partner review
// ---------------------------------------------------------------------------

export interface ReviewItem {
  claimKind: ClaimKind
  id: string
  title: string
  subtitle: string
  amount_cents: Cents
  date: Day
  link: string
  claim?: Claim
}

export interface WeeklyReview {
  billsDue: ReviewItem[]
  approvals: ReviewItem[]
  reimbursementsToPay: ReviewItem[]
  inbox: ReviewItem[]
  unmatched: ReviewItem[]
  missing: MissingReceipt[]
}

export function weeklyReview(l: Ledger, days = 7): WeeklyReview {
  const today = l.today
  const until = Days.adding(days, today)
  const claimOf = (kind: ClaimKind, id: string) => l.s.claims.find((c) => c.item_kind === kind && c.item_id === id)
  const item = (kind: ClaimKind, id: string, x: Omit<ReviewItem, 'claimKind' | 'id' | 'claim'>): ReviewItem => ({ claimKind: kind, id, ...x, claim: claimOf(kind, id) })
  const billsDue = l.s.bills.filter((b) => b.status === RecordStatus.posted && l.balance(b.id).outstanding_cents > 0 && b.due_date && b.due_date <= until)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
    .map((b) => item('bill', b.id, { title: l.vendor(b.vendor_id)?.name ?? 'Bill', date: b.due_date!, link: `/records/bill/${b.id}`,
      subtitle: `${b.due_date! < today ? 'Overdue since' : 'Due'} ${Days.display(b.due_date)} · ${l.project(b.project_id)?.nickname ?? ''}${b.invoice_number ? ` · #${b.invoice_number}` : ''}`,
      amount_cents: l.balance(b.id).outstanding_cents }))
  const approvals: ReviewItem[] = [
    ...l.s.bills.filter((b) => b.status === RecordStatus.pendingReview).map((b) => item('bill', b.id, { title: l.vendor(b.vendor_id)?.name ?? 'Bill',
      subtitle: `Bill waiting for approval · ${l.project(b.project_id)?.nickname ?? ''}`, amount_cents: b.total_cents, date: b.bill_date, link: `/records/bill/${b.id}` })),
    ...l.s.change_orders.filter((c) => c.status === RecordStatus.pendingReview).map((c) => {
      const cm = l.s.commitments.find((x) => x.id === c.commitment_id)
      return item('change_order', c.id, { title: l.vendor(cm?.vendor_id)?.name ?? 'Change order', subtitle: `Change order · ${c.description || ''}`,
        amount_cents: c.amount_cents, date: (c.created_at ?? today).slice(0, 10), link: `/records/changeOrder/${c.id}` })
    }),
    ...l.s.reimbursements.filter((r) => r.status === RecordStatus.requested && l.s.workspace.require_review).map((r) => item('reimbursement', r.id, {
      title: `Reimburse ${l.payerName(r.partner_user_id)}`, subtitle: 'Reimbursement request waiting for approval', amount_cents: r.amount_cents, date: r.request_date, link: `/records/reimbursement/${r.id}` })),
  ]
  const reimbursementsToPay = l.s.reimbursements.filter((r) => r.status === RecordStatus.approved || (r.status === RecordStatus.requested && !l.s.workspace.require_review))
    .map((r) => item('reimbursement', r.id, { title: `Reimburse ${l.payerName(r.partner_user_id)}`, subtitle: `Requested ${Days.display(r.request_date)}`,
      amount_cents: r.amount_cents, date: r.request_date, link: `/records/reimbursement/${r.id}` }))
  const inbox = l.s.inbox_items.filter((i) => i.status === 'new').map((i) => item('inbox_item', i.id, { title: i.suggested_vendor || i.filename,
    subtitle: `In the inbox since ${Days.display((i.created_at ?? today).slice(0, 10))}${i.note ? ` · ${i.note}` : ''}`, amount_cents: i.suggested_total_cents ?? 0,
    date: (i.created_at ?? today).slice(0, 10), link: '/inbox' }))
  const unmatched = l.s.statement_lines.filter((s) => s.status === 'unmatched').map((s) => item('statement_line', s.id, { title: s.description || 'Statement line',
    subtitle: `${s.account} · ${Days.display(s.posted_date)}`, amount_cents: s.amount_cents, date: s.posted_date, link: '/statements' }))
  return { billsDue, approvals, reimbursementsToPay, inbox, unmatched, missing: missingReceipts(l) }
}

// ---------------------------------------------------------------------------
// Cash needed in the next 30 days
// ---------------------------------------------------------------------------

export interface CashEvent {
  date: Day
  kind: 'bill' | 'reimbursement' | 'draw'
  title: string
  subtitle: string
  project_id: string | null
  amount_cents: Cents
  link: string
}

export interface CashDay { date: Day; out_cents: Cents; balance_cents: Cents | null; events: CashEvent[] }

export interface CashPlan {
  cash_on_hand_cents: Cents | null
  as_of: Day | null
  events: CashEvent[]
  days: CashDay[]
  total_cents: Cents
  byProject: { project_id: string | null; total_cents: Cents }[]
  /** First day expected payments exceed the cash on hand, if any. */
  shortfall?: { date: Day; short_by_cents: Cents }
}

/**
 * What the LLC is expected to pay out from today through `days` ahead: unpaid bills by due date (overdue and
 * undated ones count today), reimbursements ready to pay (today), and scheduled contractor draws. Draws are capped
 * at what's still unbilled on their agreement, earliest first, so a draw that has already been invoiced isn't
 * counted twice.
 */
export function cashPlan(l: Ledger, days = 30): CashPlan {
  const today = l.today
  const until = Days.adding(days, today)
  const events: CashEvent[] = []
  for (const b of l.s.bills) {
    if (b.status !== RecordStatus.posted) continue
    const owed = l.balance(b.id).outstanding_cents
    if (owed <= 0) continue
    const due = b.due_date && b.due_date > today ? b.due_date : today
    if (due > until) continue
    events.push({ date: due, kind: 'bill', title: l.vendor(b.vendor_id)?.name ?? 'Bill', project_id: b.project_id, amount_cents: owed, link: `/records/bill/${b.id}`,
      subtitle: !b.due_date ? 'Bill with no due date' : b.due_date < today ? `Overdue since ${Days.display(b.due_date)}` : `Bill due${b.invoice_number ? ` · #${b.invoice_number}` : ''}` })
  }
  for (const r of l.s.reimbursements) {
    if (!(r.status === RecordStatus.approved || (r.status === RecordStatus.requested && !l.s.workspace.require_review))) continue
    events.push({ date: today, kind: 'reimbursement', title: `Reimburse ${l.payerName(r.partner_user_id)}`, subtitle: 'Ready to pay', project_id: null, amount_cents: r.amount_cents, link: `/records/reimbursement/${r.id}` })
  }
  const byCommitment = new Map<string, typeof l.s.scheduled_draws>()
  for (const d of [...l.s.scheduled_draws].sort((a, b) => a.due_date.localeCompare(b.due_date))) {
    byCommitment.set(d.commitment_id, [...(byCommitment.get(d.commitment_id) ?? []), d])
  }
  for (const [cid, draws] of byCommitment) {
    const c = l.s.commitments.find((x) => x.id === cid)
    if (!c || isVoid(c)) continue
    let room = l.commitmentStatus(c).unbilled_cents
    for (const d of draws) {
      const amount = Math.min(d.amount_cents, room)
      room -= amount
      if (amount <= 0 || d.due_date < today || d.due_date > until) continue
      events.push({ date: d.due_date, kind: 'draw', title: l.vendor(c.vendor_id)?.name ?? 'Draw', project_id: c.project_id, amount_cents: amount, link: `/records/commitment/${c.id}`,
        subtitle: `Scheduled draw${d.description ? ` · ${d.description}` : ''}${amount < d.amount_cents ? ` (capped at the ${Money.format(amount)} not billed yet)` : ''}` })
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.amount_cents - a.amount_cents)
  const latest = [...l.s.cash_balances].sort((a, b) => b.as_of.localeCompare(a.as_of) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
  let bal: Cents | null = latest ? latest.amount_cents : null
  const daysOut: CashDay[] = []
  let shortfall: CashPlan['shortfall']
  for (const e of events) {
    let d = daysOut[daysOut.length - 1]
    if (!d || d.date !== e.date) { d = { date: e.date, out_cents: 0, balance_cents: bal, events: [] }; daysOut.push(d) }
    d.events.push(e)
    d.out_cents += e.amount_cents
    if (bal != null) { bal -= e.amount_cents; d.balance_cents = bal; if (bal < 0 && !shortfall) shortfall = { date: e.date, short_by_cents: -bal } }
  }
  const proj = new Map<string | null, Cents>()
  for (const e of events) proj.set(e.project_id, (proj.get(e.project_id) ?? 0) + e.amount_cents)
  return {
    cash_on_hand_cents: latest?.amount_cents ?? null, as_of: latest?.as_of ?? null, events, days: daysOut,
    total_cents: events.reduce((a, e) => a + e.amount_cents, 0),
    byProject: [...proj.entries()].map(([project_id, total_cents]) => ({ project_id, total_cents })).sort((a, b) => b.total_cents - a.total_cents),
    shortfall,
  }
}

// ---------------------------------------------------------------------------
// Profit forecast per flip
// ---------------------------------------------------------------------------

export interface Forecast {
  sale_cents: Cents
  selling_costs_cents: Cents
  /** Paid + unpaid billed + committed not billed (purchase and closing costs included when entered as costs). */
  projected_costs_cents: Cents
  /** Budget left to spend beyond what's projected, when the budget is higher. */
  budget_gap_cents: Cents
  months_left: number
  holding_cents: Cents
  interest_cents: Cents
  profit_cents: Cents
  /** Profit as a share of all costs (return on cost), in basis points. */
  margin_bps: number | null
  missing: string[]
}

/** Months from today until the target sale date (at least 0), plus any delay. Partial months count as fractions. */
export function monthsUntil(today: Day, target: Day | null | undefined, delayMonths = 0): number {
  const base = target ? Math.max(Days.daysBetween(today, target), 0) / 30.4375 : 0
  return Math.round((base + delayMonths) * 100) / 100
}

/**
 * Expected profit if the flip sells at `salePct` of the expected price (100 = as planned), `delayMonths` later than
 * the target sale date. Future holding costs and loan interest run from today to the sale; what was already paid
 * is in the projected costs. Uses the budget instead of the projected spend when the budget is higher, so unspent
 * budget isn't counted as profit.
 */
export function forecast(l: Ledger, p: Project, opts: { delayMonths?: number; salePct?: number } = {}): Forecast {
  const t = l.totals(p.id)
  const missing: string[] = []
  if (!p.expected_sale_cents) missing.push('expected sale price')
  if (!p.target_sale_date) missing.push('target sale date')
  const sale = Math.round((p.expected_sale_cents ?? 0) * (opts.salePct ?? 100) / 100)
  const selling = Math.round(sale * (p.selling_cost_bps ?? 0) / 10000)
  const gap = Math.max(t.budget_cents - t.projected_cents, 0)
  const months = monthsUntil(l.today, p.target_sale_date, opts.delayMonths ?? 0)
  const holding = Math.round((p.monthly_holding_cents ?? 0) * months)
  const interest = Math.round((p.loan_balance_cents ?? 0) * (p.loan_rate_bps ?? 0) / 10000 / 12 * months)
  const costs = t.projected_cents + gap + selling + holding + interest
  const profit = sale - costs
  return {
    sale_cents: sale, selling_costs_cents: selling, projected_costs_cents: t.projected_cents, budget_gap_cents: gap, months_left: months,
    holding_cents: holding, interest_cents: interest, profit_cents: profit, margin_bps: costs > 0 ? Math.round(profit / costs * 10000) : null, missing,
  }
}

// ---------------------------------------------------------------------------
// Inbox suggestions
// ---------------------------------------------------------------------------

/** Reads the note and file name ("homedepot 42.10 oak st.jpg") for a first guess at vendor, amount, date and project. */
export function suggestFromText(text: string, l: Ledger): Pick<InboxItem, 'suggested_vendor' | 'suggested_total_cents' | 'suggested_date' | 'suggested_project_id' | 'suggested_kind'> {
  const t = text.replace(/\.(jpe?g|png|heic|pdf|webp|gif)$/i, '').replace(/[_]+/g, ' ')
  const amounts = [...t.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2}|\$\s?\d+)/g)].map((m) => Money.parse(m[1])).filter((x): x is number => !!x)
  const nt = norm(t).replace(/\s+/g, '')
  const vendor = [...l.s.vendors].sort((a, b) => b.name.length - a.name.length).find((v) => { const n = norm(v.name).replace(/\s+/g, ''); return n.length >= 3 && nt.includes(n) })
  const project = l.s.projects.find((p) => { const n = norm(p.nickname); const first = n.split(' ')[0]; return nt.includes(n.replace(/\s+/g, '')) || (first.length >= 3 && norm(t).split(' ').includes(first)) })
  const date = t.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1]
  return {
    suggested_vendor: vendor?.name ?? null,
    suggested_total_cents: amounts.length ? Math.max(...amounts) : null,
    suggested_date: date ? parseDay(date) : null,
    suggested_project_id: project?.id ?? null,
    suggested_kind: /invoice|bill|inv\b|estimate|draw/i.test(t) ? 'bill' : /receipt/i.test(t) ? 'receipt' : null,
  }
}

export const entryKey = (ref: EntryRef) => refKey(ref)
