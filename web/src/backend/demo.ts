// DEMO MODE: a sample LLC kept in this browser only. Nothing is uploaded or shared.
// Applies the same rules as the database so balances behave exactly like live mode.
import { Ledger } from '../core/ledger'
import { Rules, LedgerError } from '../core/rules'
import { demoSnapshot, DemoIds } from '../core/demoData'
import { Days } from '../core/money'
import { emptySnapshot, type Snapshot, type EntryRef, type Attachment, type InboxItem, type StatementLine, type StatementMatch, type Claim, type ScheduledDraw, type CashBalance, type Material, type EntryTemplate } from '../core/models'
import type { Backend, NewRecord, StatusChange, AllocationInput } from './types'
import { uuid } from '../core/money'

const KEY = 'ledger.demo.snapshot'
const ACTOR_KEY = 'ledger.demo.actingAs'

function load(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      // Sample data saved by an older version may lack newer lists.
      const s = { ...emptySnapshot(demoSnapshot().workspace), ...JSON.parse(raw) } as Snapshot
      return s
    }
  } catch { /* fall through to fresh sample data */ }
  return demoSnapshot()
}

export class DemoBackend implements Backend {
  readonly isDemo = true
  snapshot: Snapshot = load()
  actingAs: string = (() => { try { return localStorage.getItem(ACTOR_KEY) || DemoIds.partnerA } catch { return DemoIds.partnerA } })()
  private listeners = new Set<() => void>()
  private files = new Map<string, string>() // storage path -> object URL
  private auditId = 1000

  userId() { return this.actingAs }
  userEmail() { return this.snapshot.members.find((m) => m.user_id === this.actingAs)?.email ?? null }

  private get ledger() { return new Ledger(this.snapshot) }
  private now() { return new Date().toISOString() }
  private changed() {
    try { localStorage.setItem(KEY, JSON.stringify(this.snapshot)) } catch { /* storage full or blocked: keep in memory */ }
    this.listeners.forEach((f) => f())
  }
  private audit(table: string, id: string, action: string, reason?: string) {
    this.snapshot.audit.push({ id: ++this.auditId + Date.now(), workspace_id: this.snapshot.workspace.id, table_name: table, record_id: id,
      action, actor: this.actingAs, at: this.now(), reason: reason ?? null })
  }
  private checkPartner(uid?: string | null) {
    if (uid && !this.snapshot.members.some((m) => m.user_id === uid)) throw new LedgerError("That person isn't a partner.")
  }
  private get isOwner() { return this.snapshot.members.find((m) => m.user_id === this.actingAs)?.role === 'owner' }

  actAs(uid: string) {
    this.actingAs = uid
    try { localStorage.setItem(ACTOR_KEY, uid) } catch { /* ignore */ }
    this.listeners.forEach((f) => f())
  }
  reset() {
    this.snapshot = demoSnapshot()
    this.changed()
  }

  async restoreSession() { return true }
  async signIn() {}
  async signUp() {}
  async signOut() {}
  async myWorkspaces() { return [this.snapshot.workspace] }
  async acceptInvites() { return 0 }
  async createWorkspace() { return this.snapshot.workspace.id }
  async load() { return structuredClone(this.snapshot) }

  async postExpense(expense: Parameters<Backend['postExpense']>[0], allocations: AllocationInput[]) {
    if (this.snapshot.expenses.some((e) => e.id === expense.id)) return
    Rules.checkExpense(expense, allocations)
    this.checkPartner(expense.paid_by_user_id)
    const e = { ...expense, status: 'posted', created_by: this.actingAs, created_at: this.now() }
    this.snapshot.expenses.push(e)
    this.snapshot.allocations.push(...allocations.map((a) => ({ ...a, id: uuid(), workspace_id: e.workspace_id, expense_id: e.id, bill_id: null })))
    this.audit('expenses', e.id, 'insert')
    this.changed()
  }

