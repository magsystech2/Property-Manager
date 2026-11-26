import XCTest
@testable import LedgerCore

/// Same expectations as the web app's settlement.test.ts and planning.test.ts, so both apps agree.
final class PlanningTests: XCTestCase {
    let today: Day = "2026-11-24"
    func snap() -> LedgerSnapshot { DemoData.snapshot(today: today) }
    func ledger(_ s: LedgerSnapshot) -> Ledger { Ledger(s, today: today) }
    func oak(_ s: LedgerSnapshot) -> Project { s.projects.first { $0.nickname == "Oak St Flip" }! }

    // MARK: Profit split

    func testAllocateIsExact() {
        XCTAssertEqual(Settlements.allocate(100, bps: [3334, 3333, 3333]), [34, 33, 33])
        XCTAssertEqual(Settlements.allocate(-100, bps: [5000, 5000]), [-50, -50])
        XCTAssertEqual(Settlements.allocate(10, bps: [0, 0]), [0, 0])
        XCTAssertEqual(Settlements.allocate(1_000_001, bps: [5000, 2500, 2500]).reduce(0, +), 1_000_001)
    }

    func testShareFallbacks() {
        var s = snap()
        let o = oak(s).id
        XCTAssertEqual(ledger(s).profitShares(project: o).source, .equal)
        XCTAssertEqual(ledger(s).profitShares(project: o).shares.reduce(0) { $0 + $1.shareBps }, 10000)
        s.profitShares = [ProfitShare(workspaceId: s.workspace.id, projectId: nil, partnerUserId: DemoData.partnerA, shareBps: 5000),
                          ProfitShare(workspaceId: s.workspace.id, projectId: nil, partnerUserId: DemoData.partnerB, shareBps: 5000)]
        XCTAssertEqual(ledger(s).profitShares(project: o).source, .default)
        s.profitShares.append(ProfitShare(workspaceId: s.workspace.id, projectId: o, partnerUserId: DemoData.partnerC, shareBps: 10000))
        let r = ledger(s).profitShares(project: o)
        XCTAssertEqual(r.source, .project)
        XCTAssertEqual(r.shares, [Share(partnerUserId: DemoData.partnerC, shareBps: 10000)])
    }

    func testEqualShares() {
        XCTAssertEqual(Settlements.equalShares(snap().members).map(\.shareBps).sorted(), [3333, 3333, 3334])
    }

    // MARK: Cost basis and settlement

    func testCostBasisGroups() {
        XCTAssertEqual(BasisGroup.of("Acquisition"), .purchase)
        XCTAssertEqual(BasisGroup.of("Closing Costs"), .closing)
        XCTAssertEqual(BasisGroup.of("Utilities"), .holding)
        XCTAssertEqual(BasisGroup.of("Plumbing"), .rehab)
        let s = snap()
        let b = ledger(s).costBasis(project: oak(s).id)
        XCTAssertEqual(b.spent[.purchase], 18_500_000)
        XCTAssertEqual(b.spent[.closing], 612_500)
        XCTAssertGreaterThanOrEqual(b.projectedTotal, b.spentTotal)
    }

    func testSettlementReturnsCapitalThenSplitsProfit() {
        var s = snap()
        let o = oak(s).id
        let costs = ledger(s).totals(project: o).projectedCents
        s.proceeds.append(SaleProceed(workspaceId: s.workspace.id, projectId: o, amountCents: costs + 3_000_000, saleDate: today,
                                      grossPriceCents: costs + 3_200_000, sellingCostsCents: 200_000, loanPayoffCents: 0))
        s.distributions.append(Distribution(workspaceId: s.workspace.id, partnerUserId: DemoData.partnerA, projectId: o, amountCents: 500_000,
                                            distributionDate: today, paymentMethod: "wire"))
        let st = ledger(s).settlement(project: o)
        XCTAssertTrue(st.sold)
        XCTAssertEqual(st.profitCents, 3_000_000)
        XCTAssertEqual(st.partners.reduce(0) { $0 + $1.profitShareCents }, 3_000_000)
        let a = st.partners.first { $0.member.userId == DemoData.partnerA }!
        XCTAssertEqual(a.dueCents, a.capitalCents + a.profitShareCents)
        XCTAssertEqual(a.remainingCents, a.dueCents - 500_000)
        XCTAssertEqual(a.capitalCents, 8_000_000)
        XCTAssertTrue(st.returnsLLCCapital)
        let pine = s.projects.first { $0.nickname != "Oak St Flip" }!.id
        XCTAssertFalse(ledger(s).settlement(project: pine).returnsLLCCapital)
    }

