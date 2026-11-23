import type {
  Allocation, Bill, BillPayment, BudgetCategory, ChangeOrder, Commitment, Contribution, EntryRef, Expense, Invite, Member,
  Project, ProjectBudget, Reimbursement, ReimbursementItem, SaleProceed, Snapshot, Vendor, Workspace, Attachment,
} from '../core/models'
import type { Day } from '../core/money'

/** New records other than receipts and bills (those carry a category split). */
export type NewRecord =
  | { type: 'payment'; row: BillPayment }
  | { type: 'reimbursement'; row: Reimbursement; items: ReimbursementItem[] }
  | { type: 'contribution'; row: Contribution }
  | { type: 'proceeds'; row: SaleProceed }
  | { type: 'commitment'; row: Commitment }
  | { type: 'changeOrder'; row: ChangeOrder }

/** Status changes on posted records. The server checks who may do what. */
export type StatusChange =
  | { type: 'approve' }
  | { type: 'markPaid'; date: Day; method: string; reference: string }
  | { type: 'void'; reason: string }

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
  fileURL(path: string): Promise<string>

  /** Calls back whenever shared data changes (other partners' edits). Returns an unsubscribe function. */
  subscribe(workspace: string, onChange: () => void): () => void
}

export class BackendError extends Error {
  constructor(message: string, readonly offline = false) { super(message) }
}
