// All balances are computed here from actual transactions, the same way in live and demo mode,
// and the same way as the iPhone app (ios/LedgerCore/Sources/LedgerCore/Ledger.swift).
// Voided records never count.
import { Money, Days, type Cents, type Day } from './money'
import {
  type Snapshot, type Allocation, type BillPayment, type Project, type Vendor, type BudgetCategory, type Member,
  type Bill, type Expense, type Commitment, type Attachment, type Entry, type EntryRef, type StatusLabel, type EntryKind,
  RecordStatus, signedCents, paidEffect, outstandingEffect, paymentKindLabel, isActiveProject, isPaidR, isPendingR, refKey,
} from './models'

export interface BillBalance { total_cents: Cents; credits_cents: Cents; paid_cents: Cents; outstanding_cents: Cents; billed_cents: Cents }

export interface CategoryLine {
  category_id: string
  name: string
  budget_cents: Cents
  paid_cents: Cents
  unpaid_billed_cents: Cents
  unbilled_committed_cents: Cents
  projected_cents: Cents
  remaining_cents: Cents
  sources: EntryRef[]
}

export interface ProjectTotals {
  budget_cents: Cents
  paid_cents: Cents
  unpaid_billed_cents: Cents
  unbilled_committed_cents: Cents
  proceeds_cents: Cents
  projected_cents: Cents
  remaining_cents: Cents
  profit_estimate_cents: Cents
}

export interface CommitmentStatus {
  original_cents: Cents
  approved_change_orders_cents: Cents
  pending_change_orders_cents: Cents
  billed_cents: Cents
  revised_cents: Cents
  unbilled_cents: Cents
}

export interface PartnerBalance {
  member: Member
  out_of_pocket_cents: Cents
  contributions_cents: Cents
  /** Paid out to the partner from sales (return of capital and profit). */
  distributions_cents: Cents
  reimbursed_cents: Cents
  pending_reimbursement_cents: Cents
  /** What the LLC still owes this partner. */
  owed_cents: Cents
}

export interface ActivityFilter {
  text: string
  kinds: EntryKind[]
  project_id?: string | null
  vendor_id?: string | null
  partner_id?: string | null
  category_id?: string | null
  status_text?: string | null
  from?: Day | null
  to?: Day | null
}
export const emptyFilter = (): ActivityFilter => ({ text: '', kinds: [] })

const UNCATEGORIZED = '00000000-0000-0000-0000-000000000000'
const VOID: StatusLabel = { text: 'Void', tone: 'neutral' }

function group<T>(items: T[], key: (t: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const i of items) {
    const k = key(i)
    if (k == null) continue
    const arr = m.get(k)
    if (arr) arr.push(i)
    else m.set(k, [i])
  }
  return m
}
const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))
const isVoid = (r: { status: string }) => r.status === RecordStatus.void

export class Ledger {
  readonly s: Snapshot
  readonly today: Day
  private allocationsByBill: Map<string, Allocation[]>
  private allocationsByExpense: Map<string, Allocation[]>
  private paymentsByBill: Map<string, BillPayment[]>
  private projectsById: Map<string, Project>
  private vendorsById: Map<string, Vendor>
  private categoriesById: Map<string, BudgetCategory>
  private membersById: Map<string, Member>
  private billsById: Map<string, Bill>
  private _entries?: Entry[]

  constructor(snapshot: Snapshot, today: Day = Days.today) {
    this.s = snapshot
    this.today = today
    this.allocationsByBill = group(snapshot.allocations, (a) => a.bill_id)
    this.allocationsByExpense = group(snapshot.allocations, (a) => a.expense_id)
    this.paymentsByBill = group(snapshot.payments, (p) => p.bill_id)
    this.projectsById = byId(snapshot.projects)
    this.vendorsById = byId(snapshot.vendors)
    this.categoriesById = byId(snapshot.categories)
    this.membersById = new Map(snapshot.members.map((m) => [m.user_id, m]))
    this.billsById = byId(snapshot.bills)
  }

