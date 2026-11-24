import { describe, expect, it } from 'vitest'
import { Ledger } from './ledger'
import { demoSnapshot, DemoIds } from './demoData'
import { advance, allocate, basisGroup, costBasis, equalShares, profitShares, settlement } from './settlement'

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