    func testRepeatsKeepDayOfMonth() {
        XCTAssertEqual(Settlements.advance("2026-01-31", repeat: "monthly"), "2026-02-28")
        XCTAssertEqual(Settlements.advance("2026-11-15", repeat: "quarterly"), "2027-02-15")
        XCTAssertEqual(Settlements.advance("2026-12-01", repeat: "yearly"), "2027-12-01")
        XCTAssertEqual(Settlements.advance("2026-12-01", repeat: "none"), "2026-12-01")
    }

    // MARK: Statement import

    func testCardExportChargesNegative() {
        let csv = "Account: Chase Ink ...4421\n\nTransaction Date,Post Date,Description,Category,Type,Amount,Memo\n11/20/2026,11/21/2026,HOME DEPOT #6512,Home,Sale,-87.34,\n11/20/2026,11/21/2026,SHELL OIL,Gas,Sale,-40.00,\n11/21/2026,11/22/2026,Payment Thank You,,Payment,500.00,\n11/22/2026,11/22/2026,LOWES #1187,Home,Return,12.00,"
        let p = Statements.parse(csv)
        XCTAssertNil(p.error)
        XCTAssertTrue(p.chargesNegative)
        XCTAssertEqual(p.lines.map(\.amountCents), [8734, 4000, -50000, -1200])
        XCTAssertEqual(p.lines[0].postedDate, "2026-11-20")
        XCTAssertEqual(p.lines[0].description, "HOME DEPOT #6512")
    }

    func testDebitCreditColumns() {
        let p = Statements.parse("Date,Description,Debit,Credit\n2026-11-20,CITY WATER,88.20,\n2026-11-21,DEPOSIT,,\"1,000.00\"\nbad,row,1,")
        XCTAssertEqual(p.lines.map(\.amountCents), [8820, -100000])
        XCTAssertEqual(p.skipped.count, 1)
    }

    func testFingerprints() {
        let l = ParsedStatement.Line(postedDate: "2026-11-20", description: "Home  Depot", amountCents: 500)
        var l2 = l; l2.description = "HOME DEPOT"
        XCTAssertEqual(Statements.fingerprint(account: "Chase 4421", line: l, n: 1), Statements.fingerprint(account: "chase 4421", line: l2, n: 1))
        XCTAssertNotEqual(Statements.fingerprint(account: "Chase 4421", line: l, n: 1), Statements.fingerprint(account: "Chase 4421", line: l, n: 2))
    }

    func testVendorFromDescription() {
        let l = ledger(snap())
        XCTAssertEqual(l.vendorFromDescription("THE HOME DEPOT #6512 ATLANTA GA").name, "Home Depot")
        let j = l.vendorFromDescription("SQ *JOES HARDWARE 4421")
        XCTAssertNil(j.vendorId)
        XCTAssertEqual(j.name, "Joes Hardware")
    }

    // MARK: Matching and missing receipts

    func testSuggestMatches() {
        let l = ledger(snap())
        let lowes = l.s.statementLines.first { $0.description.hasPrefix("LOWE") }!
        let m = l.suggestMatches(lowes)
        XCTAssertEqual(m.count, 1)
        XCTAssertEqual(m.first?.entry.title, "Lowe's")
        XCTAssertTrue(m.first?.why.contains("vendor name matches") ?? false)
        let water = l.s.statementLines.first { $0.description.hasPrefix("CITY WATER") }!
        XCTAssertEqual(l.suggestMatches(water).first?.entry.title, "City Water")
        let hd = l.s.statementLines.first { $0.amountCents == 8_734 }!
        XCTAssertTrue(l.suggestMatches(hd).isEmpty)
    }

