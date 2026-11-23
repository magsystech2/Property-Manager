import XCTest
@testable import LedgerCore

/// The workflows from the spec, checked against the same math the app shows and exports.
final class WorkflowTests: XCTestCase {
    let ws = UUID()
    let a = UUID(), b = UUID(), c = UUID()
    let today: Day = "2026-11-23"
    var s: LedgerSnapshot!
    var project: Project!
    var materials: BudgetCategory!
    var framing: BudgetCategory!
    var homeDepot: Vendor!
    var framer: Vendor!

    override func setUp() {
        s = LedgerSnapshot(workspace: Workspace(id: ws, name: "Test LLC"))
        s.members = [Member(workspaceId: ws, userId: a, role: "owner", displayName: "A"),
                     Member(workspaceId: ws, userId: b, role: "partner", displayName: "B"),
                     Member(workspaceId: ws, userId: c, role: "partner", displayName: "C")]
        materials = BudgetCategory(workspaceId: ws, name: "Materials", sortOrder: 1)
        framing = BudgetCategory(workspaceId: ws, name: "Framing", sortOrder: 2)
        s.categories = [materials, framing]
        project = Project(workspaceId: ws, nickname: "Oak")
        s.projects = [project]
        homeDepot = Vendor(workspaceId: ws, name: "Home Depot")
        framer = Vendor(workspaceId: ws, name: "Solid Framing", kind: "contractor")
        s.vendors = [homeDepot, framer]
        s.budgets = [ProjectBudget(workspaceId: ws, projectId: project.id, categoryId: framing.id, amountCents: 1_200_000)]
    }

    var ledger: Ledger { Ledger(s, today: today) }

    func addReceipt350() -> Expense {
        let e = Expense(workspaceId: ws, projectId: project.id, vendorId: homeDepot.id, expenseDate: "2026-11-20",
                        totalCents: 35_000, paidByUserId: a, paymentMethod: "card", createdBy: a)
        let alloc = Allocation(workspaceId: ws, expenseId: e.id, categoryId: materials.id, amountCents: 35_000)
        XCTAssertNoThrow(try Rules.checkExpense(e, allocations: [alloc]))
        s.expenses.append(e); s.allocations.append(alloc)
        return e
    }

    func testWorkflow1_personalReceipt() {
        let before = ledger.totals(project: project.id).paidCents
        _ = addReceipt350()
        XCTAssertEqual(ledger.totals(project: project.id).paidCents - before, 35_000)
        XCTAssertEqual(ledger.partnerBalance(a).owedCents, 35_000)
        XCTAssertEqual(ledger.partnerBalance(a).outOfPocketCents, 35_000)
    }

    func testWorkflow2_partialReimbursement() throws {
        let e = addReceipt350()
        let r = Reimbursement(workspaceId: ws, partnerUserId: a, amountCents: 20_000, requestDate: today, paidDate: today, status: RecordStatus.paid)
        try Rules.checkReimbursementPaid(r, in: ledger)
        s.reimbursements.append(r)
        s.reimbursementItems.append(ReimbursementItem(workspaceId: ws, reimbursementId: r.id, expenseId: e.id, amountCents: 20_000))
        XCTAssertEqual(ledger.totals(project: project.id).paidCents, 35_000, "reimbursing must not change project costs")
        XCTAssertEqual(ledger.partnerBalance(a).owedCents, 15_000)
        XCTAssertEqual(ledger.reimbursableItems(a).first?.remainingCents, 15_000)
        let tooMuch = Reimbursement(workspaceId: ws, partnerUserId: a, amountCents: 20_000, requestDate: today, paidDate: today, status: RecordStatus.paid)
        XCTAssertThrowsError(try Rules.checkReimbursementPaid(tooMuch, in: ledger))
    }

