import XCTest
@testable import LedgerCore

/// Mirrors web/src/core/loans.test.ts and correction.test.ts.
final class LoansCorrectionTests: XCTestCase {
    let ws = UUID(), partner = UUID()
    var loan: PartnerLoan { PartnerLoan(workspaceId: ws, partnerUserId: partner, lender: "Friends", principalCents: 5_000_000, rateBps: 1000, startDate: "2025-01-01") }
    func pay(_ l: PartnerLoan, _ on: Day, _ amount: Cents, _ kind: String) -> PartnerLoanPayment {
        PartnerLoanPayment(workspaceId: ws, loanId: l.id, paidOn: on, amountCents: amount, kind: kind)
    }

    func testAccruesSimpleInterestForAYear() {
        let s = Loans.status(loan, payments: [], today: "2026-01-01")
        XCTAssertEqual(s.interestAccruedCents, 500_000)
        XCTAssertEqual(s.monthlyInterestCents, 41_667)
        XCTAssertEqual(s.owedNowCents, 5_500_000)
    }

    func testInterestPaidAndPrincipalRepayment() {
        let l = loan
        let s = Loans.status(l, payments: [pay(l, "2025-07-02", 200_000, "interest"), pay(l, "2025-07-02", 2_500_000, "principal")], today: "2026-01-01")
        XCTAssertEqual(s.interestAccruedCents, Int((5_000_000 * 0.1 * 182 / 365 + 2_500_000 * 0.1 * 183 / 365).rounded()))
        XCTAssertEqual(s.interestPaidCents, 200_000)
        XCTAssertEqual(s.principalLeftCents, 2_500_000)
    }

    func testClosedLoanOwesNothing() {
        var l = loan; l.status = "closed"
        let s = Loans.status(l, payments: [pay(l, "2025-06-01", 5_000_000, "principal")], today: "2026-01-01")
        XCTAssertEqual(s.owedNowCents, 0)
        XCTAssertEqual(s.principalRepaidCents, 5_000_000)
    }

    func testSplitPct() {
        XCTAssertEqual(Money.splitPct(3334), "33.33%")
        XCTAssertEqual(Money.splitPct(6666), "66.67%")
        XCTAssertEqual(Money.splitPct(5000), "50%")
        XCTAssertEqual(Money.splitPct(1250), "12.5%")
    }

    // MARK: Correction

    let catA = UUID(), catB = UUID(), v1 = UUID(), v2 = UUID(), p1 = UUID()
    var names: CorrectionNames {
        let (v1, v2) = (self.v1, self.v2)
        return CorrectionNames(vendor: { $0 == v1 ? "V1" : $0 == v2 ? "V2" : "?" }, project: { _ in "P" }, payer: { $0 == nil ? "LLC account" : "Partner" }, category: { _ in "Cat" })
    }
    var exp: Expense {
        Expense(workspaceId: ws, projectId: p1, vendorId: v1, expenseDate: "2026-11-01", description: "Tile", notes: "n",
                totalCents: 120_000, taxCents: 5_000, paidByUserId: nil)
    }
    func alloc(_ c: UUID, _ a: Cents, _ e: Expense) -> Allocation { Allocation(workspaceId: ws, expenseId: e.id, categoryId: c, amountCents: a) }

    func testRescaleKeepsProportions() {
        let out = Corrections.rescale([(catA, 2000), (catB, 1000)], oldTotal: 3000, newTotal: 1001)
        XCTAssertEqual(out.reduce(0) { $0 + $1.amountCents }, 1001)
        XCTAssertEqual(out[0].amountCents, 668)
        XCTAssertEqual(Corrections.rescale([(catA, 5)], oldTotal: 5, newTotal: 9).first?.amountCents, 9)
    }

    func testBuildCopiesAppliesAndSummarizes() throws {
        let e = exp, newId = UUID()
        let c = try Corrections.build(expense: e, allocations: [alloc(catA, 120_000, e)], patch: CorrectionPatch(totalCents: 125_000, vendorId: v2), newId: newId, names: names)
        XCTAssertEqual(c.row.id, newId)
        XCTAssertEqual(c.row.status, RecordStatus.posted)
        XCTAssertEqual(c.row.totalCents, 125_000)
        XCTAssertEqual(c.allocations.map(\.amountCents), [125_000])
        XCTAssertEqual(c.summary, "amount $1,200.00 → $1,250.00; vendor V1 → V2")
        XCTAssertEqual(try Corrections.build(expense: e, allocations: [alloc(catA, 120_000, e)], patch: CorrectionPatch(totalCents: 120_000, description: "Tile"), newId: newId, names: names).summary, "")
        XCTAssertEqual(try Corrections.build(expense: e, allocations: [alloc(catA, 120_000, e)], patch: CorrectionPatch(totalCents: 3_000), newId: newId, names: names).row.taxCents, 3_000)
    }

    func testCategoryChangeOnlyForSingleCategory() throws {
        let e = exp
        let c = try Corrections.build(expense: e, allocations: [alloc(catA, 120_000, e)], patch: CorrectionPatch(categoryId: catB), newId: UUID(), names: names)
        XCTAssertEqual(c.allocations.map(\.categoryId), [catB])
        XCTAssertThrowsError(try Corrections.build(expense: e, allocations: [alloc(catA, 60_000, e), alloc(catB, 60_000, e)], patch: CorrectionPatch(categoryId: catB), newId: UUID(), names: names))
    }

    func testBlockers() {
        var s = LedgerSnapshot(workspace: Workspace(id: ws, name: "W"))
        let bill = Bill(workspaceId: ws, projectId: p1, vendorId: v1, billDate: "2026-11-01", totalCents: 1000)
        XCTAssertNil(Corrections.blocker(bill: bill, in: s))
        s.payments.append(BillPayment(workspaceId: ws, billId: bill.id, paymentDate: "2026-11-02", amountCents: 1000, paidByUserId: nil))
        XCTAssertNotNil(Corrections.blocker(bill: bill, in: s))
    }
}