  // Lookups
  project(id?: string | null) { return id ? this.projectsById.get(id) : undefined }
  vendor(id?: string | null) { return id ? this.vendorsById.get(id) : undefined }
  category(id?: string | null) { return id ? this.categoriesById.get(id) : undefined }
  member(id?: string | null) { return id ? this.membersById.get(id) : undefined }
  bill(id?: string | null) { return id ? this.billsById.get(id) : undefined }
  payerName(id?: string | null) { return id == null ? 'LLC account' : (this.member(id)?.display_name ?? 'Former partner') }
  allocationsForBill(id: string) { return this.allocationsByBill.get(id) ?? [] }
  allocationsForExpense(id: string) { return this.allocationsByExpense.get(id) ?? [] }
  paymentsForBill(id: string) { return [...(this.paymentsByBill.get(id) ?? [])].sort((a, b) => a.payment_date.localeCompare(b.payment_date)) }
  get activeCategories() { return this.s.categories.filter((c) => !c.archived).sort((a, b) => a.sort_order - b.sort_order) }

  attachmentsFor(ref: EntryRef): Attachment[] {
    return this.s.attachments.filter((a) => {
      switch (ref.kind) {
        case 'expense': return a.expense_id === ref.id
        case 'bill': return a.bill_id === ref.id
        case 'payment': return a.bill_payment_id === ref.id
        case 'reimbursement': return a.reimbursement_id === ref.id
        case 'contribution': return a.contribution_id === ref.id
        case 'commitment': case 'changeOrder': return a.commitment_id === ref.id
        case 'proceeds': case 'distribution': return false
      }
    })
  }

  record(ref: EntryRef): { status: string; created_by?: string | null } | undefined {
    const s = this.s
    const find = <T extends { id: string }>(xs: T[]) => xs.find((x) => x.id === ref.id)
    switch (ref.kind) {
      case 'expense': return find(s.expenses)
      case 'bill': return find(s.bills)
      case 'payment': return find(s.payments)
      case 'reimbursement': return find(s.reimbursements)
      case 'contribution': return find(s.contributions)
      case 'proceeds': return find(s.proceeds)
      case 'distribution': return find(s.distributions)
      case 'commitment': return find(s.commitments)
      case 'changeOrder': return find(s.change_orders)
    }
  }

  // Bills
  balance(billId: string): BillBalance {
    const total = this.bill(billId)?.total_cents ?? 0
    const posted = (this.paymentsByBill.get(billId) ?? []).filter((p) => !isVoid(p))
    const credits = posted.filter((p) => p.kind === 'credit').reduce((a, p) => a + p.amount_cents, 0)
    const paid = posted.reduce((a, p) => a + paidEffect(p), 0)
    const outstanding = total + posted.reduce((a, p) => a + outstandingEffect(p), 0)
    return { total_cents: total, credits_cents: credits, paid_cents: paid, outstanding_cents: outstanding, billed_cents: total - credits }
  }

  billStatus(b: Bill): StatusLabel {
    if (isVoid(b)) return VOID
    if (b.status === RecordStatus.pendingReview) return { text: 'Needs approval', tone: 'warning' }
    const bal = this.balance(b.id)
    if (bal.outstanding_cents <= 0) return { text: 'Paid', tone: 'good' }
    if (b.due_date && b.due_date < this.today) return { text: 'Overdue', tone: 'bad' }
    if (bal.paid_cents > 0 || bal.credits_cents > 0) return { text: 'Partly paid', tone: 'warning' }
    return { text: 'Unpaid', tone: 'warning' }
  }

  /** Splits an amount over a bill's categories in proportion to its allocations. */
  private spread(amount: Cents, billId: string): [string | null, Cents][] {
    const allocs = this.allocationsForBill(billId)
    if (allocs.length === 0) return [[null, amount]]
    const shares = Money.distribute(amount, allocs.map((a) => a.amount_cents))
    return allocs.map((a, i) => [a.category_id, shares[i]])
  }
  sharesOfPayment(p: BillPayment) { return this.spread(paidEffect(p), p.bill_id) }
  sharesOfOutstanding(b: Bill) { return this.spread(this.balance(b.id).outstanding_cents, b.id) }
  sharesOfExpense(e: Expense): [string | null, Cents][] {
    const allocs = this.allocationsForExpense(e.id)
    if (allocs.length === 0) return [[null, signedCents(e)]]
    return allocs.map((a) => [a.category_id, e.is_refund ? -a.amount_cents : a.amount_cents])
  }