    func testWorkflow3_commitmentInvoicePartialPayment() throws {
        let commit = Commitment(workspaceId: ws, projectId: project.id, vendorId: framer.id, categoryId: framing.id,
                                description: "Framing", amountCents: 1_000_000)
        s.commitments.append(commit)
        XCTAssertEqual(ledger.totals(project: project.id).projectedCents, 1_000_000)

        let bill = Bill(workspaceId: ws, projectId: project.id, vendorId: framer.id, commitmentId: commit.id,
                        invoiceNumber: "SF-101", billDate: "2026-11-15", dueDate: "2026-12-01", totalCents: 400_000)
        let alloc = Allocation(workspaceId: ws, billId: bill.id, categoryId: framing.id, amountCents: 400_000)
        try Rules.checkBill(bill, allocations: [alloc], in: ledger)
        s.bills.append(bill); s.allocations.append(alloc)
        XCTAssertEqual(ledger.totals(project: project.id).projectedCents, 1_000_000, "invoice must not double count")

        let pay = BillPayment(workspaceId: ws, billId: bill.id, paymentDate: today, amountCents: 150_000, paidByUserId: nil)
        try Rules.checkPayment(pay, in: ledger)
        s.payments.append(pay)

        let line = ledger.categorySummary(project: project.id).first { $0.categoryId == framing.id }!
        XCTAssertEqual(line.paidCents, 150_000)
        XCTAssertEqual(line.unpaidBilledCents, 250_000)
        XCTAssertEqual(line.unbilledCommittedCents, 600_000)
        XCTAssertEqual(line.projectedCents, 1_000_000)
        XCTAssertEqual(line.remainingCents, 200_000)
        XCTAssertEqual(ledger.status(bill: bill).text, "Partly paid")

        let over = BillPayment(workspaceId: ws, billId: bill.id, paymentDate: today, amountCents: 300_000, paidByUserId: nil)
        XCTAssertThrowsError(try Rules.checkPayment(over, in: ledger))
        let dupInvoice = Bill(workspaceId: ws, projectId: project.id, vendorId: framer.id, invoiceNumber: "sf-101", billDate: today, totalCents: 100)
        XCTAssertThrowsError(try Rules.checkBill(dupInvoice, allocations: [Allocation(workspaceId: ws, billId: dupInvoice.id, categoryId: framing.id, amountCents: 100)], in: ledger))
    }

    func testWorkflow4_attachDocumentKeepsTotals() {
        _ = addReceipt350()
        let bill = Bill(workspaceId: ws, projectId: project.id, vendorId: framer.id, billDate: today, totalCents: 10_000)
        s.bills.append(bill)
        s.allocations.append(Allocation(workspaceId: ws, billId: bill.id, categoryId: framing.id, amountCents: 10_000))
        let pay = BillPayment(workspaceId: ws, billId: bill.id, paymentDate: today, amountCents: 10_000, paidByUserId: b)
        s.payments.append(pay)
        let before = (ledger.totals(project: project.id), ledger.partnerBalances())
        s.attachments.append(Attachment(workspaceId: ws, storagePath: "\(ws)/x.jpg", filename: "confirmation.jpg",
                                        mimeType: "image/jpeg", sizeBytes: 1, link: EntryRef(.payment, pay.id), uploadedBy: b))
        XCTAssertEqual(ledger.attachments(for: EntryRef(.payment, pay.id)).count, 1)
        XCTAssertEqual(ledger.entry(EntryRef(.payment, pay.id))?.attachmentCount, 1)
        XCTAssertEqual(ledger.totals(project: project.id), before.0)
        XCTAssertEqual(ledger.partnerBalances(), before.1)
    }

