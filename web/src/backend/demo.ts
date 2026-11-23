// DEMO MODE: a sample LLC kept in this browser only. Nothing is uploaded or shared.
// Applies the same rules as the database so balances behave exactly like live mode.
import { Ledger } from '../core/ledger'
import { Rules, LedgerError } from '../core/rules'
import { demoSnapshot, DemoIds } from '../core/demoData'
import { Days } from '../core/money'
import type { Snapshot, EntryRef, Attachment } from '../core/models'
import type { Backend, NewRecord, StatusChange, AllocationInput } from './types'
import { uuid } from '../core/money'

const KEY = 'ledger.demo.snapshot'
const ACTOR_KEY = 'ledger.demo.actingAs'

function load(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
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
        s.proceeds.push({ ...rec.row, status: 'posted', ...stamp })
        this.audit('sale_proceeds', rec.row.id, 'insert')
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
        case 'commitment': return s.commitments
        case 'changeOrder': return s.change_orders
      }
    }
    const row = list().find((r) => r.id === ref.id)
    if (!row) throw new LedgerError('Not found.')
    if (c.type === 'void') {
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