  // Commitments
  commitmentStatus(c: Commitment): CommitmentStatus {
    const cos = this.s.change_orders.filter((co) => co.commitment_id === c.id && !isVoid(co))
    const approved = cos.filter((co) => co.status === RecordStatus.posted).reduce((a, co) => a + co.amount_cents, 0)
    const pending = cos.filter((co) => co.status === RecordStatus.pendingReview).reduce((a, co) => a + co.amount_cents, 0)
    const billed = this.s.bills.filter((b) => b.commitment_id === c.id && !isVoid(b)).reduce((a, b) => a + this.balance(b.id).billed_cents, 0)
    const revised = c.amount_cents + approved
    return {
      original_cents: c.amount_cents, approved_change_orders_cents: approved, pending_change_orders_cents: pending,
      billed_cents: billed, revised_cents: revised, unbilled_cents: Math.max(revised - billed, 0),
    }
  }

  // Projects
  categorySummary(pid: string): CategoryLine[] {
    const lines = new Map<string, CategoryLine>()
    const line = (cid: string | null): CategoryLine => {
      const id = cid ?? UNCATEGORIZED
      let l = lines.get(id)
      if (!l) {
        l = { category_id: id, name: this.category(id)?.name ?? 'Uncategorized', budget_cents: 0, paid_cents: 0,
          unpaid_billed_cents: 0, unbilled_committed_cents: 0, projected_cents: 0, remaining_cents: 0, sources: [] }
        lines.set(id, l)
      }
      return l
    }
    const add = (cid: string | null, ref: EntryRef, update: (l: CategoryLine) => void) => {
      const l = line(cid)
      update(l)
      if (!l.sources.some((r) => r.kind === ref.kind && r.id === ref.id)) l.sources.push(ref)
    }
    for (const b of this.s.budgets) if (b.project_id === pid) line(b.category_id).budget_cents += b.amount_cents
    for (const e of this.s.expenses) {
      if (e.project_id !== pid || isVoid(e)) continue
      for (const [cid, amt] of this.sharesOfExpense(e)) add(cid, { kind: 'expense', id: e.id }, (l) => { l.paid_cents += amt })
    }
    for (const b of this.s.bills) {
      if (b.project_id !== pid || isVoid(b)) continue
      for (const p of this.paymentsForBill(b.id)) {
        if (isVoid(p) || paidEffect(p) === 0) continue
        for (const [cid, amt] of this.sharesOfPayment(p)) add(cid, { kind: 'payment', id: p.id }, (l) => { l.paid_cents += amt })
      }
      for (const [cid, amt] of this.sharesOfOutstanding(b)) {
        if (amt !== 0) add(cid, { kind: 'bill', id: b.id }, (l) => { l.unpaid_billed_cents += amt })
      }
    }
    for (const c of this.s.commitments) {
      if (c.project_id !== pid || isVoid(c)) continue
      const unbilled = this.commitmentStatus(c).unbilled_cents
      if (unbilled > 0) add(c.category_id, { kind: 'commitment', id: c.id }, (l) => { l.unbilled_committed_cents += unbilled })
    }
    const order = new Map(this.s.categories.map((c) => [c.id, c.sort_order]))
    return [...lines.values()]
      .map((l) => {
        const projected = l.paid_cents + l.unpaid_billed_cents + l.unbilled_committed_cents
        return { ...l, projected_cents: projected, remaining_cents: l.budget_cents - projected }
      })
      .sort((a, b) => (order.get(a.category_id) ?? 999) - (order.get(b.category_id) ?? 999))
  }

  totals(pid: string): ProjectTotals {
    let budget = 0, paid = 0, unpaid = 0, unbilled = 0
    for (const l of this.categorySummary(pid)) {
      budget += l.budget_cents; paid += l.paid_cents; unpaid += l.unpaid_billed_cents; unbilled += l.unbilled_committed_cents
    }
    const proceeds = this.s.proceeds.filter((p) => p.project_id === pid && !isVoid(p)).reduce((a, p) => a + p.amount_cents, 0)
    const projected = paid + unpaid + unbilled
    return {
      budget_cents: budget, paid_cents: paid, unpaid_billed_cents: unpaid, unbilled_committed_cents: unbilled,
      proceeds_cents: proceeds, projected_cents: projected, remaining_cents: budget - projected,
      profit_estimate_cents: proceeds - projected,
    }
  }

