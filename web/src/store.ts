// App state shared by all screens (mirrors ios/ProjectLedger/App/AppModel.swift).
import { useSyncExternalStore } from 'react'
import { Ledger } from './core/ledger'
import { Rules, LedgerError } from './core/rules'
import { uuid, Money } from './core/money'
import { emptySnapshot, type Snapshot, type Workspace, type EntryRef, type Project, type Vendor, type ProjectBudget,
  type BudgetCategory, type Member, type Invite, type Expense, type Bill, type Attachment , type InboxItem, type StatementLine, type Claim, type ClaimKind, type ScheduledDraw, type EntryTemplate, type Material } from './core/models'
import type { Backend, NewRecord, StatusChange } from './backend/types'
import { BackendError } from './backend/types'
import { DemoBackend } from './backend/demo'
import { SupabaseBackend } from './backend/supabase'
import { AppConfig } from './config'
import { DraftStore, draftAllocations, draftTotal, loadPayerDefault, newDraft, rememberPayer, type TransactionDraft } from './drafts'
import { advance } from './core/settlement'
import type { ImportContribution } from './core/bulkImport'
import { lineMatchedCents, suggestFromText, vendorFromDescription } from './core/planning'

export type Phase = 'launching' | 'welcome' | 'signIn' | 'chooseWorkspace' | 'ready'

/** Every form the app can open, from the Add menu or from a screen. */
/** Where a document gets filed: on a transaction, or directly on a project or vendor (permits, contracts, W-9s…). */
export type AttachTarget = { kind: 'record'; ref: EntryRef } | { kind: 'project'; id: string } | { kind: 'vendor'; id: string }

/** A receipt or bill entered from an inbox item (its file is attached) or a statement line (it gets matched). */
export type SubmitLink = { inbox?: InboxItem; line?: StatementLine; template?: EntryTemplate }

