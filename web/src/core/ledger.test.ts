// The spec workflows, same cases as ios/LedgerCore/Tests/LedgerCoreTests/WorkflowTests.swift,
// so the web and iPhone apps are held to the same numbers.
import { describe, it, expect, beforeEach } from 'vitest'
import { Ledger } from './ledger'
import { Rules } from './rules'
import { rows, csv } from './csv'
import { demoSnapshot } from './demoData'
import { Money, uuid } from './money'
import { parseVoice } from './parsers'
import { emptySnapshot, type Snapshot, type Expense, type Bill, type BillPayment, type Reimbursement, type Allocation } from './models'

const ws = uuid()
const a = uuid(), b = uuid(), c = uuid()
const today = '2026-11-23'
let s: Snapshot
const materials = uuid(), framing = uuid(), project = uuid(), homeDepot = uuid(), framer = uuid()
const L = () => new Ledger(s, today)

const alloc = (parent: Partial<Allocation>, category_id: string, amount_cents: number): Allocation =>
  ({ id: uuid(), workspace_id: ws, category_id, amount_cents, bill_id: null, expense_id: null, ...parent })
const expense = (o: Partial<Expense>): Expense => ({
  id: uuid(), workspace_id: ws, project_id: project, vendor_id: homeDepot, expense_date: today, description: '', total_cents: 0,
  tax_cents: 0, is_refund: false, paid_by_user_id: null, payment_method: 'card', reference: '', status: 'posted', ...o,
})
const bill = (o: Partial<Bill>): Bill => ({
  id: uuid(), workspace_id: ws, project_id: project, vendor_id: framer, commitment_id: null, invoice_number: '', bill_date: today,
  due_date: null, description: '', total_cents: 0, tax_cents: 0, status: 'posted', ...o,
})
const payment = (o: Partial<BillPayment>): BillPayment => ({
  id: uuid(), workspace_id: ws, bill_id: '', kind: 'payment', payment_date: today, amount_cents: 0, paid_by_user_id: null,
  payment_method: 'check', reference: '', status: 'posted', ...o,
})
const reimb = (amount: number): Reimbursement => ({
  id: uuid(), workspace_id: ws, partner_user_id: a, amount_cents: amount, request_date: today, paid_date: today, status: 'paid',
  payment_method: 'ach', reference: '', notes: '',
})

beforeEach(() => {
  s = emptySnapshot({ id: ws, name: 'Test LLC', require_review: false })
  s.members = [
    { workspace_id: ws, user_id: a, role: 'owner', display_name: 'A' },
    { workspace_id: ws, user_id: b, role: 'partner', display_name: 'B' },
    { workspace_id: ws, user_id: c, role: 'partner', display_name: 'C' },
  ]
  s.categories = [
    { id: materials, workspace_id: ws, name: 'Materials', sort_order: 1, archived: false },
    { id: framing, workspace_id: ws, name: 'Framing', sort_order: 2, archived: false },
  ]
  s.projects = [{ id: project, workspace_id: ws, nickname: 'Oak', address: '', project_type: 'flip', status: 'active', notes: '' }]
  s.vendors = [
    { id: homeDepot, workspace_id: ws, name: 'Home Depot', kind: 'supplier', contact_name: '', phone: '', email: '', address: '', notes: '' },
    { id: framer, workspace_id: ws, name: 'Solid Framing', kind: 'contractor', contact_name: '', phone: '', email: '', address: '', notes: '' },
  ]
  s.budgets = [{ workspace_id: ws, project_id: project, category_id: framing, amount_cents: 1_200_000 }]
})

function addReceipt350() {
  const e = expense({ expense_date: '2026-11-20', total_cents: 35_000, paid_by_user_id: a, created_by: a })
  const al = alloc({ expense_id: e.id }, materials, 35_000)
  Rules.checkExpense(e, [al])
  s.expenses.push(e)
  s.allocations.push(al)
  return e
}