    func testMatchedRecordNotSuggestedAgain() {
        var s = snap()
        let i = s.statementLines.firstIndex { $0.description.hasPrefix("LOWE") }!
        let exp = ledger(s).suggestMatches(s.statementLines[i])[0]
        s.statementMatches.append(StatementMatch(workspaceId: s.workspace.id, statementLineId: s.statementLines[i].id, expenseId: exp.ref.id))
        s.statementLines[i].status = "matched"
        XCTAssertTrue(ledger(s).suggestMatches(s.statementLines[i]).isEmpty)
    }

    func testMissingReceipts() {
        let m = ledger(snap()).missingReceipts()
        XCTAssertEqual(m.filter { $0.kind == .unmatchedCharge }.count, 4)
        XCTAssertTrue(m.contains { $0.kind == .noDocument && $0.title == "Lowe's" })
        XCTAssertFalse(m.contains { $0.kind == .noDocument && $0.title == "Home Depot" && $0.amountCents == 35_000 })
        XCTAssertEqual(m.first { $0.amountCents == 8_734 }?.owner, DemoData.partnerA)
    }

    // MARK: Weekly review and cash

    func testWeeklyReview() {
        var s = snap()
        let r0 = ledger(s).weeklyReview()
        XCTAssertTrue(r0.billsDue.map(\.title).contains("ABC Plumbing"))
        XCTAssertEqual(r0.inbox.count, 1)
        XCTAssertEqual(r0.unmatched.count, 4)
        s.claims.append(Claim(workspaceId: s.workspace.id, itemKind: .bill, itemId: r0.billsDue[0].itemId, claimedBy: DemoData.partnerB))
        XCTAssertEqual(ledger(s).weeklyReview().billsDue[0].claim?.claimedBy, DemoData.partnerB)
    }

    func testCashPlan() {
        let l = ledger(snap())
        let p = l.cashPlan()
        let owedBills = l.s.bills.filter { $0.status == RecordStatus.posted }.reduce(0) { $0 + max(l.balance(bill: $1.id).outstandingCents, 0) }
        let draws = p.events.filter { $0.kind == .draw }.reduce(0) { $0 + $1.amountCents }
        let reimb = p.events.filter { $0.kind == .reimbursement }.reduce(0) { $0 + $1.amountCents }
        XCTAssertEqual(draws, 600_000)
        XCTAssertEqual(p.totalCents, owedBills + draws + reimb)
        XCTAssertEqual(p.cashOnHandCents, 1_200_000)
        XCTAssertNotNil(p.shortfall)
        XCTAssertEqual(p.days.last?.balanceCents, 1_200_000 - p.totalCents)
    }

    // MARK: Forecast

    func testForecast() {
        let l = ledger(snap())
        let o = l.s.projects[0]
        let base = l.forecast(o)
        let t = l.totals(project: o.id)
        XCTAssertEqual(base.saleCents, 32_900_000)
        XCTAssertEqual(base.sellingCostsCents, 1_974_000)
        XCTAssertEqual(base.monthsLeft, Ledger.monthsUntil(today, o.targetSaleDate))
        XCTAssertEqual(base.profitCents, 32_900_000 - 1_974_000 - t.projectedCents - base.budgetGapCents - base.holdingCents - base.interestCents)
        let late = l.forecast(o, delayMonths: 1)
        XCTAssertEqual(base.profitCents - late.profitCents, late.holdingCents - base.holdingCents + late.interestCents - base.interestCents)
        XCTAssertEqual(late.holdingCents - base.holdingCents, 110_000)
        XCTAssertEqual(late.interestCents - base.interestCents, 137_500)
        let cheap = l.forecast(o, salePct: 95)
        XCTAssertEqual(base.profitCents - cheap.profitCents, 1_645_000 - 98_700)
    }