export type Modal =
  | { type: 'transaction'; draft: TransactionDraft; files?: File[]; link?: SubmitLink }
  | { type: 'splitLine'; line: StatementLine }
  | { type: 'draw'; commitmentId: string }
  | { type: 'distribution'; projectId: string; partnerId?: string | null; amountCents?: number | null }
  | { type: 'shares'; projectId: string | null }
  | { type: 'material'; projectId: string; material?: Material | null }
  | { type: 'template'; template?: EntryTemplate | null; from?: EntryRef | null }
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
  | { type: 'attach'; target: AttachTarget }

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
      if (this.me) loadPayerDefault(s.workspace.id, this.me)
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
  async submit(d: TransactionDraft, files: File[], link: SubmitLink = {}): Promise<boolean> {
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
      // 5. From the inbox: the inbox file becomes this record's document, and the item is marked filed.
      if (link.inbox) {
        const i = link.inbox
        await b.addAttachment({ ...this.attachmentRow(ws, i.storage_path, new File([], i.filename, { type: i.mime_type }), ref, i.id), size_bytes: i.size_bytes })
        await b.updateInboxItem(i.id, d.kind === 'bill' ? { status: 'filed', filed_bill_id: d.id } : { status: 'filed', filed_expense_id: d.id })
      }
      // 6. From a statement line: match the new receipt to it.
      if (link.line && d.kind === 'receipt') {
        await b.addMatch({ id: uuid(), workspace_id: ws, statement_line_id: link.line.id, expense_id: d.id })
        await b.setStatementStatus(link.line.id, 'matched')
      }
      // 7. From a repeating template: move it to the next due date.
      if (link.template && link.template.repeat !== 'none' && link.template.next_due) {
        await b.saveTemplate({ ...link.template, next_due: advance(link.template.next_due, link.template.repeat) })
      }
      if (d.kind === 'receipt' && !link.line && this.me) rememberPayer(ws, this.me, d.payer, d.payment_method)
      this.deleteDraft(d.id)
      this.showToast(d.kind === 'bill' ? 'Bill saved' : 'Receipt saved')
      await this.reload(true)
    })
  }

  /**
   * Bulk upload: posts many receipts and bills, adding new vendors once each. Rows are checked first; a row that
   * fails doesn't stop the others. Contribution rows are saved first. Returns the ids that were saved and an error per failed one.
   */
  async importMany(drafts: TransactionDraft[], onProgress?: (done: number) => void, contributions: ImportContribution[] = []): Promise<{ saved: string[]; failed: Record<string, string> }> {
    const b = this.backend
    const ws = this.workspace?.id
    const saved: string[] = []
    const failed: Record<string, string> = {}
    if (!b || !ws) return { saved, failed }
    const vendorIds = new Map<string, string>()
    try {
      for (const [i, c] of contributions.entries()) {
        try {
          await b.insert({ type: 'contribution', row: { ...c, workspace_id: ws, status: 'posted', client_id: c.id } })
          saved.push(c.id)
        } catch (e) {
          failed[c.id] = e instanceof Error ? e.message : String(e)
          if (e instanceof BackendError && e.offline) { for (const r of [...contributions.slice(i + 1), ...drafts]) failed[r.id] = 'Not saved: no connection.'; return { saved, failed } }
        }
        onProgress?.(i + 1)
      }
      for (const [i, d] of drafts.entries()) {
        try {
          let vendorId = d.vendor_id
          if (!vendorId) {
            const name = d.new_vendor_name.trim()
            const key = name.toLowerCase()
            vendorId = vendorIds.get(key) ?? this.snapshot?.vendors.find((v) => v.name.toLowerCase() === key)?.id ?? null
            if (!vendorId) {
              await b.saveVendor({ id: d.new_vendor_id, workspace_id: ws, name, kind: d.kind === 'bill' ? 'contractor' : 'supplier',
                contact_name: '', phone: '', email: '', address: '', notes: '' })
              vendorId = d.new_vendor_id
            }
            vendorIds.set(key, vendorId)
          }
          const { expense, bill, allocations } = this.build(d, ws, vendorId)
          if (expense) await b.postExpense(expense, allocations)
          if (bill) await b.postBill(bill, allocations)
          saved.push(d.id)
        } catch (e) {
          failed[d.id] = e instanceof Error ? e.message : String(e)
          if (e instanceof BackendError && e.offline) { for (const r of drafts.slice(i + 1)) failed[r.id] = 'Not saved: no connection.'; break }
        }
        onProgress?.(contributions.length + i + 1)
      }
    } finally {

      await this.reload(true)
    }
    return { saved, failed }
  }

  // --- Receipt inbox
  async addToInbox(files: File[], note: string): Promise<boolean> {
    const b = this.backend
    const ws = this.workspace?.id
    if (!b || !ws || files.length === 0) return false
    const ok = await this.run(async () => {
      for (const f of files) {
        const path = `${ws}/${uuid()}-${safeName(f.name)}`
        await b.upload(f, path, f.type || 'application/octet-stream')
        const id = uuid()
        await b.addInboxItem({ id, workspace_id: ws, storage_path: path, filename: f.name, mime_type: f.type || 'application/octet-stream', size_bytes: f.size,
          note: note.trim(), source: 'upload', status: 'new', client_id: id, ...suggestFromText(`${note} ${f.name}`, this.ledger) })
      }
    })
    if (ok) { this.showToast(files.length === 1 ? 'Added to the inbox' : `${files.length} files added to the inbox`); await this.reload(true) }
    return ok
  }
  dismissInbox(i: InboxItem, reason: string) { return this.simple((b) => b.updateInboxItem(i.id, { status: 'dismissed', dismiss_reason: reason.trim() }), 'Dismissed') }
  reopenInbox(i: InboxItem) { return this.simple((b) => b.updateInboxItem(i.id, { status: 'new', dismiss_reason: null }), 'Back in the inbox') }
  /** The category this vendor's latest receipt or bill used, so filing from the inbox or a statement needs one less pick. */
  private usualCategory(vendorId: string | null): string | null {
    const s = this.snapshot
    if (!s || !vendorId) return null
    const recs = [...s.bills.filter((b) => b.vendor_id === vendorId && !b.voided_at).map((b) => ({ d: b.bill_date, bill: b.id, exp: null as string | null })),
      ...s.expenses.filter((e) => e.vendor_id === vendorId && !e.voided_at).map((e) => ({ d: e.expense_date, bill: null as string | null, exp: e.id }))]
      .sort((a, b) => b.d.localeCompare(a.d))
    for (const r of recs) {
      const a = s.allocations.find((x) => (r.bill ? x.bill_id === r.bill : x.expense_id === r.exp))
      if (a) return a.category_id
    }
    return null
  }
  /** Draft for filing an inbox item, from its suggestions. */
  inboxDraft(i: InboxItem): TransactionDraft {
    const d = newDraft(i.suggested_kind === 'bill' ? 'bill' : 'receipt', i.suggested_project_id ?? null)
    const v = i.suggested_vendor ? this.snapshot?.vendors.find((x) => x.name.toLowerCase() === i.suggested_vendor!.toLowerCase()) : undefined
    if (v) d.vendor_id = v.id; else if (i.suggested_vendor) d.new_vendor_name = i.suggested_vendor
    if (i.suggested_total_cents) d.total_text = Money.plain(i.suggested_total_cents)
    if (i.suggested_date) d.date = i.suggested_date
    if (d.kind === 'bill') d.payer = 'llc'
    d.splits[0].category_id = this.usualCategory(d.vendor_id)
    d.description = i.note
    return d
  }

  // --- Statements
  async importStatement(lines: StatementLine[]): Promise<number | null> {
    const b = this.backend
    if (!b) return null
    let added = 0
    const ok = await this.run(async () => { added = await b.importStatementLines(lines) })
    if (!ok) return null
    this.showToast(added === lines.length ? `${added} statement lines imported` : `${added} new lines imported, ${lines.length - added} already in`)
    await this.reload(true)
    return added
  }
  matchLine(line: StatementLine, refs: EntryRef[]) {
    return this.simple(async (b) => {
      for (const r of refs) await b.addMatch({ id: uuid(), workspace_id: line.workspace_id, statement_line_id: line.id, expense_id: r.kind === 'expense' ? r.id : null, bill_payment_id: r.kind === 'payment' ? r.id : null })
      // Fully explained: matched. Partly (e.g. one of two receipts found so far): stays in the to-match list.
      const added = refs.reduce((a, r) => a + (this.ledger.entry(r)?.amount_cents ?? 0), 0)
      if (lineMatchedCents(this.ledger, line.id) + added === line.amount_cents) await b.setStatementStatus(line.id, 'matched')
    }, 'Matched')
  }
  unmatchLine(line: StatementLine) {
    return this.simple(async (b) => {
      for (const m of this.snapshot?.statement_matches.filter((x) => x.statement_line_id === line.id) ?? []) await b.removeMatch(m.id)
      await b.setStatementStatus(line.id, 'unmatched')
    }, 'Match undone')
  }
  ignoreLine(line: StatementLine, reason: string) { return this.simple((b) => b.setStatementStatus(line.id, 'ignored', reason.trim()), 'Ignored') }
  unignoreLine(line: StatementLine) { return this.simple((b) => b.setStatementStatus(line.id, 'unmatched'), 'Back to unmatched') }
  /** Draft receipt for a card charge: amount, date, vendor guess, and the card owner as payer. */
  lineDraft(line: StatementLine, projectId: string | null = null): TransactionDraft {
    const d = newDraft('receipt', projectId)
    const v = vendorFromDescription(line.description, this.ledger)
    if (v.vendor_id) d.vendor_id = v.vendor_id; else d.new_vendor_name = v.name
    d.total_text = Money.plain(Math.abs(line.amount_cents))
    d.is_refund = line.amount_cents < 0
    d.date = line.posted_date
    d.payer = line.account_owner ? (line.account_owner === this.me ? 'me' : line.account_owner) : 'llc'
    d.payment_method = line.account_owner ? 'card' : (/check/i.test(line.description) ? 'check' : 'ach')
    d.splits[0].category_id = this.usualCategory(d.vendor_id)
    d.description = line.description
    return d
  }
  /** One store trip split across properties: one receipt per property, all matched to the charge. */
  async splitLine(line: StatementLine, parts: TransactionDraft[]): Promise<boolean> {
    const total = parts.reduce((a, d) => a + (draftTotal(d) ?? 0) * (d.is_refund ? -1 : 1), 0)
    if (total !== line.amount_cents) { this.showError(new LedgerError(`The parts add up to ${Money.format(total)}, not the ${Money.format(line.amount_cents)} charge.`)); return false }
    const { saved, failed } = await this.importMany(parts)
    const err = Object.values(failed)[0]
    if (err) { this.showError(new LedgerError(saved.length ? `${saved.length} of ${parts.length} saved. ${err}` : err)); return false }
    return this.simple(async (b) => {
      for (const id of saved) await b.addMatch({ id: uuid(), workspace_id: line.workspace_id, statement_line_id: line.id, expense_id: id })
      await b.setStatementStatus(line.id, 'matched')
    }, `Split into ${saved.length} receipts and matched`)
  }

  // --- Weekly review and cash planning
  claim(kind: ClaimKind, id: string) {
    const ws = this.workspace?.id
    if (!ws || !this.me) return Promise.resolve(false)
    return this.simple((b) => b.claim({ id: uuid(), workspace_id: ws, item_kind: kind, item_id: id, claimed_by: this.me! }), 'Claimed: it’s yours')
  }
  releaseClaim(c: Claim) { return this.simple((b) => b.releaseClaim(c.id), 'Released') }
  saveDraw(d: ScheduledDraw) { return this.simple((b) => b.saveDraw(d), 'Draw scheduled') }

  // --- Sale, profit split, materials, templates
  setProfitShares(projectId: string | null, shares: { partner_user_id: string; share_bps: number }[]) {
    const ws = this.workspace?.id
    if (!ws) return Promise.resolve(false)
    return this.simple((b) => b.setProfitShares(ws, projectId, shares), shares.length ? 'Profit split saved' : 'Back to the default split')
  }
  saveMaterial(m: Material) { return this.simple((b) => b.saveMaterial(m), 'Material saved') }
  deleteMaterial(id: string) { return this.simple((b) => b.deleteMaterial(id), 'Material removed') }
  saveTemplate(t: EntryTemplate, quiet = false) { return this.simple((b) => b.saveTemplate(t), quiet ? undefined : 'Template saved') }
  deleteTemplate(id: string) { return this.simple((b) => b.deleteTemplate(id), 'Template removed') }
  /** Draft from a template: today's date (or its due date when that's past), everything else filled in. */
  templateDraft(t: EntryTemplate): TransactionDraft {
    const d = newDraft(t.kind, t.project_id ?? null)
    d.vendor_id = t.vendor_id ?? null
    if (t.amount_cents) d.total_text = Money.plain(t.amount_cents)
    d.splits[0].category_id = t.category_id ?? null
    d.description = t.description
    d.payment_method = t.payment_method
    if (t.kind === 'receipt') d.payer = t.paid_by_user_id ? (t.paid_by_user_id === this.me ? 'me' : t.paid_by_user_id) : 'llc'
    if (t.kind === 'bill' && t.next_due) d.due_date = t.next_due
    return d
  }
  /** "Add again": a new draft copying a receipt or bill (vendor, project, amount, categories, payer), dated today. */
  againDraft(ref: EntryRef): TransactionDraft | null {
    const s = this.snapshot
    if (!s) return null
    const e = ref.kind === 'expense' ? s.expenses.find((x) => x.id === ref.id) : undefined
    const b = ref.kind === 'bill' ? s.bills.find((x) => x.id === ref.id) : undefined
    const rec = e ?? b
    if (!rec) return null
    const d = newDraft(e ? 'receipt' : 'bill', rec.project_id)
    d.vendor_id = rec.vendor_id
    d.total_text = Money.plain(rec.total_cents)
    d.description = rec.description
    const allocs = s.allocations.filter((a) => (e ? a.expense_id === e.id : a.bill_id === b!.id))
    if (allocs.length === 1) d.splits = [{ id: uuid(), category_id: allocs[0].category_id, amount_text: '' }]
    else if (allocs.length > 1) d.splits = allocs.map((a) => ({ id: uuid(), category_id: a.category_id, amount_text: Money.plain(a.amount_cents) }))
    if (e) {
      d.payer = e.paid_by_user_id ? (e.paid_by_user_id === this.me ? 'me' : e.paid_by_user_id) : 'llc'
      d.payment_method = e.payment_method
    }
    return d
  }
  deleteDraw(id: string) { return this.simple((b) => b.deleteDraw(id), 'Draw removed') }
  setCash(amount: number, asOf: string, note: string) {
    const ws = this.workspace?.id
    if (!ws) return Promise.resolve(false)
    return this.simple((b) => b.addCashBalance({ id: uuid(), workspace_id: ws, as_of: asOf, amount_cents: amount, note }), 'Cash on hand updated')
  }

  private attachmentRow(ws: string, path: string, f: File, target: AttachTarget | EntryRef, clientId: string): Attachment {
    const a: Attachment = { id: uuid(), workspace_id: ws, storage_path: path, filename: f.name, mime_type: f.type || 'application/octet-stream',
      size_bytes: f.size, client_id: clientId }
    if (target.kind === 'project') { a.project_id = target.id; return a }
    if (target.kind === 'vendor') { a.vendor_id = target.id; return a }
    const ref = target.kind === 'record' ? target.ref : target
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
  async attach(files: File[], target: AttachTarget | EntryRef): Promise<boolean> {
    const b = this.backend
    const ws = this.workspace?.id
    if (!b || !ws || files.length === 0) return true
    const ok = await this.run(async () => {
      for (const f of files) {
        const path = `${ws}/${uuid()}-${safeName(f.name)}`
        await b.upload(f, path, f.type || 'application/octet-stream')
        await b.addAttachment(this.attachmentRow(ws, path, f, target, uuid()))
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
  async setAccess(m: Member, revoked: boolean) {
    const b = this.backend
    if (!b) return false
    const ok = await this.run(() => b.setAccess(m, revoked))
    if (ok) { this.showToast(revoked ? `${m.display_name} can no longer see this LLC` : `${m.display_name} has access again`); await this.reload(true) }
    return ok
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
