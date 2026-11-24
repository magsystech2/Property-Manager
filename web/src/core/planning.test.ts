import { describe, expect, it } from 'vitest'
import { Ledger } from './ledger'
import { demoSnapshot, DemoIds } from './demoData'
import { Days } from './money'
import { cashPlan, fingerprint, forecast, missingReceipts, monthsUntil, parseStatement, suggestMatches, suggestFromText, vendorFromDescription, weeklyReview } from './planning'

const today = '2026-11-24'
const fresh = () => new Ledger(demoSnapshot(today), today)

describe('statement import', () => {
  it('reads a card export where charges are negative, and finds the header under account info', () => {
    const csv = 'Account: Chase Ink ...4421\n\nTransaction Date,Post Date,Description,Category,Type,Amount,Memo\n11/20/2026,11/21/2026,HOME DEPOT #6512,Home,Sale,-87.34,\n11/20/2026,11/21/2026,SHELL OIL,Gas,Sale,-40.00,\n11/21/2026,11/22/2026,Payment Thank You,,Payment,500.00,\n11/22/2026,11/22/2026,LOWES #1187,Home,Return,12.00,'
    const p = parseStatement(csv)
    expect(p.error).toBeUndefined()
    expect(p.chargesNegative).toBe(true)
    expect(p.lines.map((l) => l.amount_cents)).toEqual([8734, 4000, -50000, -1200])
    expect(p.lines[0]).toMatchObject({ posted_date: '2026-11-20', description: 'HOME DEPOT #6512' })
  })
  it('reads separate Debit and Credit columns', () => {
    const p = parseStatement('Date,Description,Debit,Credit\n2026-11-20,CITY WATER,88.20,\n2026-11-21,DEPOSIT,,"1,000.00"\nbad,row,1,')
    expect(p.lines.map((l) => l.amount_cents)).toEqual([8820, -100000])
    expect(p.skipped).toHaveLength(1)
  })
  it('fingerprints repeat rows differently within a file but the same across imports', () => {
    const l = { posted_date: '2026-11-20' as const, description: 'Home  Depot', amount_cents: 500 }
    expect(fingerprint('Chase 4421', l, 1)).toBe(fingerprint('chase 4421', { ...l, description: 'HOME DEPOT' }, 1))
    expect(fingerprint('Chase 4421', l, 1)).not.toBe(fingerprint('Chase 4421', l, 2))
  })
  it('guesses vendors from noisy descriptions', () => {
    const l = fresh()
    expect(vendorFromDescription('THE HOME DEPOT #6512 ATLANTA GA', l).name).toBe('Home Depot')
    expect(vendorFromDescription('SQ *JOES HARDWARE 4421', l)).toEqual({ vendor_id: null, name: 'Joes Hardware' })
  })
})

describe('matching and missing receipts', () => {
  it('suggests the receipt with the same amount, nearby date and the card owner as payer', () => {
    const l = fresh()
    const lowes = l.s.statement_lines.find((x) => x.description.startsWith('LOWE'))!
    const m = suggestMatches(l, lowes)
    expect(m).toHaveLength(1)
    expect(m[0].entry.title).toBe("Lowe's")
    expect(m[0].why).toContain('vendor name matches')
    const water = l.s.statement_lines.find((x) => x.description.startsWith('CITY WATER'))!
    expect(suggestMatches(l, water)[0].entry.title).toBe('City Water')
    const hd = l.s.statement_lines.find((x) => x.amount_cents === 8_734)!
    expect(suggestMatches(l, hd)).toEqual([])
  })
  it('a matched record is not suggested again; split matches count toward the line', () => {
    const s = demoSnapshot(today)
    const l0 = new Ledger(s, today)
    const lowes = s.statement_lines.find((x) => x.description.startsWith('LOWE'))!
    const exp = suggestMatches(l0, lowes)[0]
    s.statement_matches.push({ id: 'm1', workspace_id: s.workspace.id, statement_line_id: lowes.id, expense_id: exp.ref.id })
    lowes.status = 'matched'
    const l = new Ledger(s, today)
    expect(suggestMatches(l, lowes)).toEqual([])
  })
  it('lists receipts without documents and charges without receipts', () => {
    const l = fresh()
    const m = missingReceipts(l)
    expect(m.filter((x) => x.kind === 'unmatched_charge')).toHaveLength(4) // every demo line is money out
    expect(m.some((x) => x.kind === 'no_document' && x.title === "Lowe's")).toBe(true)
    expect(m.some((x) => x.kind === 'no_document' && x.title === 'Home Depot' && x.amount_cents === 35_000)).toBe(false) // has a photo
    expect(m.find((x) => x.amount_cents === 8_734)!.owner).toBe(DemoIds.partnerA)
  })
})

