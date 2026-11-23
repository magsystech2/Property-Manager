import Foundation

public struct LedgerError: LocalizedError, Equatable, Sendable {
    public var message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// The same checks the database enforces, applied before sending (and by demo mode,
/// which has no server). The server remains the authority in live mode.
public enum Rules {
    public static func checkAllocations(total: Cents, allocations: [Allocation]) throws {
        guard total > 0 else { throw LedgerError("Enter an amount greater than zero.") }
        guard !allocations.isEmpty else { throw LedgerError("Pick at least one budget category.") }
        guard allocations.allSatisfy({ $0.amountCents > 0 }) else { throw LedgerError("Each category amount must be more than zero.") }
        let sum = allocations.reduce(0) { $0 + $1.amountCents }
        guard sum == total else {
            throw LedgerError("Category amounts add up to \(Money.format(sum)), but the total is \(Money.format(total)).")
        }
    }

    public static func checkExpense(_ e: Expense, allocations: [Allocation]) throws {
        try checkAllocations(total: e.totalCents, allocations: allocations)
        guard e.taxCents <= e.totalCents else { throw LedgerError("Tax can't be more than the total.") }
    }

    public static func checkBill(_ b: Bill, allocations: [Allocation], in ledger: Ledger) throws {
        try checkAllocations(total: b.totalCents, allocations: allocations)
        guard b.taxCents <= b.totalCents else { throw LedgerError("Tax can't be more than the total.") }
        let inv = b.invoiceNumber.trimmingCharacters(in: .whitespaces).lowercased()
        if !inv.isEmpty, ledger.s.bills.contains(where: { $0.id != b.id && !$0.isVoid && $0.vendorId == b.vendorId && $0.invoiceNumber.lowercased() == inv }) {
            throw LedgerError("Invoice #\(b.invoiceNumber) from this vendor is already entered.")
        }
        if let cid = b.commitmentId {
            guard let c = ledger.s.commitments.first(where: { $0.id == cid }), !c.isVoid else { throw LedgerError("That commitment is void.") }
            guard c.projectId == b.projectId, c.vendorId == b.vendorId else {
                throw LedgerError("A bill must be for the same project and vendor as its commitment.")
            }
        }
    }

    public static func checkPayment(_ p: BillPayment, in ledger: Ledger) throws {
        guard p.amountCents > 0 else { throw LedgerError("Enter an amount greater than zero.") }
        guard let b = ledger.bill(p.billId) else { throw LedgerError("Bill not found.") }
        guard b.status == RecordStatus.posted else {
            throw LedgerError(b.status == RecordStatus.pendingReview ? "This bill needs approval before it can be paid." : "This bill is void.")
        }
        let bal = ledger.balance(bill: b.id)
        if bal.outstandingCents + p.outstandingEffect < 0 {
            throw LedgerError("That is more than the \(Money.format(bal.outstandingCents)) still owed on this bill.")
        }
        if bal.paidCents + p.paidEffect < 0 { throw LedgerError("A refund can't be more than what was paid.") }
        if p.kind == "credit" && p.paidByUserId != nil { throw LedgerError("A vendor credit has no payer.") }
    }

    public static func checkReimbursementPaid(_ r: Reimbursement, in ledger: Ledger) throws {
        guard r.amountCents > 0 else { throw LedgerError("Enter an amount greater than zero.") }
        var others = ledger.s
        others.reimbursements.removeAll { $0.id == r.id }
        let owed = Ledger(others, today: ledger.today).partnerBalance(r.partnerUserId).owedCents
        if r.amountCents > owed { throw LedgerError("The LLC only owes this partner \(Money.format(owed)).") }
    }

    public static func checkApproval(creator: UUID?, partner: UUID? = nil, approver: UUID) throws {
        if approver == creator || approver == partner { throw LedgerError("Another partner must approve this.") }
    }

    public static func checkVoid(_ ref: EntryRef, reason: String, in ledger: Ledger) throws {
        guard !reason.trimmingCharacters(in: .whitespaces).isEmpty else { throw LedgerError("A reason is required to void a record.") }
        if ref.kind == .bill, ledger.payments(bill: ref.id).contains(where: { !$0.isVoid }) {
            throw LedgerError("Void this bill's payments first.")
        }
        if ref.kind == .payment, let p = ledger.s.payments.first(where: { $0.id == ref.id }) {
            let bal = ledger.balance(bill: p.billId)
            if bal.outstandingCents - p.outstandingEffect < 0 || bal.paidCents - p.paidEffect < 0 {
                throw LedgerError("Voiding this would make the bill's balance negative. Void the later payment first.")
            }
        }
        if ref.kind == .commitment, ledger.s.bills.contains(where: { $0.commitmentId == ref.id && !$0.isVoid }) {
            throw LedgerError("Void the bills linked to this commitment first.")
        }
    }
}
