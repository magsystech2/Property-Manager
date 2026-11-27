// Correcting posted money. Expenses and bills are never overwritten: a correction voids the original
// (with a reason that says what changed) and posts a fixed copy, so the history shows both.
import { Money, Days, type Cents } from './money'
import type { Allocation, Bill, Expense, Snapshot } from './models'

export type CorrectionPatch = Partial<Pick<Expense, 'expense_date' | 'description' | 'total_cents' | 'vendor_id' | 'project_id' | 'paid_by_user_id'>>
  & Partial<Pick<Bill, 'bill_date' | 'due_date' | 'invoice_number'>>
  & { category_id?: string }

type Rec = { kind: 'expense'; row: Expense } | { kind: 'bill'; row: Bill }

/** Why this record can't be corrected in place (null = it can). */
export function correctionBlocker(s: Snapshot, r: Rec): string | null {
  if (r.row.status === 'void') return 'This record is void.'
  if (r.kind === 'bill') {
    if (s.payments.some((p) => p.bill_id === r.row.id && p.status !== 'void')) return 'This bill has payments or credits recorded. Void those first, or void the bill and enter it again.'
  } else {
    const inReimb = s.reimbursement_items.some((i) => i.expense_id === r.row.id
      && s.reimbursements.some((x) => x.id === i.reimbursement_id && x.status !== 'void'))
    if (inReimb) return 'This receipt is part of a reimbursement. Void the reimbursement first.'
  }
  return null
}

/** Spread a new total over the existing category split, keeping the proportions (the remainder goes to the largest line). */
export function rescale(allocs: Pick<Allocation, 'category_id' | 'amount_cents'>[], oldTotal: Cents, newTotal: Cents) {
  if (allocs.length === 0) return []
  if (allocs.length === 1 || oldTotal === 0) return [{ category_id: allocs[0].category_id, amount_cents: newTotal }]
  const out = allocs.map((a) => ({ category_id: a.category_id, amount_cents: Math.floor((a.amount_cents * newTotal) / oldTotal) }))
  const diff = newTotal - out.reduce((x, a) => x + a.amount_cents, 0)
  const big = out.reduce((bi, a, i) => (a.amount_cents > out[bi].amount_cents ? i : bi), 0)
  out[big].amount_cents += diff
  return out
}

export interface Correction<T> { row: T; allocations: { category_id: string; amount_cents: Cents }[]; summary: string }

export function buildCorrection<T extends Expense | Bill>(old: T, allocs: Allocation[], patch: CorrectionPatch, newId: string,
  names: { vendor: (id: string) => string; project: (id: string) => string; payer: (id?: string | null) => string; category: (id: string) => string }): Correction<T> {
  const isExpense = 'expense_date' in old
  const changes: string[] = []
  const row = { ...old, id: newId, client_id: newId, status: 'posted', created_by: null, created_at: null, voided_by: null, voided_at: null, void_reason: null } as T
  const r = row as unknown as Record<string, unknown>
  const o = old as unknown as Record<string, unknown>
  const set = (k: string, label: string, show: (v: unknown) => string) => {
    if (!(k in patch)) return
    const v = (patch as Record<string, unknown>)[k]
    if ((v ?? null) === (o[k] ?? null)) return
    changes.push(`${label} ${show(o[k])} → ${show(v)}`)
    r[k] = v
  }
  const day = (v: unknown) => (v ? Days.display(String(v)) : 'none')
  const txt = (v: unknown) => `“${String(v ?? '')}”`
  set('total_cents', 'amount', (v) => Money.format(Number(v)))
  set(isExpense ? 'expense_date' : 'bill_date', 'date', day)
  set('due_date', 'due date', day)
  set('description', 'description', txt)
  set('invoice_number', 'invoice #', txt)
  set('vendor_id', 'vendor', (v) => names.vendor(String(v)))
  set('project_id', 'project', (v) => names.project(String(v)))
  if (isExpense) set('paid_by_user_id', 'paid by', (v) => names.payer(v as string | null))
  if (row.tax_cents > row.total_cents) row.tax_cents = row.total_cents
  let allocations = rescale(allocs, old.total_cents, row.total_cents)
  if (patch.category_id) {
    if (allocs.length > 1) throw new Error('This one is split across categories. Use Void and enter it again to change the split.')
    const was = allocs[0]?.category_id
    if (patch.category_id !== was) {
      changes.push(`category ${was ? names.category(was) : 'none'} → ${names.category(patch.category_id)}`)
      allocations = [{ category_id: patch.category_id, amount_cents: row.total_cents }]
    }
  }
  return { row, allocations, summary: changes.join('; ') }
}
