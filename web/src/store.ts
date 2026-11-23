// App state shared by all screens (mirrors ios/ProjectLedger/App/AppModel.swift).
import { useSyncExternalStore } from 'react'
import { Ledger } from './core/ledger'
import { Rules, LedgerError } from './core/rules'
import { uuid, Money } from './core/money'
import { emptySnapshot, type Snapshot, type Workspace, type EntryRef, type Project, type Vendor, type ProjectBudget,
  type BudgetCategory, type Member, type Invite, type Expense, type Bill, type Attachment } from './core/models'
import type { Backend, NewRecord, StatusChange } from './backend/types'
import { DemoBackend } from './backend/demo'
import { SupabaseBackend } from './backend/supabase'
import { AppConfig } from './config'
import { DraftStore, draftAllocations, draftTotal, type TransactionDraft } from './drafts'

export type Phase = 'launching' | 'welcome' | 'signIn' | 'chooseWorkspace' | 'ready'

/** Every form the app can open, from the Add menu or from a screen. */
export type Modal =
  | { type: 'transaction'; draft: TransactionDraft; files?: File[] }
  | { type: 'voice' }
  | { type: 'payment'; billId?: string | null }
  | { type: 'contribution'; projectId?: string | null; partnerId?: string | null }
  | { type: 'reimbursement'; partnerId?: string | null }
  | { type: 'commitment'; projectId?: string | null }
  | { type: 'changeOrder'; commitmentId: string }
  | { type: 'proceeds'; projectId: string }
  | { type: 'project'; project?: Project | null }
  | { type: 'budget'; projectId: string }
  | { type: 'vendor'; vendor?: Vendor | null }
  | { type: 'void'; ref: EntryRef }
  | { type: 'markPaid'; ref: EntryRef }
  | { type: 'attach'; ref: EntryRef }

function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9.-]/g, '-')
}

export class AppStore {
  phase: Phase = 'launching'
  backend: Backend | null = null
  snapshot: Snapshot | null = null
  ledger: Ledger = new Ledger(emptySnapshot({ id: '', name: '', require_review: false }))
  workspaces: Workspace[] = []
  syncing = false
  lastSynced: Date | null = null
  toast: string | null = null
  error: string | null = null
  modal: Modal | null = null
  drafts: DraftStore | null = null
  draftList: TransactionDraft[] = []
  private unsubscribe: (() => void) | null = null
  private reloadTimer: number | undefined
  private toastTimer: number | undefined
  private listeners = new Set<() => void>()
  private version = 0

