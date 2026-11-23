// Row types match the Supabase tables in supabase/migrations exactly (snake_case),
// so live data needs no conversion. Money is integer cents; days are "yyyy-mm-dd".
import type { Cents, Day } from './money'

export const RecordStatus = {
  pendingReview: 'pending_review',
  posted: 'posted',
  void: 'void',
  requested: 'requested',
  approved: 'approved',
  paid: 'paid',
} as const

export const PaymentMethods: [string, string][] = [
  ['card', 'Card'], ['check', 'Check'], ['cash', 'Cash'], ['ach', 'ACH'],
  ['zelle', 'Zelle'], ['wire', 'Wire'], ['other', 'Other'],
]
export const methodLabel = (m: string) => PaymentMethods.find(([k]) => k === m)?.[1] ?? m

export interface Workspace { id: string; name: string; require_review: boolean }

export interface Member {
  workspace_id: string
  user_id: string
  role: 'owner' | 'partner' | string
  display_name: string
  email?: string | null
}

export interface Invite { id: string; workspace_id: string; email: string; role: string; accepted_at?: string | null }

export interface BudgetCategory { id: string; workspace_id: string; name: string; sort_order: number; archived: boolean }
export const defaultCategoryNames = ['Acquisition', 'Permits', 'Demolition', 'Framing', 'Plumbing', 'Electrical', 'HVAC',
  'Labor', 'Materials', 'Equipment Rentals', 'Utilities', 'Financing', 'Insurance', 'Closing Costs']

export interface Project {
  id: string
  workspace_id: string
  nickname: string
  address: string
  project_type: string // flip, new_construction
  status: string // planning, active, listed, sold, on_hold
  start_date?: Day | null
  target_complete_date?: Day | null
  target_sale_date?: Day | null
  notes: string
}
export const ProjectTypes: [string, string][] = [['flip', 'Flip'], ['new_construction', 'New construction']]
export const ProjectStatuses: [string, string][] = [['planning', 'Planning'], ['active', 'Active'], ['listed', 'Listed'], ['sold', 'Sold'], ['on_hold', 'On hold']]
export const projectTypeLabel = (p: Project) => ProjectTypes.find(([k]) => k === p.project_type)?.[1] ?? p.project_type
export const projectStatusLabel = (p: Project) => ProjectStatuses.find(([k]) => k === p.status)?.[1] ?? p.status
export const isActiveProject = (p: Project) => p.status !== 'sold'

export interface ProjectBudget { workspace_id: string; project_id: string; category_id: string; amount_cents: Cents }

export interface Vendor {
  id: string
  workspace_id: string
  name: string
  kind: string // contractor, supplier, utility, government, other
  contact_name: string
  phone: string
  email: string
  address: string
  notes: string
}
export const VendorKinds = ['contractor', 'supplier', 'utility', 'government', 'other']

interface RecordBase {
  id: string
  workspace_id: string
  status: string
  client_id?: string | null
  created_by?: string | null
  created_at?: string | null
  voided_by?: string | null
  voided_at?: string | null
  void_reason?: string | null
}

export interface Commitment extends RecordBase {
  project_id: string
  vendor_id: string
  category_id: string
  description: string
  amount_cents: Cents
}

export interface ChangeOrder extends RecordBase {
  commitment_id: string
  description: string
  amount_cents: Cents
  approved_by?: string | null
  approved_at?: string | null
}

export interface Bill extends RecordBase {
  project_id: string
  vendor_id: string
  commitment_id?: string | null
  invoice_number: string
  bill_date: Day
  due_date?: Day | null
  description: string
  total_cents: Cents
  tax_cents: Cents
  approved_by?: string | null
  approved_at?: string | null
}

/** A receipt: a purchase that was already paid. */
export interface Expense extends RecordBase {
  project_id: string
  vendor_id: string
  expense_date: Day
  description: string
  total_cents: Cents
  tax_cents: Cents
  is_refund: boolean
  /** null = paid from the LLC account */
  paid_by_user_id?: string | null
  payment_method: string
  reference: string
}
export const signedCents = (e: Expense) => (e.is_refund ? -e.total_cents : e.total_cents)

export interface Allocation {
  id: string
  workspace_id: string
  bill_id?: string | null
  expense_id?: string | null
  category_id: string
  amount_cents: Cents
}

export interface BillPayment extends RecordBase {
  bill_id: string
  kind: 'payment' | 'credit' | 'refund' | string
  payment_date: Day
  amount_cents: Cents
  paid_by_user_id?: string | null
  payment_method: string
  reference: string
}
export const paidEffect = (p: BillPayment) => (p.kind === 'payment' ? p.amount_cents : p.kind === 'refund' ? -p.amount_cents : 0)
export const outstandingEffect = (p: BillPayment) => (p.kind === 'refund' ? p.amount_cents : -p.amount_cents)
export const paymentKindLabel = (k: string) => (k === 'credit' ? 'Vendor credit' : k === 'refund' ? 'Vendor refund' : 'Payment')

