// CSV export, same columns and math as the iPhone app (LedgerCore/CSVExport.swift).
// One row per transaction, or per category share when a record is split. The effect columns
// add up to the totals the app shows.
import { Money, type Cents, type Day } from './money'
import type { Ledger } from './ledger'
import { paymentKindLabel, isPaidR, type EntryKind } from './models'

export interface CSVFilter { project_id?: string | null; partner_id?: string | null; vendor_id?: string | null; from?: Day | null; to?: Day | null }

interface Row {
  transaction_id: string
  type: string
  date: Day
  project_id?: string | null
  vendor_id?: string | null
  partner_id?: string | null
  category_id?: string | null
  description: string
  invoice: string
  status: string
  amount: Cents
  paid_cost: Cents
  unpaid_billed: Cents
  unbilled_committed: Cents
  out_of_pocket: Cents
  reimbursed: Cents
  contribution: Cents
  proceeds: Cents
  attachments: string
}

export const header = ['transaction_id', 'type', 'date', 'project', 'vendor', 'partner', 'category', 'description',
  'invoice_or_reference', 'status', 'amount', 'project_paid_cost', 'project_unpaid_billed',
  'project_unbilled_committed', 'partner_out_of_pocket', 'partner_reimbursed',
  'partner_contribution', 'sale_proceeds', 'attachment_filenames']

const zero = { paid_cost: 0, unpaid_billed: 0, unbilled_committed: 0, out_of_pocket: 0, reimbursed: 0, contribution: 0, proceeds: 0, attachments: '' }

export function rows(l: Ledger, f: CSVFilter = {}): Row[] {
  const out: Row[] = []
  const files = (k: EntryKind, id: string) => l.attachmentsFor({ kind: k, id }).map((a) => a.filename).join('; ')

  for (const e of l.s.expenses) {
    const live = e.status !== 'void'
    for (const [cid, amt] of l.sharesOfExpense(e)) {
      const r: Row = { ...zero, transaction_id: e.id, type: e.is_refund ? 'receipt_refund' : 'receipt', date: e.expense_date,
        project_id: e.project_id, vendor_id: e.vendor_id, partner_id: e.paid_by_user_id, category_id: cid,
        description: e.description, invoice: e.reference, status: e.status, amount: amt }
      if (live) {
        r.paid_cost = amt
        if (e.paid_by_user_id) r.out_of_pocket = amt
      }
      r.attachments = files('expense', e.id)
      out.push(r)
    }
  }
  for (const b of l.s.bills) {
    const live = b.status !== 'void'
    const outstanding = new Map<string | null, Cents>()
    for (const [cid, amt] of l.sharesOfOutstanding(b)) outstanding.set(cid, (outstanding.get(cid) ?? 0) + amt)
    const allocs = l.allocationsForBill(b.id)
    const lines: [string | null, Cents][] = allocs.length === 0 ? [[null, b.total_cents]] : allocs.map((a) => [a.category_id, a.amount_cents])
    for (const [cid, amt] of lines) {
      const r: Row = { ...zero, transaction_id: b.id, type: 'bill', date: b.bill_date, project_id: b.project_id, vendor_id: b.vendor_id,
        partner_id: null, category_id: cid, description: b.description, invoice: b.invoice_number, status: b.status, amount: amt }
      if (live) r.unpaid_billed = outstanding.get(cid) ?? 0
      r.attachments = files('bill', b.id)
      out.push(r)
    }
    for (const p of l.paymentsForBill(b.id)) {
      const shares: [string | null, Cents][] = p.kind === 'credit' ? [[allocs[0]?.category_id ?? null, 0]] : l.sharesOfPayment(p)
      shares.forEach(([cid, amt], i) => {
        const r: Row = { ...zero, transaction_id: p.id, type: `bill_${p.kind}`, date: p.payment_date, project_id: b.project_id,
          vendor_id: b.vendor_id, partner_id: p.paid_by_user_id, category_id: cid, description: paymentKindLabel(p.kind),
          invoice: [b.invoice_number, p.reference].filter(Boolean).join(' / '), status: p.status,
          amount: p.kind === 'credit' ? (i === 0 ? -p.amount_cents : 0) : amt }
        if (p.status !== 'void' && live) {
          r.paid_cost = amt
          if (p.paid_by_user_id) r.out_of_pocket = amt
        }
        r.attachments = files('payment', p.id)
        out.push(r)
      })
    }
  }
  for (const c of l.s.commitments) {
    const st = l.commitmentStatus(c)
    const r: Row = { ...zero, transaction_id: c.id, type: 'commitment', date: (c.created_at ?? l.today).slice(0, 10),
      project_id: c.project_id, vendor_id: c.vendor_id, partner_id: null, category_id: c.category_id,
      description: c.description, invoice: '', status: c.status, amount: st.revised_cents }
    if (c.status !== 'void') r.unbilled_committed = st.unbilled_cents
    r.attachments = files('commitment', c.id)
    out.push(r)
  }
  for (const re of l.s.reimbursements) {
    const r: Row = { ...zero, transaction_id: re.id, type: 'reimbursement', date: re.paid_date ?? re.request_date, project_id: null,
      vendor_id: null, partner_id: re.partner_user_id, category_id: null, description: re.notes, invoice: re.reference,
      status: re.status, amount: re.amount_cents }
    if (isPaidR(re)) r.reimbursed = re.amount_cents
    r.attachments = files('reimbursement', re.id)
    out.push(r)
  }
  for (const c of l.s.contributions) {
    const r: Row = { ...zero, transaction_id: c.id, type: 'contribution', date: c.contribution_date, project_id: c.project_id,
      vendor_id: null, partner_id: c.partner_user_id, category_id: null, description: c.notes, invoice: c.reference,
      status: c.status, amount: c.amount_cents }
    if (c.status !== 'void') r.contribution = c.amount_cents
    r.attachments = files('contribution', c.id)
    out.push(r)
  }
  for (const p of l.s.proceeds) {
    const r: Row = { ...zero, transaction_id: p.id, type: 'sale_proceeds', date: p.sale_date, project_id: p.project_id, vendor_id: null,
      partner_id: null, category_id: null, description: p.notes, invoice: '', status: p.status, amount: p.amount_cents }
    if (p.status !== 'void') r.proceeds = p.amount_cents
    out.push(r)
  }

  return out
    .filter((r) => {
      if (f.project_id && r.project_id !== f.project_id) return false
      if (f.partner_id && r.partner_id !== f.partner_id) return false
      if (f.vendor_id && r.vendor_id !== f.vendor_id) return false
      if (f.from && r.date < f.from) return false
      if (f.to && r.date > f.to) return false
      return true
    })
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
}

