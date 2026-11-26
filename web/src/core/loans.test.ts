import { describe, expect, it } from 'vitest'
import { loanStatus } from './loans'
import type { PartnerLoan, PartnerLoanPayment } from './models'

const loan: PartnerLoan = { id: 'l1', workspace_id: 'w', partner_user_id: 'k', lender: 'Friends', principal_cents: 5_000_000, rate_bps: 1000, start_date: '2025-01-01', status: 'open', notes: '' }
const pay = (paid_on: string, amount_cents: number, kind: 'interest' | 'principal'): PartnerLoanPayment => ({ id: paid_on + kind, workspace_id: 'w', loan_id: 'l1', paid_on, amount_cents, kind, note: '' })

describe('loanStatus', () => {
  it('accrues simple interest for a year', () => {
    const s = loanStatus(loan, [], '2026-01-01')
    expect(s.interest_accrued_cents).toBe(500_000)
    expect(s.monthly_interest_cents).toBe(41_667)
    expect(s.owed_now_cents).toBe(5_500_000)
  })
  it('subtracts interest paid and lowers the balance after a principal repayment', () => {
    const s = loanStatus(loan, [pay('2025-07-02', 200_000, 'interest'), pay('2025-07-02', 2_500_000, 'principal')], '2026-01-01')
    // 182 days on $50,000 + 183 days on $25,000 at 10%
    expect(s.interest_accrued_cents).toBe(Math.round(5_000_000 * 0.1 * 182 / 365 + 2_500_000 * 0.1 * 183 / 365))
    expect(s.interest_paid_cents).toBe(200_000)
    expect(s.principal_left_cents).toBe(2_500_000)
  })
  it('a closed loan owes nothing', () => {
    const s = loanStatus({ ...loan, status: 'closed' }, [pay('2025-06-01', 5_000_000, 'principal')], '2026-01-01')
    expect(s.owed_now_cents).toBe(0)
    expect(s.principal_repaid_cents).toBe(5_000_000)
  })
})