  async postBill(bill: Parameters<Backend['postBill']>[0], allocations: AllocationInput[]) {
    if (this.snapshot.bills.some((b) => b.id === bill.id)) return
    Rules.checkBill(bill, allocations, this.ledger)
    const b = { ...bill, status: this.snapshot.workspace.require_review ? 'pending_review' : 'posted', created_by: this.actingAs, created_at: this.now() }
    this.snapshot.bills.push(b)
    this.snapshot.allocations.push(...allocations.map((a) => ({ ...a, id: uuid(), workspace_id: b.workspace_id, bill_id: b.id, expense_id: null })))
    this.audit('bills', b.id, 'insert')
    this.changed()
  }

  async insert(rec: NewRecord) {
    const s = this.snapshot
    const review = s.workspace.require_review
    const stamp = { created_by: this.actingAs, created_at: this.now() }
    switch (rec.type) {
      case 'payment': {
        if (s.payments.some((p) => p.id === rec.row.id)) return
        Rules.checkPayment(rec.row, this.ledger)
        this.checkPartner(rec.row.paid_by_user_id)
        s.payments.push({ ...rec.row, status: 'posted', ...stamp })
        this.audit('bill_payments', rec.row.id, 'insert')
        break
      }
      case 'reimbursement': {
        if (s.reimbursements.some((r) => r.id === rec.row.id)) return
        const r = { ...rec.row, ...stamp }
        if (review) { r.status = 'requested'; r.paid_date = null }
        if (r.status === 'paid') {
          r.paid_date = r.paid_date ?? Days.today
          Rules.checkReimbursementPaid(r, this.ledger)
        }
        s.reimbursements.push(r)
        s.reimbursement_items.push(...rec.items)
        this.audit('reimbursements', r.id, 'insert')
        break
      }
      case 'contribution':
        if (s.contributions.some((x) => x.id === rec.row.id)) return
        if (!(rec.row.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero.')
        s.contributions.push({ ...rec.row, status: 'posted', ...stamp })
        this.audit('contributions', rec.row.id, 'insert')
        break
      case 'proceeds':
        if (s.proceeds.some((x) => x.id === rec.row.id)) return
        if (!(rec.row.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero.')
        if (rec.row.gross_price_cents != null && rec.row.amount_cents !== rec.row.gross_price_cents - (rec.row.selling_costs_cents ?? 0))
          throw new LedgerError('Net proceeds must equal the sale price minus selling costs.')
        s.proceeds.push({ ...rec.row, status: 'posted', ...stamp })
        this.audit('sale_proceeds', rec.row.id, 'insert')
        break
      case 'distribution':
        if (s.distributions.some((x) => x.id === rec.row.id)) return
        if (!(rec.row.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero.')
        this.checkPartner(rec.row.partner_user_id)
        s.distributions.push({ ...rec.row, status: 'posted', ...stamp })
        this.audit('distributions', rec.row.id, 'insert')
        break
      case 'commitment':
        if (s.commitments.some((x) => x.id === rec.row.id)) return
        if (!(rec.row.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero.')
        s.commitments.push({ ...rec.row, status: 'posted', ...stamp })
        this.audit('commitments', rec.row.id, 'insert')
        break
      case 'changeOrder':
        if (s.change_orders.some((x) => x.id === rec.row.id)) return
        if (rec.row.amount_cents === 0) throw new LedgerError('Enter a non-zero amount.')
        s.change_orders.push({ ...rec.row, status: review ? 'pending_review' : 'posted', ...stamp })
        this.audit('change_orders', rec.row.id, 'insert')
        break
    }
    this.changed()
  }

  async change(ref: EntryRef, c: StatusChange) {
    const s = this.snapshot
    const l = this.ledger
    const me = this.actingAs
    const now = this.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (): any[] => {
      switch (ref.kind) {
        case 'expense': return s.expenses
        case 'bill': return s.bills
        case 'payment': return s.payments
        case 'reimbursement': return s.reimbursements
        case 'contribution': return s.contributions
        case 'proceeds': return s.proceeds
        case 'distribution': return s.distributions
        case 'commitment': return s.commitments
        case 'changeOrder': return s.change_orders
      }
    }
    const row = list().find((r) => r.id === ref.id)
    if (!row) throw new LedgerError('Not found.')
    if (c.type === 'notes') {
      if (row.status === 'void') throw new LedgerError('Voided records cannot be changed.')
      row.notes = c.notes
      this.audit(ref.kind, ref.id, 'update')
    } else if (c.type === 'void') {
      Rules.checkVoid(ref, c.reason, l)
      if (row.status === 'void') throw new LedgerError('Already void.')
      Object.assign(row, { status: 'void', void_reason: c.reason, voided_by: me, voided_at: now })
      this.audit(ref.kind, ref.id, 'void', c.reason)
    } else if (c.type === 'approve') {
      if (ref.kind === 'bill' || ref.kind === 'changeOrder') {
        if (row.status !== 'pending_review') throw new LedgerError('Nothing to approve.')
        Rules.checkApproval(row.created_by as string, me)
        Object.assign(row, { status: 'posted', approved_by: me, approved_at: now })
      } else if (ref.kind === 'reimbursement') {
        if (row.status !== 'requested') throw new LedgerError('Nothing to approve.')
        Rules.checkApproval(row.created_by as string, me, row.partner_user_id as string)
        Object.assign(row, { status: 'approved', approved_by: me, approved_at: now })
      } else throw new LedgerError("This record doesn't need approval.")
      this.audit(ref.kind, ref.id, 'approve')
    } else {
      const r = s.reimbursements.find((x) => x.id === ref.id)
      if (!r) throw new LedgerError('Not found.')
      if (!(r.status === 'approved' || (r.status === 'requested' && !s.workspace.require_review))) {
        throw new LedgerError(r.status === 'requested' ? 'Another partner must approve this first.' : "Can't mark this paid.")
      }
      const paid = { ...r, status: 'paid', paid_date: c.date, payment_method: c.method, reference: c.reference }
      Rules.checkReimbursementPaid(paid, l)
      Object.assign(r, paid)
      this.audit('reimbursements', r.id, 'paid')
    }
    this.changed()
  }

  async saveProject(p: Parameters<Backend['saveProject']>[0]) {
    const i = this.snapshot.projects.findIndex((x) => x.id === p.id)
    if (i >= 0) this.snapshot.projects[i] = p
    else this.snapshot.projects.push(p)
    this.audit('projects', p.id, i >= 0 ? 'update' : 'insert')
    this.changed()
  }
  async saveVendor(v: Parameters<Backend['saveVendor']>[0]) {
    if (this.snapshot.vendors.some((x) => x.id !== v.id && x.name.toLowerCase() === v.name.toLowerCase())) {
      throw new LedgerError(`A vendor named ${v.name} already exists.`)
    }
    const i = this.snapshot.vendors.findIndex((x) => x.id === v.id)
    if (i >= 0) this.snapshot.vendors[i] = v
    else this.snapshot.vendors.push(v)
    this.changed()
  }
  async saveBudget(b: Parameters<Backend['saveBudget']>[0]) {
    this.snapshot.budgets = this.snapshot.budgets.filter((x) => !(x.project_id === b.project_id && x.category_id === b.category_id))
    this.snapshot.budgets.push(b)
    this.changed()
  }
  async saveCategory(c: Parameters<Backend['saveCategory']>[0]) {
    const i = this.snapshot.categories.findIndex((x) => x.id === c.id)
    if (i >= 0) this.snapshot.categories[i] = c
    else this.snapshot.categories.push(c)
    this.changed()
  }
  async saveWorkspace(w: Parameters<Backend['saveWorkspace']>[0]) {
    if (!this.isOwner) throw new LedgerError('Only an owner can change workspace settings.')
    this.snapshot.workspace = w
    this.changed()
  }
  async saveMember(m: Parameters<Backend['saveMember']>[0]) {
    const i = this.snapshot.members.findIndex((x) => x.user_id === m.user_id)
    if (i < 0) return
    if (m.role !== this.snapshot.members[i].role) {
      if (!this.isOwner) throw new LedgerError('Only an owner can change roles.')
      if (this.snapshot.members[i].role === 'owner' && !this.snapshot.members.some((x) => x.role === 'owner' && x.user_id !== m.user_id)) {
        throw new LedgerError('A workspace needs at least one owner.')
      }
    }
    this.snapshot.members[i] = m
    this.changed()
  }
  async setAccess(m: Parameters<Backend['setAccess']>[0], revoked: boolean) {
    const i = this.snapshot.members.findIndex((x) => x.user_id === m.user_id)
    if (i < 0) return
    const me = this.snapshot.members.find((x) => x.user_id === this.actingAs)
    if (me?.role !== 'owner' || me.access_revoked_at) throw new LedgerError('Only an owner can change who has access.')
    if (revoked && (this.snapshot.members[i].role === 'owner' || m.user_id === this.actingAs)) {
      throw new LedgerError('Change an owner to partner before removing their access.')
    }
    this.snapshot.members[i] = { ...this.snapshot.members[i], access_revoked_at: revoked ? this.now() : null }
    this.changed()
  }
  async invite(email: string, role: string, workspace: string) {
    if (!this.isOwner) throw new LedgerError('Only an owner can invite partners.')
    this.snapshot.invites.push({ id: uuid(), workspace_id: workspace, email: email.trim().toLowerCase(), role, accepted_at: null })
    this.changed()
  }
  async cancelInvite(i: Parameters<Backend['cancelInvite']>[0]) {
    this.snapshot.invites = this.snapshot.invites.filter((x) => x.id !== i.id)
    this.changed()
  }

  async upload(file: Blob, path: string) {
    if (!this.files.has(path)) this.files.set(path, URL.createObjectURL(file))
  }
  async addAttachment(a: Attachment) {
    if (a.client_id && this.snapshot.attachments.some((x) => x.client_id === a.client_id)) return
    this.snapshot.attachments.push({ ...a, uploaded_by: this.actingAs, created_at: this.now() })
    this.changed()
  }
  // Receipt inbox
  async addInboxItem(i: InboxItem) {
    if (this.snapshot.inbox_items.some((x) => x.id === i.id || (i.client_id && x.client_id === i.client_id))) return
    this.snapshot.inbox_items.push({ ...i, status: 'new', created_by: this.actingAs, created_at: this.now() })
    this.audit('inbox_items', i.id, 'insert')
    this.changed()
  }
  async updateInboxItem(id: string, patch: Parameters<Backend['updateInboxItem']>[1]) {
    const i = this.snapshot.inbox_items.findIndex((x) => x.id === id)
    if (i < 0) throw new LedgerError('Inbox item not found.')
    const cur = this.snapshot.inbox_items[i]
    const next = { ...cur, ...patch }
    if (cur.status === 'filed' && next.status !== 'filed') throw new LedgerError('This inbox item was already filed.')
    if (next.status === 'filed' && !next.filed_expense_id && !next.filed_bill_id) throw new LedgerError('File it as a receipt or bill first.')
    if (next.status === 'dismissed' && !next.dismiss_reason?.trim()) throw new LedgerError('Give a reason for dismissing it.')
    if (next.status !== cur.status) { next.handled_by = this.actingAs; next.handled_at = this.now() }
    this.snapshot.inbox_items[i] = next
    this.audit('inbox_items', id, 'update')
    this.changed()
  }
  // Statements
  async importStatementLines(lines: StatementLine[]) {
    const have = new Set(this.snapshot.statement_lines.map((l) => l.fingerprint))
    const fresh = lines.filter((l) => !have.has(l.fingerprint) && (have.add(l.fingerprint), true))
    for (const l of fresh) this.checkPartner(l.account_owner)
    this.snapshot.statement_lines.push(...fresh.map((l) => ({ ...l, status: 'unmatched', created_by: this.actingAs, created_at: this.now() })))
    if (fresh.length) this.changed()
    return fresh.length
  }
  async setStatementStatus(id: string, status: 'unmatched' | 'matched' | 'ignored', reason?: string | null) {
    const i = this.snapshot.statement_lines.findIndex((x) => x.id === id)
    if (i < 0) throw new LedgerError('Statement line not found.')
    if (status === 'ignored' && !reason?.trim()) throw new LedgerError('Give a reason for ignoring it.')
    this.snapshot.statement_lines[i] = { ...this.snapshot.statement_lines[i], status, ignore_reason: status === 'ignored' ? reason! : null, handled_by: this.actingAs, handled_at: this.now() }
    this.audit('statement_lines', id, 'update')
    this.changed()
  }
  async addMatch(m: StatementMatch) {
    const line = this.snapshot.statement_lines.find((l) => l.id === m.statement_line_id)
    if (!line) throw new LedgerError('Statement line not found.')
    if (this.snapshot.statement_matches.some((x) => x.id === m.id)) return
    if (this.snapshot.statement_matches.some((x) => (m.expense_id && x.expense_id === m.expense_id) || (m.bill_payment_id && x.bill_payment_id === m.bill_payment_id))) {
      throw new LedgerError('That record is already matched to a statement line.')
    }
    const amount = (x: StatementMatch) => {
      if (x.expense_id) { const e = this.snapshot.expenses.find((r) => r.id === x.expense_id); if (!e || e.status !== 'posted') throw new LedgerError('Only posted records can be matched.'); return e.is_refund ? -e.total_cents : e.total_cents }
      const p = this.snapshot.payments.find((r) => r.id === x.bill_payment_id); if (!p || p.status !== 'posted') throw new LedgerError('Only posted records can be matched.'); return p.kind === 'refund' ? -p.amount_cents : p.amount_cents
    }
    const total = this.snapshot.statement_matches.filter((x) => x.statement_line_id === line.id).reduce((a, x) => a + amount(x), 0) + amount(m)
    if (Math.abs(total) > Math.abs(line.amount_cents)) throw new LedgerError('Matched records add up to more than the statement line.')
    this.snapshot.statement_matches.push({ ...m, created_by: this.actingAs, created_at: this.now() })
    this.audit('statement_matches', m.id, 'insert')
    this.changed()
  }
  async removeMatch(id: string) {
    this.snapshot.statement_matches = this.snapshot.statement_matches.filter((x) => x.id !== id)
    this.audit('statement_matches', id, 'delete')
    this.changed()
  }
  // Weekly review and cash planning
  async claim(c: Claim) {
    if (c.claimed_by !== this.actingAs) throw new LedgerError('You can only claim items for yourself.')
    const other = this.snapshot.claims.find((x) => x.item_kind === c.item_kind && x.item_id === c.item_id)
    if (other) throw new LedgerError(`${this.snapshot.members.find((m) => m.user_id === other.claimed_by)?.display_name ?? 'Someone'} already claimed this.`)
    this.snapshot.claims.push({ ...c, claimed_at: this.now() })
    this.changed()
  }
  async releaseClaim(id: string) {
    this.snapshot.claims = this.snapshot.claims.filter((x) => x.id !== id)
    this.changed()
  }
  async saveDraw(d: ScheduledDraw) {
    if (!(d.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero.')
    const i = this.snapshot.scheduled_draws.findIndex((x) => x.id === d.id)
    if (i >= 0) this.snapshot.scheduled_draws[i] = d
    else this.snapshot.scheduled_draws.push({ ...d, created_by: this.actingAs, created_at: this.now() })
    this.changed()
  }
  async deleteDraw(id: string) {
    this.snapshot.scheduled_draws = this.snapshot.scheduled_draws.filter((x) => x.id !== id)
    this.changed()
  }
  async addCashBalance(c: CashBalance) {
    this.snapshot.cash_balances.push({ ...c, created_by: this.actingAs, created_at: this.now() })
    this.changed()
  }

  async setProfitShares(_ws: string, projectId: string | null, shares: { partner_user_id: string; share_bps: number }[]) {
    for (const x of shares) this.checkPartner(x.partner_user_id)
    const total = shares.reduce((a, x) => a + x.share_bps, 0)
    if (shares.length && total !== 10000) throw new LedgerError(`Profit shares must add up to 100%. These add up to ${(total / 100).toFixed(2)}%.`)
    if (shares.some((x) => x.share_bps < 0 || x.share_bps > 10000)) throw new LedgerError('Each share must be between 0% and 100%.')
    const ws = this.snapshot.workspace.id
    this.snapshot.profit_shares = this.snapshot.profit_shares.filter((x) => (x.project_id ?? null) !== projectId)
      .concat(shares.map((x) => ({ id: uuid(), workspace_id: ws, project_id: projectId, ...x })))
    this.audit('profit_shares', projectId ?? ws, 'update')
    this.changed()
  }
  async saveMaterial(m: Material) {
    if (!m.name.trim()) throw new LedgerError('Name the material.')
    if ([m.qty_bought, m.qty_used, m.qty_returned].some((q) => !(q >= 0))) throw new LedgerError('Quantities can’t be negative.')
    if (m.qty_used + m.qty_returned > m.qty_bought + 1e-9) throw new LedgerError('Used plus returned can’t be more than what was bought.')
    const list = this.snapshot.materials
    const i = list.findIndex((x) => x.id === m.id)
    if (i >= 0) list[i] = { ...m, created_by: list[i].created_by, created_at: list[i].created_at, updated_at: this.now() }
    else list.push({ ...m, created_by: this.actingAs, created_at: this.now(), updated_at: this.now() })
    this.audit('materials', m.id, i >= 0 ? 'update' : 'insert')
    this.changed()
  }
  async deleteMaterial(id: string) {
    this.snapshot.materials = this.snapshot.materials.filter((x) => x.id !== id)
    this.audit('materials', id, 'delete')
    this.changed()
  }
  async saveTemplate(t: EntryTemplate) {
    if (!t.name.trim()) throw new LedgerError('Name the template.')
    if (t.repeat !== 'none' && !t.next_due) throw new LedgerError('Pick when it’s next due.')
    if (t.amount_cents != null && !(t.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero, or leave it blank.')
    this.checkPartner(t.paid_by_user_id)
    const list = this.snapshot.entry_templates
    const i = list.findIndex((x) => x.id === t.id)
    if (i >= 0) list[i] = { ...t, created_by: list[i].created_by, created_at: list[i].created_at }
    else list.push({ ...t, created_by: this.actingAs, created_at: this.now() })
    this.audit('entry_templates', t.id, i >= 0 ? 'update' : 'insert')
    this.changed()
  }
  async deleteTemplate(id: string) {
    this.snapshot.entry_templates = this.snapshot.entry_templates.filter((x) => x.id !== id)
    this.audit('entry_templates', id, 'delete')
    this.changed()
  }

  async fileURL(path: string) {
    const url = this.files.get(path)
    if (!url) throw new LedgerError('Demo mode keeps documents only until you reload the page, and the sample documents have no real file.')
    return url
  }

  subscribe(_ws: string, onChange: () => void) {
    this.listeners.add(onChange)
    return () => { this.listeners.delete(onChange) }
  }
}