export function totals(rs: Row[]) {
  const sum = (k: keyof Row) => rs.reduce((a, r) => a + (r[k] as number), 0)
  return {
    paid_cost: sum('paid_cost'), unpaid_billed: sum('unpaid_billed'), unbilled_committed: sum('unbilled_committed'),
    out_of_pocket: sum('out_of_pocket'), reimbursed: sum('reimbursed'), contribution: sum('contribution'), proceeds: sum('proceeds'),
  }
}

export function csv(l: Ledger, f: CSVFilter = {}): string {
  const rs = rows(l, f)
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [header.join(',')]
  for (const r of rs) {
    lines.push([r.transaction_id.toUpperCase(), r.type, r.date, l.project(r.project_id)?.nickname ?? '', l.vendor(r.vendor_id)?.name ?? '',
      r.partner_id ? l.payerName(r.partner_id) : '', l.category(r.category_id)?.name ?? '', r.description, r.invoice, r.status,
      Money.plain(r.amount), Money.plain(r.paid_cost), Money.plain(r.unpaid_billed), Money.plain(r.unbilled_committed),
      Money.plain(r.out_of_pocket), Money.plain(r.reimbursed), Money.plain(r.contribution), Money.plain(r.proceeds), r.attachments].map(esc).join(','))
  }
  const t = totals(rs)
  lines.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', Money.plain(t.paid_cost), Money.plain(t.unpaid_billed),
    Money.plain(t.unbilled_committed), Money.plain(t.out_of_pocket), Money.plain(t.reimbursed), Money.plain(t.contribution),
    Money.plain(t.proceeds), ''].join(','))
  return lines.join('\n') + '\n'
}

export function filename(l: Ledger, f: CSVFilter): string {
  const parts = ['project-ledger']
  const p = l.project(f.project_id)
  if (p) parts.push(p.nickname)
  if (f.partner_id) parts.push(l.payerName(f.partner_id))
  const v = l.vendor(f.vendor_id)
  if (v) parts.push(v.name)
  if (f.from) parts.push(`from-${f.from}`)
  if (f.to) parts.push(`to-${f.to}`)
  return parts.join('-').toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '-') + '.csv'
}
