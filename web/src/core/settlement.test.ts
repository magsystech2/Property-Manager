import { describe, expect, it } from 'vitest'
import { Ledger } from './ledger'
import { demoSnapshot, DemoIds } from './demoData'
import { advance, allocate, basisGroup, costBasis, equalShares, poolSummary, profitShares, settlement } from './settlement'

const today = '2026-11-24'
const snap = () => demoSnapshot(today)
const oakId = (s: ReturnType<typeof snap>) => s.projects.find((p) => p.nickname === 'Oak St Flip')!.id

describe('profit split', () => {
  it('allocates cents exactly, including losses', () => {
    expect(allocate(100, [3334, 3333, 3333])).toEqual([34, 33, 33])
    expect(allocate(-100, [5000, 5000])).toEqual([-50, -50])
    expect(allocate(10, [0, 0])).toEqual([0, 0])
    expect(allocate(1_000_001, [5000, 2500, 2500]).reduce((a, b) => a + b, 0)).toBe(1_000_001)
  })
  it('falls back from project override to the LLC default to an equal split', () => {
    const s = snap()
    const oak = oakId(s)
    let l = new Ledger(s, today)
    expect(profitShares(l, oak).source).toBe('equal')
    expect(profitShares(l, oak).shares.reduce((a, x) => a + x.share_bps, 0)).toBe(10000)
    s.profit_shares = [
      { id: '1', workspace_id: s.workspace.id, project_id: null, partner_user_id: DemoIds.partnerA, share_bps: 5000 },
      { id: '2', workspace_id: s.workspace.id, project_id: null, partner_user_id: DemoIds.partnerB, share_bps: 5000 },
    ]
    l = new Ledger(s, today)
    expect(profitShares(l, oak).source).toBe('default')
    s.profit_shares.push({ id: '3', workspace_id: s.workspace.id, project_id: oak, partner_user_id: DemoIds.partnerC, share_bps: 10000 })
    l = new Ledger(s, today)
    expect(profitShares(l, oak)).toEqual({ source: 'project', shares: [{ partner_user_id: DemoIds.partnerC, share_bps: 10000 }] })
  })
  it('gives equal shares that add up to 100%', () => {
    const ms = snap().members
    expect(equalShares(ms).map((x) => x.share_bps).sort()).toEqual([3333, 3333, 3334])
  })
})

describe('cost basis and settlement', () => {
  it('groups categories into purchase, closing, rehab and holding', () => {
    expect(basisGroup('Acquisition')).toBe('purchase')
    expect(basisGroup('Closing Costs')).toBe('closing')
    expect(basisGroup('Utilities')).toBe('holding')
    expect(basisGroup('Plumbing')).toBe('rehab')
    const s = snap()
    const b = costBasis(new Ledger(s, today), oakId(s))
    expect(b.spent.purchase).toBe(18_500_000)
    expect(b.spent.closing).toBe(612_500)
    expect(b.projected_total).toBeGreaterThanOrEqual(b.spent_total)
  })
  it('returns capital first, then splits profit, minus distributions already paid', () => {
    const s = snap()
    const oak = oakId(s)
    const l0 = new Ledger(s, today)
    const costs = l0.totals(oak).projected_cents
    s.proceeds.push({ id: 'sale', workspace_id: s.workspace.id, project_id: oak, amount_cents: costs + 3_000_000, sale_date: today, notes: '',
      status: 'posted', gross_price_cents: costs + 3_200_000, selling_costs_cents: 200_000, loan_payoff_cents: 0 })
    s.distributions.push({ id: 'd1', workspace_id: s.workspace.id, partner_user_id: DemoIds.partnerA, project_id: oak, amount_cents: 500_000,
      distribution_date: today, payment_method: 'wire', reference: '', notes: '', status: 'posted' })
    const st = settlement(new Ledger(s, today), oak)
    expect(st.sold).toBe(true)
    expect(st.profit_cents).toBe(3_000_000)
    expect(st.partners.reduce((a, p) => a + p.profit_share_cents, 0)).toBe(3_000_000)
    const a = st.partners.find((p) => p.member.user_id === DemoIds.partnerA)!
    expect(a.due_cents).toBe(a.capital_cents + a.profit_share_cents)
    expect(a.remaining_cents).toBe(a.due_cents - 500_000)
    expect(a.capital_cents).toBe(8_000_000) // LLC-wide capital comes back at the first sale
    expect(st.returns_llc_capital).toBe(true)
    const pine = s.projects.find((p) => p.nickname !== 'Oak St Flip')!.id
    expect(settlement(new Ledger(s, today), pine).returns_llc_capital).toBe(false)
  })
})

