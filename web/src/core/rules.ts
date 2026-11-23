// The same checks the database enforces, applied before sending (and by demo mode, which has
// no server). In live mode the database stays the authority. Mirrors LedgerCore/Rules.swift.
import { Money, type Cents } from './money'
import { Ledger } from './ledger'
import { type Allocation, type Bill, type BillPayment, type Expense, type Reimbursement, type EntryRef, outstandingEffect, paidEffect } from './models'

export class LedgerError extends Error {
  name = 'LedgerError'
}

export const Rules = {
  checkAllocations(total: Cents, allocations: Pick<Allocation, 'amount_cents'>[]) {
    if (!(total > 0)) throw new LedgerError('Enter an amount greater than zero.')
    if (allocations.length === 0) throw new LedgerError('Pick at least one budget category.')
    if (!allocations.every((a) => a.amount_cents > 0)) throw new LedgerError('Each category amount must be more than zero.')
    const sum = allocations.reduce((a, b) => a + b.amount_cents, 0)
    if (sum !== total) throw new LedgerError(`Category amounts add up to ${Money.format(sum)}, but the total is ${Money.format(total)}.`)
  },

  checkExpense(e: Expense, allocations: Pick<Allocation, 'amount_cents'>[]) {
    Rules.checkAllocations(e.total_cents, allocations)
    if (e.tax_cents > e.total_cents) throw new LedgerError("Tax can't be more than the total.")
  },

  checkBill(b: Bill, allocations: Pick<Allocation, 'amount_cents'>[], l: Ledger) {
    Rules.checkAllocations(b.total_cents, allocations)
    if (b.tax_cents > b.total_cents) throw new LedgerError("Tax can't be more than the total.")
    const inv = b.invoice_number.trim().toLowerCase()
    if (inv && l.s.bills.some((x) => x.id !== b.id && x.status !== 'void' && x.vendor_id === b.vendor_id && x.invoice_number.toLowerCase() === inv)) {
      throw new LedgerError(`Invoice #${b.invoice_number} from this vendor is already entered.`)
    }
    if (b.commitment_id) {
      const c = l.s.commitments.find((x) => x.id === b.commitment_id)
      if (!c || c.status === 'void') throw new LedgerError('That commitment is void.')
      if (c.project_id !== b.project_id || c.vendor_id !== b.vendor_id) throw new LedgerError('A bill must be for the same project and vendor as its commitment.')
    }
  },

  checkPayment(p: BillPayment, l: Ledger) {
    if (!(p.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero.')
    const b = l.bill(p.bill_id)
    if (!b) throw new LedgerError('Bill not found.')
    if (b.status !== 'posted') throw new LedgerError(b.status === 'pending_review' ? 'This bill needs approval before it can be paid.' : 'This bill is void.')
    const bal = l.balance(b.id)
    if (bal.outstanding_cents + outstandingEffect(p) < 0) throw new LedgerError(`That is more than the ${Money.format(bal.outstanding_cents)} still owed on this bill.`)
    if (bal.paid_cents + paidEffect(p) < 0) throw new LedgerError("A refund can't be more than what was paid.")
    if (p.kind === 'credit' && p.paid_by_user_id) throw new LedgerError('A vendor credit has no payer.')
  },

  checkReimbursementPaid(r: Reimbursement, l: Ledger) {
    if (!(r.amount_cents > 0)) throw new LedgerError('Enter an amount greater than zero.')
    const others = { ...l.s, reimbursements: l.s.reimbursements.filter((x) => x.id !== r.id) }
    const owed = new Ledger(others, l.today).partnerBalance(r.partner_user_id).owed_cents
    if (r.amount_cents > owed) throw new LedgerError(`The LLC only owes this partner ${Money.format(owed)}.`)
  },

  checkApproval(creator: string | null | undefined, approver: string, partner?: string | null) {
    if (approver === creator || approver === partner) throw new LedgerError('Another partner must approve this.')
  },

  checkVoid(ref: EntryRef, reason: string, l: Ledger) {
    if (!reason.trim()) throw new LedgerError('A reason is required to void a record.')
    if (ref.kind === 'bill' && l.paymentsForBill(ref.id).some((p) => p.status !== 'void')) throw new LedgerError("Void this bill's payments first.")
    if (ref.kind === 'payment') {
      const p = l.s.payments.find((x) => x.id === ref.id)
      if (p) {
        const bal = l.balance(p.bill_id)
        if (bal.outstanding_cents - outstandingEffect(p) < 0 || bal.paid_cents - paidEffect(p) < 0) {
          throw new LedgerError("Voiding this would make the bill's balance negative. Void the later payment first.")
        }
      }
    }
    if (ref.kind === 'commitment' && l.s.bills.some((b) => b.commitment_id === ref.id && b.status !== 'void')) {
      throw new LedgerError('Void the bills linked to this commitment first.')
    }
  },
}