    func testWorkflow6_csvReconciles() {
        // Use the full demo data set, which has splits, refunds, credits, commitments and reimbursements.
        let demo = Ledger(DemoData.snapshot(today: today), today: today)
        let rows = CSVExport.rows(demo)
        var paid = 0, unpaid = 0, unbilled = 0
        for p in demo.s.projects {
            let t = demo.totals(project: p.id)
            paid += t.paidCents; unpaid += t.unpaidBilledCents; unbilled += t.unbilledCommittedCents
        }
        XCTAssertEqual(rows.reduce(0) { $0 + $1.paidCost }, paid)
        XCTAssertEqual(rows.reduce(0) { $0 + $1.unpaidBilled }, unpaid)
        XCTAssertEqual(rows.reduce(0) { $0 + $1.unbilledCommitted }, unbilled)
        for p in demo.s.projects {
            let pr = CSVExport.rows(demo, .init(projectId: p.id))
            XCTAssertEqual(pr.reduce(0) { $0 + $1.paidCost }, demo.totals(project: p.id).paidCents)
            for line in demo.categorySummary(project: p.id) {
                let cr = pr.filter { $0.categoryId == line.categoryId }
                XCTAssertEqual(cr.reduce(0) { $0 + $1.paidCost }, line.paidCents, line.name)
                XCTAssertEqual(cr.reduce(0) { $0 + $1.unpaidBilled }, line.unpaidBilledCents, line.name)
            }
        }
        for bal in demo.partnerBalances() {
            let pr = CSVExport.rows(demo, .init(partnerId: bal.member.userId))
            XCTAssertEqual(pr.reduce(0) { $0 + $1.outOfPocket } - pr.reduce(0) { $0 + $1.reimbursed }, bal.owedCents, bal.member.displayName)
            XCTAssertEqual(pr.reduce(0) { $0 + $1.contribution }, bal.contributionsCents)
        }
        let text = CSVExport.csv(demo)
        XCTAssertTrue(text.hasPrefix("transaction_id,type,date"))
        XCTAssertTrue(text.contains("home-depot-drywall.jpg"))
        XCTAssertTrue(text.contains("\nTOTAL,"))
    }

    func testVoidedRecordsDoNotCount() {
        var e = addReceipt350()
        s.expenses[0].status = RecordStatus.void
        e.status = RecordStatus.void
        XCTAssertEqual(ledger.totals(project: project.id).paidCents, 0)
        XCTAssertEqual(ledger.partnerBalance(a).owedCents, 0)
        XCTAssertThrowsError(try Rules.checkVoid(EntryRef(.expense, e.id), reason: " ", in: ledger))
    }

    func testCreditsAndRefunds() throws {
        let bill = Bill(workspaceId: ws, projectId: project.id, vendorId: framer.id, billDate: today, totalCents: 100_000)
        s.bills.append(bill)
        s.allocations.append(Allocation(workspaceId: ws, billId: bill.id, categoryId: framing.id, amountCents: 100_000))
        let credit = BillPayment(workspaceId: ws, billId: bill.id, kind: "credit", paymentDate: today, amountCents: 10_000, paidByUserId: nil)
        try Rules.checkPayment(credit, in: ledger); s.payments.append(credit)
        let pay = BillPayment(workspaceId: ws, billId: bill.id, paymentDate: today, amountCents: 90_000, paidByUserId: b)
        try Rules.checkPayment(pay, in: ledger); s.payments.append(pay)
        XCTAssertEqual(ledger.balance(bill: bill.id).outstandingCents, 0)
        XCTAssertEqual(ledger.totals(project: project.id).paidCents, 90_000)
        XCTAssertEqual(ledger.totals(project: project.id).unpaidBilledCents, 0)
        let refund = BillPayment(workspaceId: ws, billId: bill.id, kind: "refund", paymentDate: today, amountCents: 5_000, paidByUserId: b)
        try Rules.checkPayment(refund, in: ledger); s.payments.append(refund)
        XCTAssertEqual(ledger.totals(project: project.id).paidCents, 85_000)
        XCTAssertEqual(ledger.partnerBalance(b).owedCents, 85_000)
        XCTAssertThrowsError(try Rules.checkPayment(BillPayment(workspaceId: ws, billId: bill.id, kind: "refund", paymentDate: today,
                                                               amountCents: 90_000, paidByUserId: b), in: ledger))
    }

    func testSplitAllocationsMustMatchTotal() {
        let e = Expense(workspaceId: ws, projectId: project.id, vendorId: homeDepot.id, expenseDate: today, totalCents: 10_000, paidByUserId: nil)
        let parts = [Allocation(workspaceId: ws, expenseId: e.id, categoryId: materials.id, amountCents: 6_000),
                     Allocation(workspaceId: ws, expenseId: e.id, categoryId: framing.id, amountCents: 3_000)]
        XCTAssertThrowsError(try Rules.checkExpense(e, allocations: parts))
        var fixed = parts; fixed[1].amountCents = 4_000
        XCTAssertNoThrow(try Rules.checkExpense(e, allocations: fixed))
    }