  vendorsForProject(pid: string): Vendor[] {
    const ids = new Set<string>()
    this.s.expenses.filter((e) => e.project_id === pid).forEach((e) => ids.add(e.vendor_id))
    this.s.bills.filter((b) => b.project_id === pid).forEach((b) => ids.add(b.vendor_id))
    this.s.commitments.filter((c) => c.project_id === pid).forEach((c) => ids.add(c.vendor_id))
    return this.s.vendors.filter((v) => ids.has(v.id)).sort((a, b) => a.name.localeCompare(b.name))
  }

  // Partners
  partnerBalances(pid?: string | null): PartnerBalance[] {
    return [...this.s.members].sort((a, b) => a.display_name.localeCompare(b.display_name)).map((m) => this.partnerBalance(m.user_id, pid))
  }

  /** With a project, only out-of-pocket and contributions are project-specific; reimbursements are paid to the partner overall. */
  partnerBalance(uid: string, pid?: string | null): PartnerBalance {
    const member = this.member(uid) ?? { workspace_id: this.s.workspace.id, user_id: uid, role: 'partner', display_name: 'Former partner' }
    let oop = 0, contrib = 0, reimbursed = 0, pending = 0, distributed = 0
    for (const e of this.s.expenses) if (e.paid_by_user_id === uid && !isVoid(e) && (!pid || e.project_id === pid)) oop += signedCents(e)
    for (const p of this.s.payments) {
      if (p.paid_by_user_id !== uid || isVoid(p)) continue
      if (pid && this.bill(p.bill_id)?.project_id !== pid) continue
      oop += paidEffect(p)
    }
    for (const c of this.s.contributions) if (c.partner_user_id === uid && !isVoid(c) && (!pid || c.project_id === pid)) contrib += c.amount_cents
    for (const d of this.s.distributions) if (d.partner_user_id === uid && !isVoid(d) && (!pid || d.project_id === pid)) distributed += d.amount_cents
    if (!pid) {
      for (const r of this.s.reimbursements) {
        if (r.partner_user_id !== uid) continue
        if (isPaidR(r)) reimbursed += r.amount_cents
        if (isPendingR(r)) pending += r.amount_cents
      }
    }
    return {
      member, out_of_pocket_cents: oop, contributions_cents: contrib, distributions_cents: distributed, reimbursed_cents: reimbursed,
      pending_reimbursement_cents: pending, owed_cents: oop - reimbursed,
    }
  }

  partnerEntries(uid: string) { return this.entries().filter((e) => e.partner_id === uid) }

  // Activity
  entries(): Entry[] {
    if (this._entries) return this._entries
    const out: Entry[] = []
    const counts = this.attachmentCounts()
    const count = (k: EntryKind, id: string) => counts.get(`${k}:${id}`) ?? 0
    const join = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).join(' · ')
    const recorded = (r: { status: string }): StatusLabel => (isVoid(r) ? VOID : { text: 'Recorded', tone: 'good' })