  // --- subscription for React
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f) } }
  getVersion = () => this.version
  emit() { this.version++; this.listeners.forEach((f) => f()) }

  get isDemo() { return this.backend?.isDemo ?? false }
  get me() { return this.backend?.userId() ?? null }
  get myMember() { return this.snapshot?.members.find((m) => m.user_id === this.me) }
  get isOwner() { return this.myMember?.role === 'owner' }
  get workspace() { return this.snapshot?.workspace ?? null }
  get demo() { return this.backend instanceof DemoBackend ? this.backend : null }

  showToast(msg: string) {
    this.error = null // a success means an earlier error no longer applies
    this.toast = msg
    window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => { this.toast = null; this.emit() }, 3000)
    this.emit()
  }
  showError(e: unknown) {
    this.error = e instanceof Error ? e.message : String(e)
    this.emit()
  }
  open(m: Modal | null) { this.modal = m; this.emit() }

  // --- startup
  async launch() {
    if (AppConfig.lastMode === 'demo') return this.startDemo()
    if (AppConfig.lastMode === 'live' && AppConfig.isLiveConfigured) {
      const b = this.makeLive()
      if (await b.restoreSession()) return this.afterSignIn()
      this.phase = 'signIn'
      return this.emit()
    }
    this.phase = 'welcome'
    this.emit()
  }

  startDemo() {
    AppConfig.lastMode = 'demo'
    const b = new DemoBackend()
    this.backend = b
    return this.openWorkspace(b.snapshot.workspace.id)
  }

  makeLive() {
    const b = new SupabaseBackend(AppConfig.supabaseUrl, AppConfig.supabaseAnonKey)
    this.backend = b
    return b
  }

  chooseLive() {
    if (!AppConfig.isLiveConfigured) { this.phase = 'welcome'; return this.emit() }
    AppConfig.lastMode = 'live'
    this.makeLive()
    this.phase = 'signIn'
    this.emit()
  }

  async run(action: () => Promise<void>): Promise<boolean> {
    try {
      await action()
      return true
    } catch (e) {
      this.showError(e)
      return false
    }
  }

  async signIn(email: string, password: string, create: boolean) {
    const b = this.backend
    if (!b) return
    await this.run(async () => {
      if (create) await b.signUp(email, password)
      else await b.signIn(email, password)
      await this.afterSignIn()
    })
  }

  private async afterSignIn() {
    const b = this.backend
    if (!b) return
    await this.run(async () => {
      this.workspaces = await b.myWorkspaces()
      const last = AppConfig.lastWorkspace
      if (last && this.workspaces.some((w) => w.id === last)) await this.openWorkspace(last)
      else if (this.workspaces.length === 1) await this.openWorkspace(this.workspaces[0].id)
      else { this.phase = 'chooseWorkspace'; this.emit() }
    })
  }

  async joinInvites(displayName: string) {
    const b = this.backend
    if (!b) return
    await this.run(async () => {
      const n = await b.acceptInvites(displayName)
      if (n === 0) throw new LedgerError(`No invitation found for ${b.userEmail() ?? 'this email'}. Ask the owner to invite this exact email.`)
      await this.afterSignIn()
    })
  }

  async createWorkspace(name: string, displayName: string) {
    const b = this.backend
    if (!b) return
    await this.run(async () => {
      const id = await b.createWorkspace(name, displayName)
      this.workspaces = await b.myWorkspaces()
      await this.openWorkspace(id)
    })
  }

  async openWorkspace(id: string) {
    const b = this.backend
    if (!b) return
    AppConfig.lastWorkspace = id
    this.drafts = new DraftStore(b.isDemo ? 'demo' : id)
    this.draftList = this.drafts.all()
    await this.reload()
    if (!this.snapshot) return
    this.phase = 'ready'
    this.unsubscribe?.()
    this.unsubscribe = b.subscribe(id, () => {
      // Coalesce bursts of changes into one reload.
      window.clearTimeout(this.reloadTimer)
      this.reloadTimer = window.setTimeout(() => this.reload(true), 400)
    })
    this.emit()
  }

  async signOut() {
    this.unsubscribe?.()
    this.unsubscribe = null
    await this.backend?.signOut()
    this.snapshot = null
    this.backend = null
    this.drafts = null
    this.draftList = []
    AppConfig.lastMode = null
    AppConfig.lastWorkspace = null
    this.phase = 'welcome'
    this.emit()
  }

  async reload(quiet = false) {
    const b = this.backend
    const id = AppConfig.lastWorkspace ?? this.snapshot?.workspace.id
    if (!b || !id) return
    if (!quiet) { this.syncing = true; this.emit() }
    try {
      const s = await b.load(id)
      this.snapshot = s
      this.ledger = new Ledger(s)
      this.lastSynced = new Date()
    } catch (e) {
      if (!quiet) this.showError(e)
    } finally {
      this.syncing = false
      this.emit()
    }
  }

  // --- drafts
  saveDraft(d: TransactionDraft) {
    this.drafts?.save(d)
    this.draftList = this.drafts?.all() ?? []
    this.emit()
  }
  deleteDraft(id: string) {
    this.drafts?.remove(id)
    this.draftList = this.drafts?.all() ?? []
    this.emit()
  }

  /** Builds the record from a draft, checking the same rules as the server. */
  private build(d: TransactionDraft, ws: string, vendorId: string): { expense?: Expense; bill?: Bill; allocations: { category_id: string; amount_cents: number }[] } {
    if (!d.project_id) throw new LedgerError('Choose a project.')
    const total = draftTotal(d)
    if (!total || total <= 0) throw new LedgerError('Enter the total.')
    const allocations = draftAllocations(d)
    const taxCents = Math.max(Money.parse(d.tax_text) ?? 0, 0)
    if (d.kind === 'receipt') {
      const payer = d.payer === 'me' ? this.me : d.payer === 'llc' ? null : d.payer
      const e: Expense = {
        id: d.id, workspace_id: ws, project_id: d.project_id, vendor_id: vendorId, expense_date: d.date, description: d.description.trim(),
        total_cents: total, tax_cents: taxCents, is_refund: d.is_refund, paid_by_user_id: payer, payment_method: d.payment_method,
        reference: d.reference.trim() || d.invoice_number.trim(), status: 'posted', client_id: d.id,
      }
      Rules.checkExpense(e, allocations)
      return { expense: e, allocations }
    }
    const b: Bill = {
      id: d.id, workspace_id: ws, project_id: d.project_id, vendor_id: vendorId, commitment_id: d.commitment_id,
      invoice_number: d.invoice_number.trim(), bill_date: d.date, due_date: d.due_date || null, description: d.description.trim(),
      total_cents: total, tax_cents: taxCents, status: 'posted', client_id: d.id,
    }
    Rules.checkBill(b, allocations, this.ledger)
    return { bill: b, allocations }
  }

  /** Validates and posts a receipt or bill with its documents. */
  async submit(d: TransactionDraft, files: File[]): Promise<boolean> {
    const b = this.backend
    const ws = this.workspace?.id
    if (!b || !ws) return false
    const newName = d.new_vendor_name.trim()
    if (!d.vendor_id && !newName) { this.showError(new LedgerError('Choose or type a vendor.')); return false }
    // Check everything locally first (with a placeholder vendor id).
    try { this.build(d, ws, d.vendor_id ?? d.new_vendor_id) } catch (e) { this.showError(e); return false }
    return this.run(async () => {
      // 1. Vendor typed by name: reuse an existing one or create it (same id every retry).
      let vendorId = d.vendor_id
      if (!vendorId) {
        const existing = this.snapshot?.vendors.find((v) => v.name.toLowerCase() === newName.toLowerCase())
        if (existing) vendorId = existing.id
        else {
          await b.saveVendor({ id: d.new_vendor_id, workspace_id: ws, name: newName, kind: d.kind === 'bill' ? 'contractor' : 'supplier',
            contact_name: '', phone: '', email: '', address: '', notes: '' })
          vendorId = d.new_vendor_id
        }
      }
      // 2. Upload files (safe to repeat).
      const uploads = files.map((f) => ({ f, id: uuid(), path: `${ws}/${uuid()}-${safeName(f.name)}` }))
      for (const u of uploads) await b.upload(u.f, u.path, u.f.type || 'application/octet-stream')
      // 3. Post the record with its category split (idempotent by id).
      const { expense, bill, allocations } = this.build(d, ws, vendorId)
      if (expense) await b.postExpense(expense, allocations)
      if (bill) await b.postBill(bill, allocations)
      // 4. Link the files.
      const ref: EntryRef = { kind: d.kind === 'bill' ? 'bill' : 'expense', id: d.id }
      for (const u of uploads) await b.addAttachment(this.attachmentRow(ws, u.path, u.f, ref, u.id))
      this.deleteDraft(d.id)
      this.showToast(d.kind === 'bill' ? 'Bill saved' : 'Receipt saved')
      await this.reload(true)
    })
  }

  private attachmentRow(ws: string, path: string, f: File, ref: EntryRef, clientId: string): Attachment {
    const a: Attachment = { id: uuid(), workspace_id: ws, storage_path: path, filename: f.name, mime_type: f.type || 'application/octet-stream',
      size_bytes: f.size, client_id: clientId }
    switch (ref.kind) {
      case 'expense': a.expense_id = ref.id; break
      case 'bill': a.bill_id = ref.id; break
      case 'payment': a.bill_payment_id = ref.id; break
      case 'reimbursement': a.reimbursement_id = ref.id; break
      case 'contribution': a.contribution_id = ref.id; break
      case 'commitment': case 'changeOrder': a.commitment_id = ref.id; break
      case 'proceeds': a.project_id = this.snapshot?.proceeds.find((p) => p.id === ref.id)?.project_id ?? null; break
    }
    return a
  }

  /** Uploads documents and links them to an existing record. Never changes amounts. */
  async attach(files: File[], ref: EntryRef): Promise<boolean> {
    const b = this.backend
    const ws = this.workspace?.id
    if (!b || !ws || files.length === 0) return true
    const ok = await this.run(async () => {
      for (const f of files) {
        const path = `${ws}/${uuid()}-${safeName(f.name)}`
        await b.upload(f, path, f.type || 'application/octet-stream')
        await b.addAttachment(this.attachmentRow(ws, path, f, ref, uuid()))
      }
    })
    if (ok) { this.showToast(files.length === 1 ? 'Document attached' : `${files.length} documents attached`); await this.reload(true) }
    return ok
  }

  async fileURL(a: Attachment): Promise<string | null> {
    try { return (await this.backend?.fileURL(a.storage_path)) ?? null } catch (e) { this.showError(e); return null }
  }

  // --- other records
  async insert(rec: NewRecord, success: string) {
    const b = this.backend
    if (!b) return false
    const ok = await this.run(() => b.insert(rec))
    if (ok) { this.showToast(success); await this.reload(true) }
    return ok
  }
  async change(ref: EntryRef, c: StatusChange, success: string) {
    const b = this.backend
    if (!b) return false
    const ok = await this.run(() => b.change(ref, c))
    if (ok) { this.showToast(success); await this.reload(true) }
    return ok
  }
  private async simple(action: (b: Backend) => Promise<void>, success?: string) {
    const b = this.backend
    if (!b) return false
    const ok = await this.run(() => action(b))
    if (ok) { if (success) this.showToast(success); await this.reload(true) }
    return ok
  }
  saveProject(p: Project) { return this.simple((b) => b.saveProject(p), 'Project saved') }
  saveVendor(v: Vendor) { return this.simple((b) => b.saveVendor(v), 'Vendor saved') }
  saveBudgets(list: ProjectBudget[]) { return this.simple(async (b) => { for (const x of list) await b.saveBudget(x) }, 'Budget saved') }
  saveCategory(c: BudgetCategory) { return this.simple((b) => b.saveCategory(c)) }
  saveWorkspace(w: Workspace) { return this.simple((b) => b.saveWorkspace(w), 'Settings saved') }
  saveMember(m: Member) { return this.simple((b) => b.saveMember(m), 'Saved') }
  invite(email: string, role: string) {
    const ws = this.workspace?.id
    return ws ? this.simple((b) => b.invite(email, role, ws), 'Invitation saved') : Promise.resolve(false)
  }
  cancelInvite(i: Invite) { return this.simple((b) => b.cancelInvite(i)) }

  // --- demo helpers
  async actAs(uid: string) {
    this.demo?.actAs(uid)
    await this.reload(true)
    this.showToast(`Now acting as ${this.ledger.payerName(uid)}`)
  }
  async resetDemo() {
    this.demo?.reset()
    await this.reload(true)
    this.showToast('Sample data reset')
  }
}

export const store = new AppStore()

/** Re-renders the component whenever app state changes. */
export function useStore(): AppStore {
  useSyncExternalStore(store.subscribe, store.getVersion)
  return store
}