    func testDuplicateDetection() {
        _ = addReceipt350()
        XCTAssertEqual(ledger.possibleDuplicates(vendorId: homeDepot.id, date: "2026-11-21", amountCents: 35_000, invoiceNumber: "").count, 1)
        XCTAssertEqual(ledger.possibleDuplicates(vendorId: homeDepot.id, date: "2026-11-01", amountCents: 35_000, invoiceNumber: "").count, 0)
    }

    func testPartnerBalancesDoNotAssumeEqualShares() {
        _ = addReceipt350()
        let balances = ledger.partnerBalances()
        XCTAssertEqual(balances.first { $0.member.userId == b }?.owedCents, 0)
        XCTAssertEqual(balances.first { $0.member.userId == a }?.owedCents, 35_000)
    }
}

final class MoneyAndParserTests: XCTestCase {
    func testDistributeAddsUp() {
        XCTAssertEqual(Money.distribute(100, weights: [1, 1, 1]).reduce(0, +), 100)
        XCTAssertEqual(Money.distribute(-100, weights: [1, 1, 1]).reduce(0, +), -100)
        XCTAssertEqual(Money.distribute(150_000, weights: [400_000]), [150_000])
        XCTAssertEqual(Money.distribute(1001, weights: [500, 500]), [501, 500])
    }

    func testMoneyParseAndFormat() {
        XCTAssertEqual(Money.parse("$1,234.56"), 123_456)
        XCTAssertEqual(Money.parse("350"), 35_000)
        XCTAssertNil(Money.parse("abc"))
        XCTAssertEqual(Money.format(123_456), "$1,234.56")
        XCTAssertEqual(Money.format(-500), "-$5.00")
        XCTAssertEqual(Money.plain(-123_456), "-1234.56")
    }

    func testReceiptParser() {
        let text = """
        THE HOME DEPOT
        2455 Paces Ferry Rd
        11/20/26 03:12 PM
        DRYWALL 1/2 4X8      12.98
        SCREWS               8.47
        SUBTOTAL           327.00
        SALES TAX           23.00
        TOTAL              $350.00
        INVOICE # 4471-22
        """
        let hd = Vendor(workspaceId: UUID(), name: "Home Depot")
        let s = ReceiptTextParser.parse(text, vendors: [hd])
        XCTAssertEqual(s.totalCents, 35_000)
        XCTAssertEqual(s.taxCents, 2_300)
        XCTAssertEqual(s.date, "2026-11-20")
        XCTAssertEqual(s.invoiceNumber, "4471-22")
        XCTAssertEqual(s.vendorId, hd.id)
    }

    func testVoiceParser() {
        let ws = UUID()
        let oak = Project(workspaceId: ws, nickname: "Oak St Flip")
        let pine = Project(workspaceId: ws, nickname: "Pine Rd New Build")
        let cats = BudgetCategory.defaultNames.enumerated().map { BudgetCategory(workspaceId: ws, name: $1, sortOrder: $0) }
        let s = VoiceParser.parse("Spent $1,280 at Home Depot on drywall for Oak Street, paid with my card",
                                  projects: [oak, pine], vendors: [], categories: cats, today: "2026-11-23")
        XCTAssertEqual(s.totalCents, 128_000)
        XCTAssertEqual(s.vendorName, "Home Depot")
        XCTAssertEqual(s.projectId, oak.id)
        XCTAssertEqual(s.paidByMe, true)
        XCTAssertEqual(s.paymentMethod, "card")
        XCTAssertEqual(s.categoryId, cats.first { $0.name == "Materials" }?.id)
    }

    func testDemoDataIsConsistent() throws {
        let l = Ledger(DemoData.snapshot(today: "2026-11-23"), today: "2026-11-23")
        for e in l.s.expenses { try Rules.checkAllocations(total: e.totalCents, allocations: l.allocations(expense: e.id)) }
        for b in l.s.bills { try Rules.checkAllocations(total: b.totalCents, allocations: l.allocations(bill: b.id)) }
        for b in l.s.bills { XCTAssertGreaterThanOrEqual(l.balance(bill: b.id).outstandingCents, 0) }
        for p in l.partnerBalances() { XCTAssertGreaterThanOrEqual(p.owedCents, 0) }
        XCTAssertFalse(l.home().overdue.isEmpty)
        XCTAssertFalse(l.home().needsReview.isEmpty)
    }
}
