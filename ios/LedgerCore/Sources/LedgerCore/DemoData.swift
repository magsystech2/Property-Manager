import Foundation

/// Sample LLC for demo mode: 3 partners, 2 properties. Nothing is sent anywhere.
public enum DemoData {
    public static let workspaceId = UUID(uuidString: "D0000000-0000-0000-0000-000000000001")!
    public static let partnerA = UUID(uuidString: "D0000000-0000-0000-0000-0000000000A1")!
    public static let partnerB = UUID(uuidString: "D0000000-0000-0000-0000-0000000000B1")!
    public static let partnerC = UUID(uuidString: "D0000000-0000-0000-0000-0000000000C1")!

    public static func snapshot(today: Day = Days.today) -> LedgerSnapshot {
        let ws = workspaceId
        func d(_ offset: Int) -> Day { Days.adding(offset, to: today) }
        func ts(_ offset: Int) -> String { d(offset) + "T15:00:00Z" }

        var s = LedgerSnapshot(workspace: Workspace(id: ws, name: "Demo Flips LLC", requireReview: false))
        s.members = [
            Member(workspaceId: ws, userId: partnerA, role: "owner", displayName: "Madhan", email: "madhan@example.com"),
            Member(workspaceId: ws, userId: partnerB, role: "partner", displayName: "Partner B", email: "partner.b@example.com"),
            Member(workspaceId: ws, userId: partnerC, role: "partner", displayName: "Partner C", email: "partner.c@example.com"),
        ]
        s.categories = BudgetCategory.defaultNames.enumerated().map {
            BudgetCategory(workspaceId: ws, name: $1, sortOrder: $0 + 1)
        }
        func cat(_ n: String) -> UUID { s.categories.first { $0.name == n }!.id }

        let oak = Project(workspaceId: ws, nickname: "Oak St Flip", address: "123 Oak St", projectType: "flip", status: "active",
                          startDate: d(-80), targetCompleteDate: d(40), targetSaleDate: d(70),
                          expectedSaleCents: 32_900_000, sellingCostBps: 600, monthlyHoldingCents: 110_000,
                          loanBalanceCents: 15_000_000, loanRateBps: 1100)
        let pine = Project(workspaceId: ws, nickname: "Pine Rd New Build", address: "Lot 14 Pine Rd", projectType: "new_construction",
                           status: "active", startDate: d(-50), targetCompleteDate: d(210), targetSaleDate: d(240),
                           expectedSaleCents: 48_900_000, sellingCostBps: 550, monthlyHoldingCents: 65_000,
                           loanBalanceCents: 0, loanRateBps: 0)
        s.projects = [oak, pine]

        let budgets: [(Project, String, Cents)] = [
            (oak, "Acquisition", 18_500_000), (oak, "Closing Costs", 650_000), (oak, "Demolition", 400_000), (oak, "Plumbing", 800_000),
            (oak, "Electrical", 600_000), (oak, "Materials", 2_500_000), (oak, "Labor", 1_500_000), (oak, "Permits", 150_000),
            (oak, "Utilities", 60_000), (oak, "Equipment Rentals", 120_000),
            (pine, "Acquisition", 6_500_000), (pine, "Permits", 900_000), (pine, "Framing", 1_200_000), (pine, "Materials", 6_000_000),
            (pine, "Plumbing", 1_400_000), (pine, "Electrical", 1_300_000), (pine, "HVAC", 1_100_000), (pine, "Equipment Rentals", 300_000),
        ]
        s.budgets = budgets.map { ProjectBudget(workspaceId: ws, projectId: $0.0.id, categoryId: cat($0.1), amountCents: $0.2) }

        let homeDepot = Vendor(workspaceId: ws, name: "Home Depot", kind: "supplier")
        let lowes = Vendor(workspaceId: ws, name: "Lowe's", kind: "supplier")
        let framer = Vendor(workspaceId: ws, name: "Solid Framing LLC", kind: "contractor", contactName: "Mike R.", phone: "555-0100", email: "mike@solidframing.example")
        let plumber = Vendor(workspaceId: ws, name: "ABC Plumbing", kind: "contractor", contactName: "Dana", phone: "555-0142")
        let county = Vendor(workspaceId: ws, name: "County Building Dept", kind: "government")
        let water = Vendor(workspaceId: ws, name: "City Water", kind: "utility")
        let title = Vendor(workspaceId: ws, name: "First Title Co.", kind: "other")
        s.vendors = [homeDepot, lowes, framer, plumber, county, water, title]

        func expense(_ p: Project, _ v: Vendor, _ day: Int, _ desc: String, _ total: Cents, _ payer: UUID?, _ splits: [(String, Cents)],
                     method: String = "card", tax: Cents = 0, by: UUID? = nil, refund: Bool = false) -> Expense {
            let e = Expense(workspaceId: ws, projectId: p.id, vendorId: v.id, expenseDate: d(day), description: desc, totalCents: total,
                            taxCents: tax, isRefund: refund, paidByUserId: payer, paymentMethod: method,
                            createdBy: by ?? payer ?? partnerA, createdAt: ts(day))
            s.expenses.append(e)
            s.allocations += splits.map { Allocation(workspaceId: ws, expenseId: e.id, categoryId: cat($0.0), amountCents: $0.1) }
            return e
        }
        func bill(_ p: Project, _ v: Vendor, _ day: Int, due: Int?, _ inv: String, _ desc: String, _ total: Cents,
                  _ splits: [(String, Cents)], commitment: UUID? = nil, status: String = RecordStatus.posted, by: UUID = partnerA) -> Bill {
            let b = Bill(workspaceId: ws, projectId: p.id, vendorId: v.id, commitmentId: commitment, invoiceNumber: inv, billDate: d(day),
                         dueDate: due.map { d($0) }, description: desc, totalCents: total, status: status, createdBy: by, createdAt: ts(day))
            s.bills.append(b)
            s.allocations += splits.map { Allocation(workspaceId: ws, billId: b.id, categoryId: cat($0.0), amountCents: $0.1) }
            return b
        }
        func pay(_ b: Bill, _ day: Int, _ amt: Cents, _ payer: UUID?, _ method: String, _ ref: String, kind: String = "payment") -> BillPayment {
            let p = BillPayment(workspaceId: ws, billId: b.id, kind: kind, paymentDate: d(day), amountCents: amt, paidByUserId: payer,
                                paymentMethod: method, reference: ref, createdBy: payer ?? partnerA, createdAt: ts(day))
            s.payments.append(p)
            return p
        }

        // Capital contributions (deliberately not equal).
        s.contributions = [
            Contribution(workspaceId: ws, partnerUserId: partnerA, amountCents: 8_000_000, contributionDate: d(-90), reference: "Wire 1001", createdBy: partnerA, createdAt: ts(-90)),
            Contribution(workspaceId: ws, partnerUserId: partnerB, amountCents: 8_000_000, contributionDate: d(-90), reference: "Wire 1002", createdBy: partnerB, createdAt: ts(-90)),
            Contribution(workspaceId: ws, partnerUserId: partnerC, amountCents: 5_000_000, contributionDate: d(-88), reference: "Wire 1003", createdBy: partnerC, createdAt: ts(-88)),
        ]

        // Oak St
        _ = expense(oak, title, -80, "Purchase price", 18_500_000, nil, [("Acquisition", 18_500_000)], method: "wire")
        _ = expense(oak, title, -80, "Buyer closing costs", 612_500, nil, [("Closing Costs", 612_500)], method: "wire")
        let drywall = expense(oak, homeDepot, -3, "Drywall, screws, mud", 35_000, partnerA, [("Materials", 35_000)], tax: 2_300)
        _ = expense(oak, lowes, -20, "Vanity, faucets, tile", 231_055, partnerB, [("Materials", 181_055), ("Plumbing", 50_000)], tax: 15_100)
        _ = expense(oak, lowes, -18, "Returned extra tile", 18_000, partnerB, [("Materials", 18_000)], refund: true)
        _ = expense(oak, county, -60, "Plumbing + electrical permits", 42_500, partnerC, [("Permits", 42_500)])
        _ = expense(oak, water, -10, "Water service", 8_820, nil, [("Utilities", 8_820)], method: "ach")
        let plumbBill1 = bill(oak, plumber, -45, due: -30, "ABC-1001", "Rough-in, draw 1 of 2", 450_000, [("Plumbing", 450_000)])
        _ = pay(plumbBill1, -31, 450_000, partnerC, "check", "Check 1043")
        _ = bill(oak, plumber, -25, due: -5, "ABC-1007", "Finish plumbing, draw 2 of 2", 450_000, [("Plumbing", 450_000)])

        // Pine Rd
        _ = expense(pine, title, -50, "Lot purchase", 6_500_000, nil, [("Acquisition", 6_500_000)], method: "wire")
        _ = expense(pine, county, -40, "Building permit + impact fees", 875_000, partnerB, [("Permits", 875_000)], method: "check")
        let framing = Commitment(workspaceId: ws, projectId: pine.id, vendorId: framer.id, categoryId: cat("Framing"),
                                 description: "Framing contract", amountCents: 1_000_000, createdBy: partnerA, createdAt: ts(-30))
        s.commitments.append(framing)
        s.changeOrders.append(ChangeOrder(workspaceId: ws, commitmentId: framing.id, description: "Add covered porch framing",
                                          amountCents: 85_000, status: RecordStatus.pendingReview, createdBy: partnerB, createdAt: ts(-2)))
        let frameBill = bill(pine, framer, -12, due: 6, "SF-210", "Framing draw 1", 400_000, [("Framing", 400_000)], commitment: framing.id)
        let framePay = pay(frameBill, -8, 150_000, nil, "check", "Check 2001")
        let rental = expense(pine, homeDepot, -7, "Mini excavator, 3 days", 115_000, partnerC, [("Equipment Rentals", 115_000)])

        // Reimbursements: the LLC paid Madhan back part of the drywall receipt; Partner C asked for the excavator.
        let r1 = Reimbursement(workspaceId: ws, partnerUserId: partnerA, amountCents: 20_000, requestDate: d(-2), paidDate: d(-1),
                               status: RecordStatus.paid, paymentMethod: "zelle", reference: "Zelle 8812", createdBy: partnerB, createdAt: ts(-1))
        let r2 = Reimbursement(workspaceId: ws, partnerUserId: partnerC, amountCents: 115_000, requestDate: d(-6),
                               status: RecordStatus.requested, notes: "Excavator rental", createdBy: partnerC, createdAt: ts(-6))
        s.reimbursements = [r1, r2]
        s.reimbursementItems = [
            ReimbursementItem(workspaceId: ws, reimbursementId: r1.id, expenseId: drywall.id, amountCents: 20_000),
            ReimbursementItem(workspaceId: ws, reimbursementId: r2.id, expenseId: rental.id, amountCents: 115_000),
        ]

        s.attachments = [
            Attachment(workspaceId: ws, storagePath: "\(ws)/demo-drywall.jpg", filename: "home-depot-drywall.jpg", mimeType: "image/jpeg",
                       sizeBytes: 182_000, link: EntryRef(.expense, drywall.id), uploadedBy: partnerA, createdAt: ts(-3)),
            Attachment(workspaceId: ws, storagePath: "\(ws)/demo-sf-210.pdf", filename: "SF-210.pdf", mimeType: "application/pdf",
                       sizeBytes: 96_000, link: EntryRef(.bill, frameBill.id), uploadedBy: partnerA, createdAt: ts(-12)),
            Attachment(workspaceId: ws, storagePath: "\(ws)/demo-check-2001.jpg", filename: "check-2001.jpg", mimeType: "image/jpeg",
                       sizeBytes: 120_000, link: EntryRef(.payment, framePay.id), uploadedBy: partnerB, createdAt: ts(-8)),
        ]
        // Planning: cash on hand, scheduled draws, an inbox item and a few card/bank statement lines (same as the web demo).
        s.cashBalances = [CashBalance(workspaceId: ws, asOf: d(-1), amountCents: 1_200_000, note: "LLC checking", createdBy: partnerA, createdAt: ts(-1))]
        s.scheduledDraws = [
            ScheduledDraw(workspaceId: ws, commitmentId: framing.id, dueDate: d(10), amountCents: 300_000, description: "Draw 3: roof framing", createdBy: partnerA, createdAt: ts(-5)),
            ScheduledDraw(workspaceId: ws, commitmentId: framing.id, dueDate: d(24), amountCents: 300_000, description: "Final draw", createdBy: partnerA, createdAt: ts(-5)),
        ]
        s.inboxItems = [InboxItem(workspaceId: ws, storagePath: "\(ws)/demo-inbox-abc-1012.pdf", filename: "ABC-Plumbing-invoice-1012.pdf",
                                  mimeType: "application/pdf", sizeBytes: 88_000, note: "Oak St final rough-in, $1,850.00", source: "upload",
                                  suggestedKind: "bill", suggestedProjectId: oak.id, suggestedVendor: "ABC Plumbing", suggestedDate: d(-1),
                                  suggestedTotalCents: 185_000, createdBy: partnerC, createdAt: ts(-1))]
        let batch = UUID()
        func line(_ account: String, _ owner: UUID?, _ day: Int, _ desc: String, _ amount: Cents) -> StatementLine {
            StatementLine(workspaceId: ws, account: account, accountOwner: owner, postedDate: d(day), description: desc, amountCents: amount,
                          fingerprint: "\(account)|\(d(day))|\(amount)|\(desc)|1".lowercased(), importBatch: batch, createdBy: partnerA, createdAt: ts(-1))
        }
        s.statementLines = [
            line("Partner B card 7788", partnerB, -19, "LOWE'S #1187 MARIETTA GA", 231_055),
            line("Madhan card 4421", partnerA, -1, "THE HOME DEPOT #6512 ATLANTA GA", 8_734),
            line("Madhan card 4421", partnerA, -2, "HOME DEPOT TOOL RENTAL #6512", 12_000),
            line("LLC checking 0199", nil, -9, "CITY WATER UTIL AUTOPAY", 8_820),
        ]
        func material(_ p: Project, _ name: String, _ unit: String, _ bought: Double, _ used: Double, _ returned: Double, _ cost: Cents, _ location: String = "") -> Material {
            Material(workspaceId: ws, projectId: p.id, name: name, unit: unit, qtyBought: bought, qtyUsed: used, qtyReturned: returned,
                     unitCostCents: cost, location: location, createdBy: partnerB, createdAt: ts(-10), updatedAt: ts(-2))
        }
        s.materials = [
            material(oak, "LVP flooring", "box", 40, 34, 0, 5_899, "Oak St garage"),
            material(oak, "Subway tile 3x6", "box", 18, 15, 2, 3_450, "Oak St garage"),
            material(oak, "Drywall 4x8 1/2\"", "sheet", 60, 60, 0, 1_598),
            material(pine, "2x4x8 studs", "each", 400, 310, 0, 389, "Pine Rd shed"),
        ]
        s.entryTemplates = [
            EntryTemplate(workspaceId: ws, name: "Oak St builder’s risk insurance", projectId: oak.id, vendorId: title.id, categoryId: cat("Insurance"),
                          amountCents: 21_000, paymentMethod: "ach", description: "Monthly premium", repeat: "monthly", nextDue: d(3), createdBy: partnerA, createdAt: ts(-40)),
            EntryTemplate(workspaceId: ws, name: "Oak St water", projectId: oak.id, vendorId: water.id, categoryId: cat("Utilities"),
                          paymentMethod: "ach", description: "Water and sewer", repeat: "monthly", nextDue: d(21), createdBy: partnerA, createdAt: ts(-40)),
            EntryTemplate(workspaceId: ws, name: "Home Depot run, Pine Rd", projectId: pine.id, vendorId: homeDepot.id, categoryId: cat("Materials"),
                          paidByUserId: partnerA, paymentMethod: "card", createdBy: partnerA, createdAt: ts(-30)),
        ]
        return s
    }
}
