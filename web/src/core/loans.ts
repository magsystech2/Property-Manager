// Borrowed money: personal loans partners took to fund their part. Reference only; nothing here changes balances.
import { Days, type Cents, type Day } from './money'
import type { PartnerLoan, PartnerLoanPayment } from './models'

export interface LoanStatus {
  loan: PartnerLoan
  payments: PartnerLoanPayment[]
  /** Principal paid back so far. */
  principal_repaid_cents: Cents
  principal_left_cents: Cents
  /** Simple interest built up from the start date to today, on the principal still out at each point. */
  interest_accrued_cents: Cents
  interest_paid_cents: Cents
  /** Interest built up but not paid yet (never below zero). */
  interest_due_cents: Cents
  /** Interest for one month on what's still borrowed now. */
  monthly_interest_cents: Cents
  /** Principal left + interest due. */
  owed_now_cents: Cents
}

/** Simple yearly interest, accrued day by day; principal repayments lower the balance from the day they're paid. */
export function loanStatus(loan: PartnerLoan, all: PartnerLoanPayment[], today: Day = Days.today): LoanStatus {
  const payments = all.filter((p) => p.loan_id === loan.id).sort((a, b) => a.paid_on.localeCompare(b.paid_on))
  const principalPaid = payments.filter((p) => p.kind === 'principal')
  const interestPaid = payments.filter((p) => p.kind !== 'principal').reduce((a, p) => a + p.amount_cents, 0)
  const rate = loan.rate_bps / 10000
  let balance = loan.principal_cents
  let from = loan.start_date
  let accrued = 0
  const until = loan.status === 'closed' && principalPaid.length ? principalPaid[principalPaid.length - 1].paid_on : today
  for (const p of principalPaid) {
    if (p.paid_on > until) break
    if (p.paid_on > from) { accrued += balance * rate * Days.daysBetween(from, p.paid_on) / 365; from = p.paid_on }
    balance = Math.max(balance - p.amount_cents, 0)
  }
  if (until > from) accrued += balance * rate * Days.daysBetween(from, until) / 365
  const repaid = loan.principal_cents - balance
  const accruedC = Math.round(accrued)
  const due = Math.max(accruedC - interestPaid, 0)
  const left = loan.status === 'closed' ? 0 : balance
  return {
    loan, payments, principal_repaid_cents: repaid, principal_left_cents: left, interest_accrued_cents: accruedC, interest_paid_cents: interestPaid,
    interest_due_cents: loan.status === 'closed' ? 0 : due, monthly_interest_cents: loan.status === 'closed' ? 0 : Math.round(balance * rate / 12),
    owed_now_cents: loan.status === 'closed' ? 0 : left + due,
  }
}