describe('repeats', () => {
  it('keeps the day of the month and clamps short months', () => {
    expect(advance('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(advance('2026-11-15', 'quarterly')).toBe('2027-02-15')
    expect(advance('2026-12-01', 'yearly')).toBe('2027-12-01')
    expect(advance('2026-12-01', 'none')).toBe('2026-12-01')
  })
})

describe('pooled money', () => {
  it('compares each partner’s money in with an equal share of everything spent', () => {
    const s = snap()
    const oak = oakId(s)
    const [a, b, c] = [DemoIds.partnerA, DemoIds.partnerB, DemoIds.partnerC]
    s.expenses = []; s.bills = []; s.payments = []; s.allocations = []; s.reimbursements = []; s.reimbursement_items = []
    s.contributions = []; s.proceeds = []; s.distributions = []; s.profit_shares = []
    const base = { workspace_id: s.workspace.id, status: 'posted', payment_method: 'ach', reference: '', notes: '' }
    const exp = (id: string, cents: number, by: string | null, refund = false) => s.expenses.push({ ...base, id, project_id: oak, vendor_id: s.vendors[0].id,
      expense_date: today, description: '', total_cents: cents, tax_cents: 0, is_refund: refund, paid_by_user_id: by })
    s.contributions.push({ ...base, id: 'c1', partner_user_id: a, project_id: oak, amount_cents: 60_000, contribution_date: today })
    s.contributions.push({ ...base, id: 'c2', partner_user_id: b, project_id: null, amount_cents: 30_000, contribution_date: today })
    exp('e1', 100_000, null)          // from the pot
    exp('e2', 10_000, null, true)     // refund back into the pot
    exp('e3', 30_000, c)              // c paid personally
    exp('e4', 5_000, b)
    exp('e5', 999_999, a); s.expenses[s.expenses.length - 1].status = 'void'
    s.reimbursements.push({ ...base, id: 'r1', partner_user_id: c, amount_cents: 10_000, request_date: today, status: 'paid' })
    const sum = poolSummary(new Ledger(s, today))
    expect(sum.total_spent_cents).toBe(125_000)
    expect(sum.paid_by_llc_cents).toBe(90_000)
    expect(sum.paid_personally_cents).toBe(35_000)
    expect(sum.pot_balance_cents).toBe(60_000 + 30_000 - 90_000 - 10_000)
    expect(sum.share_source).toBe('equal')
    const by = Object.fromEntries(sum.partners.map((p) => [p.member.user_id, p]))
    expect(by[a].put_in_cents).toBe(60_000)
    expect(by[b].put_in_cents).toBe(35_000)
    expect(by[c].put_in_cents).toBe(20_000)
    expect(sum.partners.map((p) => p.share_of_spending_cents).sort()).toEqual([41_666, 41_667, 41_667])
    // Over/under adds up to what's left in the pot: money in that wasn't spent (or, if negative, spending nobody funded).
    expect(sum.partners.reduce((x, p) => x + p.over_share_cents, 0)).toBe(sum.pot_balance_cents)
    // Per project: LLC-wide contributions and reimbursements are left out.
    const proj = poolSummary(new Ledger(s, today), oak)
    expect(proj.contributed_cents).toBe(60_000)
    expect(proj.reimbursed_cents).toBe(0)
  })
})
