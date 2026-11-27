import Foundation

// Borrowed money (migration 09): personal loans partners took to fund their part. Reference only: the money is
// already in the books as that partner's contribution or personal payment, so loans never change balances.
// Same rules as web/src/core/loans.ts.

public struct PartnerLoan: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var partnerUserId: UUID
    /// What the money went into; nil = the LLC in general.
    public var projectId: UUID?
    public var lender: String
    public var principalCents: Cents
    /// Simple interest a year, in basis points (1000 = 10%).
    public var rateBps: Int
    public var startDate: Day
    /// open, closed
    public var status: String
    public var notes: String
    public var createdBy: UUID?
    public var createdAt: String?
    public var updatedAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, partnerUserId: UUID, projectId: UUID? = nil, lender: String = "", principalCents: Cents = 0,
                rateBps: Int = 0, startDate: Day = Days.today, status: String = "open", notes: String = "",
                createdBy: UUID? = nil, createdAt: String? = nil, updatedAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.partnerUserId = partnerUserId; self.projectId = projectId; self.lender = lender
        self.principalCents = principalCents; self.rateBps = rateBps; self.startDate = startDate; self.status = status; self.notes = notes
        self.createdBy = createdBy; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    public var isClosed: Bool { status == "closed" }
}

public struct PartnerLoanPayment: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var loanId: UUID
    public var paidOn: Day
    public var amountCents: Cents
    /// interest, principal
    public var kind: String
    public var note: String
    public var createdBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, loanId: UUID, paidOn: Day, amountCents: Cents, kind: String = "interest", note: String = "",
                createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.loanId = loanId; self.paidOn = paidOn; self.amountCents = amountCents
        self.kind = kind; self.note = note; self.createdBy = createdBy; self.createdAt = createdAt
    }
}

public struct LoanStatus: Identifiable, Sendable {
    public var loan: PartnerLoan
    public var id: UUID { loan.id }
    public var payments: [PartnerLoanPayment]
    public var principalRepaidCents: Cents
    public var principalLeftCents: Cents
    /// Simple interest built up from the start date to today, on the principal still out at each point.
    public var interestAccruedCents: Cents
    public var interestPaidCents: Cents
    /// Built up but not paid yet (never below zero).
    public var interestDueCents: Cents
    /// One month's interest on what's still borrowed now.
    public var monthlyInterestCents: Cents
    /// Principal left + interest due.
    public var owedNowCents: Cents
}

public enum Loans {
    /// Simple yearly interest, accrued day by day; principal repayments lower the balance from the day they're paid.
    public static func status(_ loan: PartnerLoan, payments all: [PartnerLoanPayment], today: Day = Days.today) -> LoanStatus {
        let payments = all.filter { $0.loanId == loan.id }.sorted { $0.paidOn < $1.paidOn }
        let principalPaid = payments.filter { $0.kind == "principal" }
        let interestPaid = payments.filter { $0.kind != "principal" }.reduce(0) { $0 + $1.amountCents }
        let rate = Double(loan.rateBps) / 10_000
        var balance = loan.principalCents
        var from = loan.startDate
        var accrued = 0.0
        let until = loan.isClosed && !principalPaid.isEmpty ? principalPaid.last!.paidOn : today
        for p in principalPaid {
            if p.paidOn > until { break }
            if p.paidOn > from {
                accrued += Double(balance) * rate * Double(Days.daysBetween(from, p.paidOn)) / 365
                from = p.paidOn
            }
            balance = max(balance - p.amountCents, 0)
        }
        if until > from { accrued += Double(balance) * rate * Double(Days.daysBetween(from, until)) / 365 }
        let accruedC = Int(accrued.rounded())
        let closed = loan.isClosed
        let left = closed ? 0 : balance
        let due = closed ? 0 : max(accruedC - interestPaid, 0)
        return LoanStatus(loan: loan, payments: payments, principalRepaidCents: loan.principalCents - balance, principalLeftCents: left,
                          interestAccruedCents: accruedC, interestPaidCents: interestPaid, interestDueCents: due,
                          monthlyInterestCents: closed ? 0 : Int((Double(balance) * rate / 12).rounded()),
                          owedNowCents: closed ? 0 : left + due)
    }
}

public extension Ledger {
    /// Loans for one project (or all), with what's owed now, sorted by partner then date.
    func loans(project pid: UUID? = nil) -> [LoanStatus] {
        s.partnerLoans.filter { pid == nil || $0.projectId == pid }
            .map { Loans.status($0, payments: s.partnerLoanPayments, today: today) }
            .sorted { payerName($0.loan.partnerUserId) != payerName($1.loan.partnerUserId)
                ? payerName($0.loan.partnerUserId) < payerName($1.loan.partnerUserId) : $0.loan.startDate < $1.loan.startDate }
    }

    /// Open "needs review" flags, newest first (migration 10).
    var reviewFlags: [IssueReport] {
        s.issueReports.filter { $0.isOpen && $0.isReviewFlag }.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
    }
    func reviewFlags(for ref: EntryRef) -> [IssueReport] { reviewFlags.filter { $0.ref == ref } }
    /// Open issue reports that aren't review flags.
    var openIssues: [IssueReport] { s.issueReports.filter { $0.isOpen && !$0.isReviewFlag } }
}

public extension Money {
    /// A split in basis points as a percent. Exact thirds are stored as 3334/3333/3333 (the extra point only decides
    /// who gets a leftover cent), so they all read 33.33%; likewise two thirds reads 66.67%.
    static func splitPct(_ bps: Int) -> String {
        let b = bps == 3334 ? 3333 : bps == 6666 ? 6667 : bps
        var t = String(format: "%.2f", Double(b) / 100)
        while t.hasSuffix("0") { t.removeLast() }
        if t.hasSuffix(".") { t.removeLast() }
        return t + "%"
    }
}