describe('spec workflows', () => {
  it('1: personal receipt adds a project cost and money owed to the partner', () => {
    addReceipt350()
    expect(L().totals(project).paid_cents).toBe(35_000)
    expect(L().partnerBalance(a).owed_cents).toBe(35_000)
  })

  it('2: partial reimbursement lowers what is owed, not project costs', () => {
    const e = addReceipt350()
    const r = reimb(20_000)
    Rules.checkReimbursementPaid(r, L())
    s.reimbursements.push(r)
    s.reimbursement_items.push({ id: uuid(), workspace_id: ws, reimbursement_id: r.id, expense_id: e.id, amount_cents: 20_000 })
    expect(L().totals(project).paid_cents).toBe(35_000)
    expect(L().partnerBalance(a).owed_cents).toBe(15_000)
    expect(L().reimbursableItems(a)[0].remaining_cents).toBe(15_000)
    expect(() => Rules.checkReimbursementPaid(reimb(20_000), L())).toThrow()
  })

  it('3: commitment, invoice and partial payment are not double counted', () => {
    const commit = { id: uuid(), workspace_id: ws, project_id: project, vendor_id: framer, category_id: framing, description: 'Framing', amount_cents: 1_000_000, status: 'posted' }
    s.commitments.push(commit)
    expect(L().totals(project).projected_cents).toBe(1_000_000)
    const bl = bill({ commitment_id: commit.id, invoice_number: 'SF-101', bill_date: '2026-11-15', due_date: '2026-12-01', total_cents: 400_000 })
    const al = alloc({ bill_id: bl.id }, framing, 400_000)
    Rules.checkBill(bl, [al], L())
    s.bills.push(bl)
    s.allocations.push(al)
    expect(L().totals(project).projected_cents).toBe(1_000_000)
    const pay = payment({ bill_id: bl.id, amount_cents: 150_000 })
    Rules.checkPayment(pay, L())
    s.payments.push(pay)
    const line = L().categorySummary(project).find((x) => x.category_id === framing)!
    expect(line.paid_cents).toBe(150_000)
    expect(line.unpaid_billed_cents).toBe(250_000)
    expect(line.unbilled_committed_cents).toBe(600_000)
    expect(line.projected_cents).toBe(1_000_000)
    expect(line.remaining_cents).toBe(200_000)
    expect(L().billStatus(bl).text).toBe('Partly paid')
    expect(() => Rules.checkPayment(payment({ bill_id: bl.id, amount_cents: 300_000 }), L())).toThrow()
    const dup = bill({ invoice_number: 'sf-101', total_cents: 100 })
    expect(() => Rules.checkBill(dup, [alloc({ bill_id: dup.id }, framing, 100)], L())).toThrow()
  })

  it('6: CSV totals reconcile with the app on the demo data', () => {
    const demo = new Ledger(demoSnapshot(today), today)
    const rs = rows(demo)
    let paid = 0, unpaid = 0, unbilled = 0
    for (const p of demo.s.projects) {
      const t = demo.totals(p.id)
      paid += t.paid_cents; unpaid += t.unpaid_billed_cents; unbilled += t.unbilled_committed_cents
    }
    const sum = (xs: typeof rs, k: 'paid_cost' | 'unpaid_billed' | 'unbilled_committed' | 'out_of_pocket' | 'reimbursed' | 'contribution') => xs.reduce((x, r) => x + r[k], 0)
    expect(sum(rs, 'paid_cost')).toBe(paid)
    expect(sum(rs, 'unpaid_billed')).toBe(unpaid)
    expect(sum(rs, 'unbilled_committed')).toBe(unbilled)
    for (const p of demo.s.projects) {
      const pr = rows(demo, { project_id: p.id })
      expect(sum(pr, 'paid_cost')).toBe(demo.totals(p.id).paid_cents)
      for (const line of demo.categorySummary(p.id)) {
        const cr = pr.filter((r) => r.category_id === line.category_id)
        expect(sum(cr, 'paid_cost')).toBe(line.paid_cents)
        expect(sum(cr, 'unpaid_billed')).toBe(line.unpaid_billed_cents)
      }
    }
    for (const bal of demo.partnerBalances()) {
      const pr = rows(demo, { partner_id: bal.member.user_id })
      expect(sum(pr, 'out_of_pocket') - sum(pr, 'reimbursed')).toBe(bal.owed_cents)
      expect(sum(pr, 'contribution')).toBe(bal.contributions_cents)
    }
    const text = csv(demo)
    expect(text.startsWith('transaction_id,type,date')).toBe(true)
    expect(text).toContain('home-depot-drywall.jpg')
    expect(text).toContain('\nTOTAL,')
  })
})

