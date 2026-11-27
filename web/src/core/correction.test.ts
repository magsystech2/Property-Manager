import { describe, expect, it } from 'vitest'
import { buildCorrection, correctionBlocker, rescale } from './correction'
import { emptySnapshot, type Allocation, type Bill, type Expense } from './models'

const names = { vendor: (id: string) => id.toUpperCase(), project: (id: string) => id, payer: (id?: string | null) => id ?? 'LLC account', category: (id: string) => `cat-${id}` }
const exp: Expense = { id: 'e1', workspace_id: 'w', status: 'posted', project_id: 'p1', vendor_id: 'v1', expense_date: '2026-11-01', description: 'Tile',
  total_cents: 120000, tax_cents: 5000, is_refund: false, paid_by_user_id: null, payment_method: 'card', reference: '', notes: 'n' }
const alloc = (category_id: string, amount_cents: number): Allocation => ({ id: category_id, workspace_id: 'w', expense_id: 'e1', category_id, amount_cents })

describe('rescale', () => {
  it('keeps proportions and sums exactly', () => {
    const out = rescale([alloc('a', 2000), alloc('b', 1000)], 3000, 1001)
    expect(out.reduce((x, a) => x + a.amount_cents, 0)).toBe(1001)
    expect(out[0].amount_cents).toBe(668)
  })
  it('single line takes the whole total', () => expect(rescale([alloc('a', 5)], 5, 9)).toEqual([{ category_id: 'a', amount_cents: 9 }]))
})

describe('buildCorrection', () => {
  it('copies with a new id, applies the change and says what changed', () => {
    const c = buildCorrection(exp, [alloc('a', 120000)], { total_cents: 125000, vendor_id: 'v2' }, 'e2', names)
    expect(c.row.id).toBe('e2')
    expect(c.row.status).toBe('posted')
    expect(c.row.total_cents).toBe(125000)
    expect(c.allocations).toEqual([{ category_id: 'a', amount_cents: 125000 }])
    expect(c.summary).toBe('amount $1,200.00 → $1,250.00; vendor V1 → V2')
  })
  it('no change gives an empty summary', () => {
    expect(buildCorrection(exp, [alloc('a', 120000)], { total_cents: 120000, description: 'Tile' }, 'e2', names).summary).toBe('')
  })
  it('lowers tax when the total drops below it', () => {
    expect(buildCorrection(exp, [alloc('a', 120000)], { total_cents: 3000 }, 'e2', names).row.tax_cents).toBe(3000)
  })
  it('changes the category only for a single-category record', () => {
    expect(buildCorrection(exp, [alloc('a', 120000)], { category_id: 'b' }, 'e2', names).allocations).toEqual([{ category_id: 'b', amount_cents: 120000 }])
    expect(() => buildCorrection(exp, [alloc('a', 60000), alloc('b', 60000)], { category_id: 'b' }, 'e2', names)).toThrow()
  })
})

describe('correctionBlocker', () => {
  it('blocks a bill with payments and a receipt in a live reimbursement', () => {
    const s = emptySnapshot({ id: 'w' } as never)
    const bill = { id: 'b1', status: 'posted' } as Bill
    expect(correctionBlocker(s, { kind: 'bill', row: bill })).toBeNull()
    s.payments.push({ id: 'x', bill_id: 'b1', status: 'posted' } as never)
    expect(correctionBlocker(s, { kind: 'bill', row: bill })).toMatch(/payments/)
    s.reimbursements.push({ id: 'r', status: 'paid' } as never)
    s.reimbursement_items.push({ id: 'i', reimbursement_id: 'r', expense_id: 'e1' } as never)
    expect(correctionBlocker(s, { kind: 'expense', row: exp })).toMatch(/reimbursement/)
  })
})