    func testForecastMissing() {
        let l = ledger(snap())
        var o = l.s.projects[0]
        o.expectedSaleCents = nil; o.targetSaleDate = nil
        XCTAssertEqual(l.forecast(o).missing, ["expected sale price", "target sale date"])
        XCTAssertEqual(Ledger.monthsUntil(today, Days.adding(-5, to: today)), 0)
    }

    // MARK: Inbox

    func testSuggestFromText() {
        let l = ledger(snap())
        XCTAssertEqual(l.suggestFromText("ABC Plumbing invoice 1012 oak st 1,850.00 11/23/2026.pdf"),
                       InboxSuggestion(vendor: "ABC Plumbing", totalCents: 185_000, date: "2026-11-23", projectId: l.s.projects[0].id, kind: "bill"))
        XCTAssertNil(l.suggestFromText("IMG_2041.jpg").totalCents)
    }

    // MARK: Demo data

    func testDemoMaterialsAndTemplates() {
        let s = snap()
        XCTAssertEqual(s.materials.count, 4)
        XCTAssertTrue(s.materials.allSatisfy(\.isValid))
        XCTAssertEqual(s.materials.first { $0.name == "LVP flooring" }?.leftValueCents, 6 * 5_899)
        XCTAssertEqual(s.entryTemplates.filter { $0.repeat != "none" }.count, 2)
    }

    // MARK: Pooled money (web: settlement.test.ts "pooled money")

    func testPoolSummary() {
        var s = snap()
        let o = oak(s).id
        let (a, b, c) = (DemoData.partnerA, DemoData.partnerB, DemoData.partnerC)
        s.expenses = []; s.bills = []; s.payments = []; s.allocations = []; s.reimbursements = []; s.reimbursementItems = []
        s.contributions = []; s.proceeds = []; s.distributions = []; s.profitShares = []
        let ws = s.workspace.id, v = s.vendors[0].id
        func exp(_ cents: Cents, _ by: UUID?, refund: Bool = false, void: Bool = false) {
            s.expenses.append(Expense(workspaceId: ws, projectId: o, vendorId: v, expenseDate: today, totalCents: cents, isRefund: refund,
                                      paidByUserId: by, paymentMethod: "ach", status: void ? RecordStatus.void : RecordStatus.posted))
        }
        s.contributions.append(Contribution(workspaceId: ws, partnerUserId: a, projectId: o, amountCents: 60_000, contributionDate: today))
        s.contributions.append(Contribution(workspaceId: ws, partnerUserId: b, projectId: nil, amountCents: 30_000, contributionDate: today))
        exp(100_000, nil)
        exp(10_000, nil, refund: true)
        exp(30_000, c)
        exp(5_000, b)
        exp(999_999, a, void: true)
        s.reimbursements.append(Reimbursement(workspaceId: ws, partnerUserId: c, amountCents: 10_000, requestDate: today, status: RecordStatus.paid))
        let sum = ledger(s).poolSummary()
        XCTAssertEqual(sum.totalSpentCents, 125_000)
        XCTAssertEqual(sum.paidByLLCCents, 90_000)
        XCTAssertEqual(sum.paidPersonallyCents, 35_000)
        XCTAssertEqual(sum.potBalanceCents, 60_000 + 30_000 - 90_000 - 10_000)
        XCTAssertEqual(sum.shareSource, .equal)
        let by = Dictionary(uniqueKeysWithValues: sum.partners.map { ($0.member.userId, $0) })
        XCTAssertEqual(by[a]?.putInCents, 60_000)
        XCTAssertEqual(by[b]?.putInCents, 35_000)
        XCTAssertEqual(by[c]?.putInCents, 20_000)
        XCTAssertEqual(sum.partners.map(\.shareOfSpendingCents).sorted(), [41_666, 41_667, 41_667])
        XCTAssertEqual(sum.partners.reduce(0) { $0 + $1.overShareCents }, sum.potBalanceCents)
        let proj = ledger(s).poolSummary(project: o)
        XCTAssertEqual(proj.contributedCents, 60_000)
        XCTAssertEqual(proj.reimbursedCents, 0)
    }
}