describe('rules and math', () => {
  it('voided records do not count', () => {
    const e = addReceipt350()
    s.expenses[0].status = 'void'
    expect(L().totals(project).paid_cents).toBe(0)
    expect(L().partnerBalance(a).owed_cents).toBe(0)
    expect(() => Rules.checkVoid({ kind: 'expense', id: e.id }, ' ', L())).toThrow()
  })

  it('credits and refunds', () => {
    const bl = bill({ total_cents: 100_000 })
    s.bills.push(bl)
    s.allocations.push(alloc({ bill_id: bl.id }, framing, 100_000))
    const credit = payment({ bill_id: bl.id, kind: 'credit', amount_cents: 10_000 })
    Rules.checkPayment(credit, L()); s.payments.push(credit)
    const pay = payment({ bill_id: bl.id, amount_cents: 90_000, paid_by_user_id: b })
    Rules.checkPayment(pay, L()); s.payments.push(pay)
    expect(L().balance(bl.id).outstanding_cents).toBe(0)
    expect(L().totals(project).paid_cents).toBe(90_000)
    const refund = payment({ bill_id: bl.id, kind: 'refund', amount_cents: 5_000, paid_by_user_id: b })
    Rules.checkPayment(refund, L()); s.payments.push(refund)
    expect(L().totals(project).paid_cents).toBe(85_000)
    expect(L().partnerBalance(b).owed_cents).toBe(85_000)
    expect(() => Rules.checkPayment(payment({ bill_id: bl.id, kind: 'refund', amount_cents: 90_000, paid_by_user_id: b }), L())).toThrow()
  })

  it('split must match the total', () => {
    const e = expense({ total_cents: 10_000 })
    expect(() => Rules.checkExpense(e, [alloc({}, materials, 6_000), alloc({}, framing, 3_000)])).toThrow()
    expect(() => Rules.checkExpense(e, [alloc({}, materials, 6_000), alloc({}, framing, 4_000)])).not.toThrow()
  })

  it('duplicate detection', () => {
    addReceipt350()
    expect(L().possibleDuplicates(homeDepot, '2026-11-21', 35_000, '').length).toBe(1)
    expect(L().possibleDuplicates(homeDepot, '2026-11-01', 35_000, '').length).toBe(0)
  })

  it('distribute adds up', () => {
    expect(Money.distribute(100, [1, 1, 1]).reduce((x, y) => x + y)).toBe(100)
    expect(Money.distribute(-100, [1, 1, 1]).reduce((x, y) => x + y)).toBe(-100)
    expect(Money.distribute(1001, [500, 500])).toEqual([501, 500])
  })

  it('money parse and format', () => {
    expect(Money.parse('$1,234.56')).toBe(123_456)
    expect(Money.parse('1234.5')).toBe(123_450)
    expect(Money.parse('0.105')).toBe(11)
    expect(Money.parse('abc')).toBeNull()
    expect(Money.format(-123_456)).toBe('-$1,234.56')
  })

  it('demo home numbers', () => {
    const demo = new Ledger(demoSnapshot(today), today)
    const h = demo.home()
    expect(h.overdue.length).toBe(1) // ABC-1007
    expect(h.unpaid_bills_cents).toBe(450_000 + 250_000)
    const madhan = h.partner_balances.find((p) => p.member.display_name === 'Madhan')!
    expect(madhan.owed_cents).toBe(15_000)
  })

  it('voice parser', () => {
    const demo = new Ledger(demoSnapshot(today), today)
    const sg = parseVoice('Spent $350 at Home Depot on drywall for Oak street with my card yesterday', demo.s.projects, demo.s.vendors, demo.activeCategories, today)
    expect(sg.total_cents).toBe(35_000)
    expect(sg.vendor_name).toBe('Home Depot')
    expect(sg.paid_by_me).toBe(true)
    expect(sg.date).toBe('2026-11-22')
    expect(demo.project(sg.project_id)?.nickname).toBe('Oak St Flip')
    expect(demo.category(sg.category_id)?.name).toBe('Materials')
  })
})
