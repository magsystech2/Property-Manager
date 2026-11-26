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
  /** Set when an owner removed this partner's access. They stay in the books (names, balances) but can't see the LLC. */
  access_revoked_at?: string | null
}

export const hasAccess = (m: Member) => !m.access_revoked_at

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
  // Profit forecast inputs (all optional)
  expected_sale_cents?: Cents | null
  selling_cost_bps?: number | null      // 600 = 6%
  monthly_holding_cents?: Cents | null  // taxes, insurance, utilities per month
  loan_balance_cents?: Cents | null
  loan_rate_bps?: number | null         // 1100 = 11% a year
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
  /** Free-text note; doesn't affect amounts and can be edited after posting. */
  notes?: string
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
  /** Free-text note; doesn't affect amounts and can be edited after posting. */
  notes?: string
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
  /** Net to the LLC: sale price minus selling costs. */
  amount_cents: Cents
  sale_date: Day
  notes: string
  gross_price_cents?: Cents | null
  selling_costs_cents?: Cents | null
  /** Paid to the lender at closing. Not a cost; shows the cash left to distribute. */
  loan_payoff_cents?: Cents | null
}

/** A partner's share of profit, in basis points (2500 = 25%). project_id null = the LLC's default split. */
export interface ProfitShare { id: string; workspace_id: string; project_id?: string | null; partner_user_id: string; share_bps: number }

/** Money the LLC paid out to a partner from a project: return of capital and profit. */
export interface Distribution extends RecordBase {
  partner_user_id: string
  project_id?: string | null
  amount_cents: Cents
  distribution_date: Day
  payment_method: string
  reference: string
  notes: string
}

/** Lightweight materials tracking: bought, used, returned; the rest is leftover. */
export interface Material {
  id: string
  workspace_id: string
  project_id: string
  name: string
  unit: string
  qty_bought: number
  qty_used: number
  qty_returned: number
  unit_cost_cents: Cents
  expense_id?: string | null
  location: string
  notes: string
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}
export const leftover = (m: Material) => Math.round((m.qty_bought - m.qty_used - m.qty_returned) * 100) / 100

