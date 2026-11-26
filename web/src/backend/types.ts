import type {
  Allocation, Bill, BillPayment, BudgetCategory, ChangeOrder, Commitment, Contribution, EntryRef, Expense, Invite, Member,
  Project, ProjectBudget, Reimbursement, ReimbursementItem, SaleProceed, Snapshot, Vendor, Workspace, Attachment, InboxItem, StatementLine, StatementMatch, Claim, ScheduledDraw, CashBalance, Distribution, EntryTemplate, Material, } from '../core/models'
import type { Day } from '../core/money'

/** New records other than receipts and bills (those carry a category split). */
export type NewRecord =
  | { type: 'payment'; row: BillPayment }
  | { type: 'reimbursement'; row: Reimbursement; items: ReimbursementItem[] }
  | { type: 'contribution'; row: Contribution }
  | { type: 'proceeds'; row: SaleProceed }
  | { type: 'distribution'; row: Distribution }
  | { type: 'commitment'; row: Commitment }
  | { type: 'changeOrder'; row: ChangeOrder }

/** Status changes on posted records. The server checks who may do what. */
export type StatusChange =
  | { type: 'approve' }
  | { type: 'markPaid'; date: Day; method: string; reference: string }
  | { type: 'void'; reason: string }
  /** Notes never change amounts, so they can be edited on a posted record. */
  | { type: 'notes'; notes: string }

export type AllocationInput = Pick<Allocation, 'category_id' | 'amount_cents'>

/** Live (Supabase) or demo (in this browser). Both apply the same rules. */
export interface Backend {
  readonly isDemo: boolean
  userId(): string | null
  userEmail(): string | null

  restoreSession(): Promise<boolean>
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<void>
  signOut(): Promise<void>

  myWorkspaces(): Promise<Workspace[]>
  acceptInvites(displayName: string): Promise<number>
  createWorkspace(name: string, displayName: string): Promise<string>
  load(workspace: string): Promise<Snapshot>

  postExpense(e: Expense, allocations: AllocationInput[]): Promise<void>
  postBill(b: Bill, allocations: AllocationInput[]): Promise<void>
  insert(record: NewRecord): Promise<void>
  change(ref: EntryRef, change: StatusChange): Promise<void>

  saveProject(p: Project): Promise<void>
  saveVendor(v: Vendor): Promise<void>
  saveBudget(b: ProjectBudget): Promise<void>
  saveCategory(c: BudgetCategory): Promise<void>
  saveWorkspace(w: Workspace): Promise<void>
  saveMember(m: Member): Promise<void>
  /** Owner only: remove (revoked = true) or restore a partner's access. Their records and balances stay. */
  setAccess(m: Member, revoked: boolean): Promise<void>
  invite(email: string, role: string, workspace: string): Promise<void>
  cancelInvite(i: Invite): Promise<void>

  upload(file: Blob, path: string, mimeType: string): Promise<void>
  addAttachment(a: Attachment): Promise<void>

  // Receipt inbox
  addInboxItem(i: InboxItem): Promise<void>
  /** Status changes only: file (with the new record), dismiss (with a reason), or reopen a dismissed item. */
  updateInboxItem(id: string, patch: Partial<Pick<InboxItem, 'status' | 'filed_expense_id' | 'filed_bill_id' | 'dismiss_reason'>>): Promise<void>
  // Statements
  /** Adds lines, skipping any whose fingerprint is already in. Returns how many were new. */
  importStatementLines(lines: StatementLine[]): Promise<number>
  setStatementStatus(id: string, status: 'unmatched' | 'matched' | 'ignored', reason?: string | null): Promise<void>
  addMatch(m: StatementMatch): Promise<void>
  removeMatch(id: string): Promise<void>
  // Weekly review and cash planning
  claim(c: Claim): Promise<void>
  releaseClaim(id: string): Promise<void>
  saveDraw(d: ScheduledDraw): Promise<void>
  deleteDraw(id: string): Promise<void>
  addCashBalance(c: CashBalance): Promise<void>
  // Sale and profit split
  /** Replaces the split for a project (or the LLC default when projectId is null). An empty list goes back to the default. */
  setProfitShares(workspace: string, projectId: string | null, shares: { partner_user_id: string; share_bps: number }[]): Promise<void>
  // Materials and templates (not money; can be edited and removed)
  saveMaterial(m: Material): Promise<void>
  deleteMaterial(id: string): Promise<void>
  saveTemplate(t: EntryTemplate): Promise<void>
  deleteTemplate(id: string): Promise<void>
  fileURL(path: string): Promise<string>

  /** Calls back whenever shared data changes (other partners' edits). Returns an unsubscribe function. */
  subscribe(workspace: string, onChange: () => void): () => void
}

export class BackendError extends Error {
  constructor(message: string, readonly offline = false) { super(message) }
}