export interface Reimbursement extends RecordBase {
  partner_user_id: string
  amount_cents: Cents
  request_date: Day
  paid_date?: Day | null
  payment_method: string
  reference: string
  notes: string
  approved_by?: string | null
  approved_at?: string | null
}
export const isPaidR = (r: Reimbursement) => r.status === RecordStatus.paid
export const isPendingR = (r: Reimbursement) => r.status === RecordStatus.requested || r.status === RecordStatus.approved

export interface ReimbursementItem {
  id: string
  workspace_id: string
  reimbursement_id: string
  expense_id?: string | null
  bill_payment_id?: string | null
  amount_cents: Cents
}

export interface Contribution extends RecordBase {
  partner_user_id: string
  project_id?: string | null
  amount_cents: Cents
  contribution_date: Day
  payment_method: string
  reference: string
  notes: string
}

export interface SaleProceed extends RecordBase {
  project_id: string
  amount_cents: Cents
  sale_date: Day
  notes: string
}

export interface Attachment {
  id: string
  workspace_id: string
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
  expense_id?: string | null
  bill_id?: string | null
  bill_payment_id?: string | null
  reimbursement_id?: string | null
  contribution_id?: string | null
  commitment_id?: string | null
  vendor_id?: string | null
  project_id?: string | null
  client_id?: string | null
  uploaded_by?: string | null
  created_at?: string | null
}

export interface AuditEntry {
  id: number
  workspace_id: string
  table_name: string
  record_id?: string | null
  action: string
  actor?: string | null
  at: string
  reason?: string | null
}

/** Everything the app shows, for one workspace. */
export interface Snapshot {
  workspace: Workspace
  members: Member[]
  invites: Invite[]
  categories: BudgetCategory[]
  projects: Project[]
  budgets: ProjectBudget[]
  vendors: Vendor[]
  commitments: Commitment[]
  change_orders: ChangeOrder[]
  bills: Bill[]
  expenses: Expense[]
  allocations: Allocation[]
  payments: BillPayment[]
  reimbursements: Reimbursement[]
  reimbursement_items: ReimbursementItem[]
  contributions: Contribution[]
  proceeds: SaleProceed[]
  attachments: Attachment[]
  audit: AuditEntry[]
}

export function emptySnapshot(workspace: Workspace): Snapshot {
  return {
    workspace, members: [], invites: [], categories: [], projects: [], budgets: [], vendors: [], commitments: [],
    change_orders: [], bills: [], expenses: [], allocations: [], payments: [], reimbursements: [],
    reimbursement_items: [], contributions: [], proceeds: [], attachments: [], audit: [],
  }
}

// ---------------------------------------------------------------------------
// References to records
// ---------------------------------------------------------------------------
export type EntryKind = 'expense' | 'bill' | 'payment' | 'reimbursement' | 'contribution' | 'proceeds' | 'commitment' | 'changeOrder'

export const kindLabel: Record<EntryKind, string> = {
  expense: 'Receipt', bill: 'Bill', payment: 'Payment', reimbursement: 'Reimbursement',
  contribution: 'Contribution', proceeds: 'Sale proceeds', commitment: 'Commitment', changeOrder: 'Change order',
}
export const kindTable: Record<EntryKind, string> = {
  expense: 'expenses', bill: 'bills', payment: 'bill_payments', reimbursement: 'reimbursements',
  contribution: 'contributions', proceeds: 'sale_proceeds', commitment: 'commitments', changeOrder: 'change_orders',
}
export const allKinds = Object.keys(kindLabel) as EntryKind[]

export interface EntryRef { kind: EntryKind; id: string }
export const refKey = (r: EntryRef) => `${r.kind}:${r.id}`
export const sameRef = (a: EntryRef, b: EntryRef) => a.kind === b.kind && a.id === b.id

export type Tone = 'neutral' | 'good' | 'warning' | 'bad'
export interface StatusLabel { text: string; tone: Tone }

/** One row in Activity: any financial record, flattened for display and search. */
export interface Entry {
  ref: EntryRef
  date: Day
  title: string
  subtitle: string
  amount_cents: Cents
  project_id?: string | null
  vendor_id?: string | null
  /** Partner whose money moved (payer, reimbursed partner, contributor); null = LLC. */
  partner_id?: string | null
  invoice_number: string
  category_ids: string[]
  status: StatusLabel
  created_by?: string | null
  attachment_count: number
  due_date?: Day | null
}