export type Repeat = 'none' | 'monthly' | 'quarterly' | 'yearly'
export const RepeatOptions: [Repeat, string][] = [['none', "Doesn't repeat"], ['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year']]
/** A saved receipt or bill to add again, optionally repeating (insurance, utilities, dumpster). */
export interface EntryTemplate {
  id: string
  workspace_id: string
  name: string
  kind: 'receipt' | 'bill'
  project_id?: string | null
  vendor_id?: string | null
  category_id?: string | null
  amount_cents?: Cents | null
  paid_by_user_id?: string | null
  payment_method: string
  description: string
  repeat: Repeat | string
  next_due?: Day | null
  active: boolean
  created_by?: string | null
  created_at?: string | null
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
/** A receipt photo or invoice PDF waiting in the shared inbox until a partner files it as a receipt or bill. */
export interface InboxItem {
  id: string
  workspace_id: string
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
  note: string
  source: 'upload' | 'share' | 'email' | string
  suggested_kind?: 'receipt' | 'bill' | null
  suggested_project_id?: string | null
  suggested_vendor?: string | null
  suggested_date?: Day | null
  suggested_total_cents?: Cents | null
  status: 'new' | 'filed' | 'dismissed' | string
  filed_expense_id?: string | null
  filed_bill_id?: string | null
  dismiss_reason?: string | null
  handled_by?: string | null
  handled_at?: string | null
  client_id?: string | null
  created_by?: string | null
  created_at?: string | null
}

/** One row of an imported card or bank statement. amount_cents > 0 is money out. */
export interface StatementLine {
  id: string
  workspace_id: string
  account: string
  account_owner?: string | null  // partner's personal card; null = LLC account
  posted_date: Day
  description: string
  amount_cents: Cents
  fingerprint: string
  import_batch: string
  status: 'unmatched' | 'matched' | 'ignored' | string
  ignore_reason?: string | null
  handled_by?: string | null
  handled_at?: string | null
  created_by?: string | null
  created_at?: string | null
}

export interface StatementMatch {
  id: string
  workspace_id: string
  statement_line_id: string
  expense_id?: string | null
  bill_payment_id?: string | null
  created_by?: string | null
  created_at?: string | null
}

export type ClaimKind = 'bill' | 'reimbursement' | 'change_order' | 'inbox_item' | 'statement_line' | 'expense'
export interface Claim { id: string; workspace_id: string; item_kind: ClaimKind | string; item_id: string; claimed_by: string; claimed_at?: string | null }

export interface ScheduledDraw {
  id: string
  workspace_id: string
  commitment_id: string
  due_date: Day
  amount_cents: Cents
  description: string
  created_by?: string | null
  created_at?: string | null
}

export interface CashBalance { id: string; workspace_id: string; as_of: Day; amount_cents: Cents; note: string; created_by?: string | null; created_at?: string | null }

/** A problem a partner flagged with a record or the app, collected in one list until someone resolves it. */
export type IssueCategory = 'wrong_amount' | 'duplicate' | 'wrong_details' | 'missing' | 'app_error' | 'idea' | 'other'
export const issueCategoryLabel: Record<IssueCategory, string> = {
  wrong_amount: 'Wrong amount', duplicate: 'Duplicate', wrong_details: 'Wrong property, vendor or category', missing: 'Something missing',
  app_error: 'Error or something didn’t work', idea: 'Idea or request', other: 'Other',
}
export interface IssueReport {
  id: string
  workspace_id: string
  category: IssueCategory | string
  note: string
  record_kind?: EntryKind | null
  record_id?: string | null
  page: string
  error_text: string
  user_agent: string
  screenshot_path?: string | null
  screenshot_name?: string | null
  status: 'open' | 'resolved' | string
  resolution?: string | null
  resolved_by?: string | null
  resolved_at?: string | null
  client_id?: string | null
  created_by?: string | null
  created_at?: string | null
}

/** A loan a partner took personally (from a friend, family or a bank) to fund their part. Reference only: the money is
 * already in the books as that partner's contribution or personal payment, so loans never change balances. */
export interface PartnerLoan {
  id: string
  workspace_id: string
  partner_user_id: string
  project_id?: string | null
  lender: string
  principal_cents: Cents
  /** Simple interest a year, in basis points (1000 = 10%). */
  rate_bps: number
  start_date: Day
  status: 'open' | 'closed' | string
  notes: string
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}
export interface PartnerLoanPayment {
  id: string
  workspace_id: string
  loan_id: string
  paid_on: Day
  amount_cents: Cents
  kind: 'interest' | 'principal' | string
  note: string
  created_by?: string | null
  created_at?: string | null
}

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
  inbox_items: InboxItem[]
  statement_lines: StatementLine[]
  statement_matches: StatementMatch[]
  claims: Claim[]
  scheduled_draws: ScheduledDraw[]
  cash_balances: CashBalance[]
  profit_shares: ProfitShare[]
  distributions: Distribution[]
  materials: Material[]
  entry_templates: EntryTemplate[]
  issue_reports: IssueReport[]
  partner_loans: PartnerLoan[]
  partner_loan_payments: PartnerLoanPayment[]
}

export function emptySnapshot(workspace: Workspace): Snapshot {
  return {
    workspace, members: [], invites: [], categories: [], projects: [], budgets: [], vendors: [], commitments: [],
    change_orders: [], bills: [], expenses: [], allocations: [], payments: [], reimbursements: [],
    reimbursement_items: [], contributions: [], proceeds: [], attachments: [], audit: [],
    inbox_items: [], statement_lines: [], statement_matches: [], claims: [], scheduled_draws: [], cash_balances: [],
    profit_shares: [], distributions: [], materials: [], entry_templates: [], issue_reports: [], partner_loans: [], partner_loan_payments: [],
  }
}

// ---------------------------------------------------------------------------
// References to records
// ---------------------------------------------------------------------------
export type EntryKind = 'expense' | 'bill' | 'payment' | 'reimbursement' | 'contribution' | 'proceeds' | 'distribution' | 'commitment' | 'changeOrder'

export const kindLabel: Record<EntryKind, string> = {
  expense: 'Receipt', bill: 'Bill', payment: 'Payment', reimbursement: 'Reimbursement',
  contribution: 'Contribution', proceeds: 'Sale proceeds', distribution: 'Distribution', commitment: 'Commitment', changeOrder: 'Change order',
}
export const kindTable: Record<EntryKind, string> = {
  expense: 'expenses', bill: 'bills', payment: 'bill_payments', reimbursement: 'reimbursements',
  contribution: 'contributions', proceeds: 'sale_proceeds', distribution: 'distributions', commitment: 'commitments', changeOrder: 'change_orders',
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
  /** Description or notes, for search. */
  notes?: string
}