describe('weekly review and cash', () => {
  it('collects bills due, payouts, inbox and statement work, with claims', () => {
    const s = demoSnapshot(today)
    const l0 = new Ledger(s, today)
    const r0 = weeklyReview(l0)
    expect(r0.billsDue.map((b) => b.title)).toContain('ABC Plumbing') // overdue
    expect(r0.inbox).toHaveLength(1)
    expect(r0.unmatched).toHaveLength(4)
    s.claims.push({ id: 'c1', workspace_id: s.workspace.id, item_kind: 'bill', item_id: r0.billsDue[0].id, claimed_by: DemoIds.partnerB })
    expect(weeklyReview(new Ledger(s, today)).billsDue[0].claim?.claimed_by).toBe(DemoIds.partnerB)
  })
  it('adds up the next 30 days, caps draws at what is unbilled, and flags the shortfall day', () => {
    const l = fresh()
    const p = cashPlan(l)
    const owedBills = l.s.bills.filter((b) => b.status === 'posted').reduce((a, b) => a + Math.max(l.balance(b.id).outstanding_cents, 0), 0)
    const draws = p.events.filter((e) => e.kind === 'draw').reduce((a, e) => a + e.amount_cents, 0)
    const reimb = p.events.filter((e) => e.kind === 'reimbursement').reduce((a, e) => a + e.amount_cents, 0)
    expect(draws).toBe(600_000) // framing has $6,000 not billed; two $3,000 draws fit
    expect(p.total_cents).toBe(owedBills + draws + reimb)
    expect(p.cash_on_hand_cents).toBe(1_200_000)
    expect(p.shortfall).toBeDefined()
    expect(p.days[p.days.length - 1].balance_cents).toBe(1_200_000 - p.total_cents)
  })
})

describe('profit forecast', () => {
  it('sale minus selling, projected spend, holding and interest; a delay and a lower price cut profit', () => {
    const l = fresh()
    const oak = l.s.projects[0]
    const base = forecast(l, oak)
    const t = l.totals(oak.id)
    expect(base.sale_cents).toBe(32_900_000)
    expect(base.selling_costs_cents).toBe(1_974_000)
    expect(base.months_left).toBe(monthsUntil(today, oak.target_sale_date))
    expect(base.profit_cents).toBe(32_900_000 - 1_974_000 - t.projected_cents - base.budget_gap_cents - base.holding_cents - base.interest_cents)
    const late = forecast(l, oak, { delayMonths: 1 })
    expect(base.profit_cents - late.profit_cents).toBe(late.holding_cents - base.holding_cents + late.interest_cents - base.interest_cents)
    expect(late.holding_cents - base.holding_cents).toBe(110_000)
    expect(late.interest_cents - base.interest_cents).toBe(137_500) // $150,000 at 11% for a month
    const cheap = forecast(l, oak, { salePct: 95 })
    expect(base.profit_cents - cheap.profit_cents).toBe(1_645_000 - 98_700)
  })
  it('says what is missing', () => {
    const l = fresh()
    expect(forecast(l, { ...l.s.projects[0], expected_sale_cents: null, target_sale_date: null }).missing).toEqual(['expected sale price', 'target sale date'])
    expect(monthsUntil(today, Days.adding(-5, today))).toBe(0)
  })
})

describe('inbox suggestions', () => {
  it('reads vendor, amount, date and project from the note or file name', () => {
    const l = fresh()
    expect(suggestFromText('ABC Plumbing invoice 1012 oak st 1,850.00 11/23/2026.pdf', l)).toEqual({
      suggested_vendor: 'ABC Plumbing', suggested_total_cents: 185_000, suggested_date: '2026-11-23', suggested_project_id: l.s.projects[0].id, suggested_kind: 'bill',
    })
    expect(suggestFromText('IMG_2041.jpg', l).suggested_total_cents).toBeNull()
  })
})