    for (const e of this.s.expenses) {
      out.push({
        ref: { kind: 'expense', id: e.id }, date: e.expense_date, title: this.vendor(e.vendor_id)?.name ?? 'Receipt',
        subtitle: join([e.is_refund ? 'Refund' : 'Receipt', this.project(e.project_id)?.nickname, this.payerName(e.paid_by_user_id)]),
        amount_cents: signedCents(e), project_id: e.project_id, vendor_id: e.vendor_id, partner_id: e.paid_by_user_id ?? null,
        invoice_number: e.reference, category_ids: this.allocationsForExpense(e.id).map((a) => a.category_id),
        status: isVoid(e) ? VOID : { text: 'Paid', tone: 'good' }, created_by: e.created_by, attachment_count: count('expense', e.id), notes: e.description,
      })
    }
    for (const b of this.s.bills) {
      out.push({
        ref: { kind: 'bill', id: b.id }, date: b.bill_date, title: this.vendor(b.vendor_id)?.name ?? 'Bill',
        subtitle: join(['Bill' + (b.invoice_number ? ` #${b.invoice_number}` : ''), this.project(b.project_id)?.nickname,
          b.due_date ? `due ${Days.display(b.due_date)}` : null]),
        amount_cents: b.total_cents, project_id: b.project_id, vendor_id: b.vendor_id, partner_id: null,
        invoice_number: b.invoice_number, category_ids: this.allocationsForBill(b.id).map((a) => a.category_id),
        status: this.billStatus(b), created_by: b.created_by, attachment_count: count('bill', b.id), due_date: b.due_date, notes: b.description,
      })
    }
    for (const p of this.s.payments) {
      const b = this.bill(p.bill_id)
      out.push({
        ref: { kind: 'payment', id: p.id }, date: p.payment_date, title: this.vendor(b?.vendor_id)?.name ?? 'Payment',
        subtitle: join([paymentKindLabel(p.kind), b ? (b.invoice_number ? `bill #${b.invoice_number}` : 'bill') : null,
          p.kind === 'credit' ? null : this.payerName(p.paid_by_user_id)]),
        amount_cents: p.kind === 'payment' ? p.amount_cents : -p.amount_cents, project_id: b?.project_id, vendor_id: b?.vendor_id,
        partner_id: p.kind === 'credit' ? null : (p.paid_by_user_id ?? null), invoice_number: b?.invoice_number ?? '',
        category_ids: b ? this.allocationsForBill(b.id).map((a) => a.category_id) : [],
        status: recorded(p), created_by: p.created_by, attachment_count: count('payment', p.id),
      })
    }
    for (const r of this.s.reimbursements) {
      const st: StatusLabel = r.status === 'paid' ? { text: 'Paid', tone: 'good' }
        : r.status === 'approved' ? { text: 'Approved, not paid', tone: 'warning' }
          : r.status === 'requested' ? { text: 'Requested', tone: 'warning' } : VOID
      out.push({
        ref: { kind: 'reimbursement', id: r.id }, date: r.paid_date ?? r.request_date, title: `Reimburse ${this.payerName(r.partner_user_id)}`,
        subtitle: 'Reimbursement · not a project cost', amount_cents: r.amount_cents, project_id: null, vendor_id: null,
        partner_id: r.partner_user_id, invoice_number: r.reference, category_ids: [], status: st, created_by: r.created_by,
        attachment_count: count('reimbursement', r.id), notes: r.notes,
      })
    }
    for (const c of this.s.contributions) {
      out.push({
        ref: { kind: 'contribution', id: c.id }, date: c.contribution_date, title: `${this.payerName(c.partner_user_id)} contribution`,
        subtitle: join(['Capital contribution', this.project(c.project_id)?.nickname]), amount_cents: c.amount_cents,
        project_id: c.project_id, vendor_id: null, partner_id: c.partner_user_id, invoice_number: c.reference, category_ids: [],
        status: recorded(c), created_by: c.created_by, attachment_count: count('contribution', c.id), notes: c.notes,
      })
    }
    for (const p of this.s.proceeds) {
      out.push({
        ref: { kind: 'proceeds', id: p.id }, date: p.sale_date, title: `Sale of ${this.project(p.project_id)?.nickname ?? 'property'}`,
        subtitle: 'Sale proceeds', amount_cents: p.amount_cents, project_id: p.project_id, vendor_id: null, partner_id: null,
        invoice_number: '', category_ids: [], status: recorded(p), created_by: p.created_by, attachment_count: 0, notes: p.notes,
      })
    }
    for (const d of this.s.distributions) {
      out.push({
        ref: { kind: 'distribution', id: d.id }, date: d.distribution_date, title: `Distribution to ${this.payerName(d.partner_user_id)}`,
        subtitle: join(['Paid out to a partner', this.project(d.project_id)?.nickname]), amount_cents: d.amount_cents,
        project_id: d.project_id, vendor_id: null, partner_id: d.partner_user_id, invoice_number: d.reference, category_ids: [],
        status: recorded(d), created_by: d.created_by, attachment_count: 0, notes: d.notes,
      })
    }
    for (const c of this.s.commitments) {
      const st = this.commitmentStatus(c)
      out.push({
        ref: { kind: 'commitment', id: c.id }, date: (c.created_at ?? this.today).slice(0, 10), title: this.vendor(c.vendor_id)?.name ?? 'Commitment',
        subtitle: join(['Commitment', this.project(c.project_id)?.nickname, `${Money.format(st.unbilled_cents, false)} not billed yet`]),
        amount_cents: st.revised_cents, project_id: c.project_id, vendor_id: c.vendor_id, partner_id: null, invoice_number: '',
        category_ids: [c.category_id], status: isVoid(c) ? VOID : { text: 'Committed', tone: 'neutral' }, created_by: c.created_by,
        attachment_count: count('commitment', c.id), notes: c.description,
      })
    }
    const commitments = byId(this.s.commitments)
    for (const co of this.s.change_orders) {
      const c = commitments.get(co.commitment_id)
      if (!c) continue
      const st: StatusLabel = isVoid(co) ? VOID : co.status === RecordStatus.pendingReview ? { text: 'Needs approval', tone: 'warning' } : { text: 'Approved', tone: 'good' }
      out.push({
        ref: { kind: 'changeOrder', id: co.id }, date: (co.created_at ?? this.today).slice(0, 10), title: this.vendor(c.vendor_id)?.name ?? 'Change order',
        subtitle: ['Change order', co.description].filter(Boolean).join(' · '), amount_cents: co.amount_cents, project_id: c.project_id,
        vendor_id: c.vendor_id, partner_id: null, invoice_number: '', category_ids: [c.category_id], status: st, created_by: co.created_by,
        attachment_count: 0,
      })
    }
    out.sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : a.title.localeCompare(b.title)))
    this._entries = out
    return out
  }

  private attachmentCounts(): Map<string, number> {
    const d = new Map<string, number>()
    const inc = (k: string) => d.set(k, (d.get(k) ?? 0) + 1)
    for (const a of this.s.attachments) {
      if (a.expense_id) inc(`expense:${a.expense_id}`)
      if (a.bill_id) inc(`bill:${a.bill_id}`)
      if (a.bill_payment_id) inc(`payment:${a.bill_payment_id}`)
      if (a.reimbursement_id) inc(`reimbursement:${a.reimbursement_id}`)
      if (a.contribution_id) inc(`contribution:${a.contribution_id}`)
      if (a.commitment_id) inc(`commitment:${a.commitment_id}`)
    }
    return d
  }

  search(f: ActivityFilter): Entry[] {
    const q = f.text.trim().toLowerCase()
    return this.entries().filter((e) => {
      if (f.kinds.length && !f.kinds.includes(e.ref.kind)) return false
      if (f.project_id && e.project_id !== f.project_id) return false
      if (f.vendor_id && e.vendor_id !== f.vendor_id) return false
      if (f.partner_id && e.partner_id !== f.partner_id) return false
      if (f.category_id && !e.category_ids.includes(f.category_id)) return false
      if (f.status_text && e.status.text !== f.status_text) return false
      if (f.from && e.date < f.from) return false
      if (f.to && e.date > f.to) return false
      if (!q) return true
      const hay = [e.title, e.subtitle, e.invoice_number, Money.plain(e.amount_cents), Money.format(e.amount_cents),
        this.project(e.project_id)?.nickname ?? '', this.vendor(e.vendor_id)?.name ?? '', this.payerName(e.partner_id),
        e.status.text, e.date, e.notes ?? '', ...e.category_ids.map((c) => this.category(c)?.name ?? '')]
      return hay.join(' ').toLowerCase().includes(q)
    })
  }

  entry(ref: EntryRef) { return this.entries().find((e) => e.ref.kind === ref.kind && e.ref.id === ref.id) }

  /** Likely duplicates: same vendor and invoice number, or same vendor and amount within 3 days. */
  possibleDuplicates(vendorId: string | null | undefined, date: Day, amount: Cents, invoice: string, excluding?: string): Entry[] {
    if (!vendorId) return []
    const inv = invoice.trim().toLowerCase()
    return this.entries().filter((e) => {
      if (!(e.ref.kind === 'expense' || e.ref.kind === 'bill') || e.vendor_id !== vendorId || e.ref.id === excluding || e.status.text === 'Void') return false
      if (inv && e.invoice_number.toLowerCase() === inv) return true
      return Math.abs(e.amount_cents) === amount && Math.abs(Days.daysBetween(e.date, date)) <= 3
    })
  }

  vendorSummary(vid: string) {
    const bills = this.s.bills.filter((b) => b.vendor_id === vid && !isVoid(b))
    const billed = bills.reduce((a, b) => a + this.balance(b.id).billed_cents, 0)
    const paidBills = bills.reduce((a, b) => a + this.balance(b.id).paid_cents, 0)
    const receipts = this.s.expenses.filter((e) => e.vendor_id === vid && !isVoid(e)).reduce((a, e) => a + signedCents(e), 0)
    const outstanding = bills.filter((b) => b.status === 'posted' || b.status === 'pending_review').reduce((a, b) => a + this.balance(b.id).outstanding_cents, 0)
    const es = this.entries().filter((e) => e.vendor_id === vid)
    const projectIds = new Set(es.map((e) => e.project_id).filter(Boolean))
    const refKeys = new Set(es.map((e) => refKey(e.ref)))
    const files = this.s.attachments.filter((a) => a.vendor_id === vid || es.some((e) => refKeys.has(refKey(e.ref)) && this.attachmentsFor(e.ref).some((x) => x.id === a.id)))
    return { billed_cents: billed, paid_cents: paidBills + receipts, outstanding_cents: outstanding,
      projects: this.s.projects.filter((p) => projectIds.has(p.id)), entries: es, attachments: files }
  }

  home(dueWithinDays = 14) {
    const active = this.s.projects.filter(isActiveProject).map((p) => p.id)
    let paid = 0
    const sources: EntryRef[] = []
    for (const pid of active) {
      for (const l of this.categorySummary(pid)) {
        paid += l.paid_cents
        sources.push(...l.sources.filter((r) => r.kind === 'expense' || r.kind === 'payment'))
      }
    }
    const all = this.entries()
    const unpaid = all.filter((e) => e.ref.kind === 'bill' && e.status.text !== 'Void' && this.balance(e.ref.id).outstanding_cents > 0)
    const unpaidTotal = unpaid.reduce((a, e) => a + this.balance(e.ref.id).outstanding_cents, 0)
    const byDue = (a: Entry, b: Entry) => (a.due_date ?? '').localeCompare(b.due_date ?? '')
    const overdue = unpaid.filter((e) => e.status.text === 'Overdue').sort(byDue)
    const soon = Days.adding(dueWithinDays, this.today)
    const dueSoon = unpaid.filter((e) => e.due_date && e.due_date >= this.today && e.due_date <= soon).sort(byDue)
    const review = all.filter((e) => ['Needs approval', 'Requested', 'Approved, not paid'].includes(e.status.text))
    const balances = this.partnerBalances()
    return {
      paid_active_cents: paid, paid_active_sources: dedupe(sources), unpaid_bills_cents: unpaidTotal, unpaid_bills: unpaid,
      owed_to_partners_cents: balances.reduce((a, b) => a + Math.max(b.owed_cents, 0), 0), partner_balances: balances,
      overdue, due_soon: dueSoon, needs_review: review,
    }
  }

  /** Commitments with money not billed yet. */
  openCommitments(pid?: string | null): [Commitment, CommitmentStatus][] {
    return this.s.commitments.filter((c) => !isVoid(c) && (!pid || c.project_id === pid))
      .map((c) => [c, this.commitmentStatus(c)] as [Commitment, CommitmentStatus])
      .filter(([, st]) => st.unbilled_cents > 0)
  }

  /** Personal-money items for a partner that aren't fully covered by reimbursement items yet. */
  reimbursableItems(uid: string): { ref: EntryRef; entry: Entry; remaining_cents: Cents }[] {
    const covered = new Map<string, Cents>()
    const live = new Set(this.s.reimbursements.filter((r) => isPaidR(r) || isPendingR(r)).map((r) => r.id))
    for (const i of this.s.reimbursement_items) {
      if (!live.has(i.reimbursement_id)) continue
      if (i.expense_id) covered.set(`expense:${i.expense_id}`, (covered.get(`expense:${i.expense_id}`) ?? 0) + i.amount_cents)
      if (i.bill_payment_id) covered.set(`payment:${i.bill_payment_id}`, (covered.get(`payment:${i.bill_payment_id}`) ?? 0) + i.amount_cents)
    }
    const out: { ref: EntryRef; entry: Entry; remaining_cents: Cents }[] = []
    for (const e of this.entries()) {
      if (e.partner_id !== uid || e.status.text === 'Void' || !(e.ref.kind === 'expense' || e.ref.kind === 'payment') || e.amount_cents <= 0) continue
      const left = e.amount_cents - (covered.get(refKey(e.ref)) ?? 0)
      if (left > 0) out.push({ ref: e.ref, entry: e, remaining_cents: left })
    }
    return out
  }
}

export function dedupe(refs: EntryRef[]): EntryRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const k = refKey(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
