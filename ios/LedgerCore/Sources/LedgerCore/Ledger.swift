import Foundation

// MARK: - References to records

public enum EntryKind: String, Codable, CaseIterable, Sendable {
    case expense, bill, payment, reimbursement, contribution, proceeds, commitment, changeOrder
    public var label: String {
        switch self {
        case .expense: "Receipt"
        case .bill: "Bill"
        case .payment: "Payment"
        case .reimbursement: "Reimbursement"
        case .contribution: "Contribution"
        case .proceeds: "Sale proceeds"
        case .commitment: "Commitment"
        case .changeOrder: "Change order"
        }
    }
    public var table: String {
        switch self {
        case .expense: "expenses"
        case .bill: "bills"
        case .payment: "bill_payments"
        case .reimbursement: "reimbursements"
        case .contribution: "contributions"
        case .proceeds: "sale_proceeds"
        case .commitment: "commitments"
        case .changeOrder: "change_orders"
        }
    }
}

public struct EntryRef: Hashable, Codable, Sendable, Identifiable {
    public var kind: EntryKind
    public var id: UUID
    public init(_ kind: EntryKind, _ id: UUID) { self.kind = kind; self.id = id }
}

/// One row in Activity: any financial record, flattened for display and search.
public struct Entry: Identifiable, Hashable, Sendable {
    public var ref: EntryRef
    public var id: UUID { ref.id }
    public var date: Day
    public var title: String
    public var subtitle: String
    public var amountCents: Cents
    public var projectId: UUID?
    public var vendorId: UUID?
    /// Partner whose money moved (payer, reimbursed partner, contributor); nil = LLC.
    public var partnerId: UUID?
    public var invoiceNumber: String
    public var categoryIds: [UUID]
    public var status: StatusLabel
    public var createdBy: UUID?
    public var attachmentCount: Int
    public var dueDate: Day?
}

/// A status that reads without color: text + SF Symbol.
public struct StatusLabel: Hashable, Sendable {
    public var text: String
    public var symbol: String
    public var tone: Tone
    public enum Tone: String, Sendable { case neutral, good, warning, bad }
    public init(_ text: String, _ symbol: String, _ tone: Tone) { self.text = text; self.symbol = symbol; self.tone = tone }
}

// MARK: - Results

public struct BillBalance: Hashable, Sendable {
    public var totalCents: Cents
    public var creditsCents: Cents
    public var paidCents: Cents
    public var outstandingCents: Cents
    /// What the vendor is actually charging after credits.
    public var billedCents: Cents { totalCents - creditsCents }
}

public struct CategoryLine: Identifiable, Hashable, Sendable {
    public var categoryId: UUID
    public var name: String
    public var budgetCents: Cents = 0
    public var paidCents: Cents = 0
    public var unpaidBilledCents: Cents = 0
    public var unbilledCommittedCents: Cents = 0
    public var id: UUID { categoryId }
    /// Paid + unpaid billed + remaining unbilled commitments.
    public var projectedCents: Cents { paidCents + unpaidBilledCents + unbilledCommittedCents }
    /// Budget minus projected spend.
    public var remainingCents: Cents { budgetCents - projectedCents }
    public var sources: [EntryRef] = []
}

public struct ProjectTotals: Hashable, Sendable {
    public var budgetCents: Cents = 0
    public var paidCents: Cents = 0
    public var unpaidBilledCents: Cents = 0
    public var unbilledCommittedCents: Cents = 0
    public var proceedsCents: Cents = 0
    public var projectedCents: Cents { paidCents + unpaidBilledCents + unbilledCommittedCents }
    public var remainingCents: Cents { budgetCents - projectedCents }
    /// Recorded sale proceeds minus all recorded and committed costs.
    public var profitEstimateCents: Cents { proceedsCents - projectedCents }
}

public struct CommitmentStatus: Hashable, Sendable {
    public var originalCents: Cents
    public var approvedChangeOrdersCents: Cents
    public var pendingChangeOrdersCents: Cents
    public var billedCents: Cents
    public var revisedCents: Cents { originalCents + approvedChangeOrdersCents }
    public var unbilledCents: Cents { max(revisedCents - billedCents, 0) }
}

public struct PartnerBalance: Hashable, Identifiable, Sendable {
    public var member: Member
    public var id: UUID { member.userId }
    /// Project costs this partner paid with their own money (net of refunds they received).
    public var outOfPocketCents: Cents = 0
    public var contributionsCents: Cents = 0
    public var reimbursedCents: Cents = 0
    public var pendingReimbursementCents: Cents = 0
    /// What the LLC still owes this partner.
    public var owedCents: Cents { outOfPocketCents - reimbursedCents }
}

public struct HomeSummary: Sendable {
    public var paidActiveCents: Cents
    public var paidActiveSources: [EntryRef]
    public var unpaidBillsCents: Cents
    public var unpaidBills: [Entry]
    public var owedToPartnersCents: Cents
    public var partnerBalances: [PartnerBalance]
    public var overdue: [Entry]
    public var dueSoon: [Entry]
    public var needsReview: [Entry]
}

// MARK: - Ledger

/// All balances are computed here from actual transactions, the same way in live and demo mode.
/// Voided records never count.
public struct Ledger: Sendable {
    public let s: LedgerSnapshot
    public let today: Day

    private let allocationsByBill: [UUID: [Allocation]]
    private let allocationsByExpense: [UUID: [Allocation]]
    private let paymentsByBill: [UUID: [BillPayment]]
    private let projectsById: [UUID: Project]
    private let vendorsById: [UUID: Vendor]
    private let categoriesById: [UUID: BudgetCategory]
    private let membersById: [UUID: Member]
    private let billsById: [UUID: Bill]

    public init(_ snapshot: LedgerSnapshot, today: Day = Days.today) {
        s = snapshot
        self.today = today
        allocationsByBill = Dictionary(grouping: snapshot.allocations.filter { $0.billId != nil }, by: { $0.billId! })
        allocationsByExpense = Dictionary(grouping: snapshot.allocations.filter { $0.expenseId != nil }, by: { $0.expenseId! })
        paymentsByBill = Dictionary(grouping: snapshot.payments, by: \.billId)
        projectsById = Dictionary(snapshot.projects.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        vendorsById = Dictionary(snapshot.vendors.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        categoriesById = Dictionary(snapshot.categories.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        membersById = Dictionary(snapshot.members.map { ($0.userId, $0) }, uniquingKeysWith: { a, _ in a })
        billsById = Dictionary(snapshot.bills.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    // MARK: Lookups

    public func project(_ id: UUID?) -> Project? { id.flatMap { projectsById[$0] } }
    public func vendor(_ id: UUID?) -> Vendor? { id.flatMap { vendorsById[$0] } }
    public func category(_ id: UUID?) -> BudgetCategory? { id.flatMap { categoriesById[$0] } }
    public func member(_ id: UUID?) -> Member? { id.flatMap { membersById[$0] } }
    public func bill(_ id: UUID?) -> Bill? { id.flatMap { billsById[$0] } }
    public func payerName(_ id: UUID?) -> String { id == nil ? "LLC account" : (member(id)?.displayName ?? "Former partner") }
    public func allocations(bill id: UUID) -> [Allocation] { allocationsByBill[id] ?? [] }
    public func allocations(expense id: UUID) -> [Allocation] { allocationsByExpense[id] ?? [] }
    public func payments(bill id: UUID) -> [BillPayment] { (paymentsByBill[id] ?? []).sorted { $0.paymentDate < $1.paymentDate } }
    public var activeCategories: [BudgetCategory] { s.categories.filter { !$0.archived }.sorted { $0.sortOrder < $1.sortOrder } }

    public func attachments(for ref: EntryRef) -> [Attachment] {
        s.attachments.filter { a in
            switch ref.kind {
            case .expense: a.expenseId == ref.id
            case .bill: a.billId == ref.id
            case .payment: a.billPaymentId == ref.id
            case .reimbursement: a.reimbursementId == ref.id
            case .contribution: a.contributionId == ref.id
            case .commitment, .changeOrder: a.commitmentId == ref.id
            case .proceeds: false
            }
        }
    }

    // MARK: Bills

    public func balance(bill id: UUID) -> BillBalance {
        let total = bill(id)?.totalCents ?? 0
        let posted = (paymentsByBill[id] ?? []).filter { !$0.isVoid }
        let credits = posted.filter { $0.kind == "credit" }.reduce(0) { $0 + $1.amountCents }
        let paid = posted.reduce(0) { $0 + $1.paidEffect }
        let outstanding = total + posted.reduce(0) { $0 + $1.outstandingEffect }
        return BillBalance(totalCents: total, creditsCents: credits, paidCents: paid, outstandingCents: outstanding)
    }

    public func status(bill b: Bill) -> StatusLabel {
        if b.isVoid { return StatusLabel("Void", "xmark.circle", .neutral) }
        if b.status == RecordStatus.pendingReview { return StatusLabel("Needs approval", "hourglass", .warning) }
        let bal = balance(bill: b.id)
        if bal.outstandingCents <= 0 { return StatusLabel("Paid", "checkmark.circle.fill", .good) }
        if let due = b.dueDate, due < today { return StatusLabel("Overdue", "exclamationmark.triangle.fill", .bad) }
        if bal.paidCents > 0 || bal.creditsCents > 0 { return StatusLabel("Partly paid", "circle.lefthalf.filled", .warning) }
        return StatusLabel("Unpaid", "circle", .warning)
    }

    /// Splits an amount over a bill's categories in proportion to its allocations.
    private func spread(_ amount: Cents, bill id: UUID) -> [(UUID?, Cents)] {
        let allocs = allocations(bill: id)
        guard !allocs.isEmpty else { return [(nil, amount)] }
        let shares = Money.distribute(amount, weights: allocs.map(\.amountCents))
        return zip(allocs, shares).map { ($0.categoryId, $1) }
    }

    /// Per-category share of one payment (used by category summaries and CSV, so they agree).
    public func categoryShares(payment p: BillPayment) -> [(UUID?, Cents)] { spread(p.paidEffect, bill: p.billId) }
    public func categoryShares(outstandingOf b: Bill) -> [(UUID?, Cents)] { spread(balance(bill: b.id).outstandingCents, bill: b.id) }
    public func categoryShares(expense e: Expense) -> [(UUID?, Cents)] {
        let allocs = allocations(expense: e.id)
        guard !allocs.isEmpty else { return [(nil, e.signedCents)] }
        return allocs.map { ($0.categoryId, e.isRefund ? -$0.amountCents : $0.amountCents) }
    }

    // MARK: Commitments

    public func status(commitment c: Commitment) -> CommitmentStatus {
        let cos = s.changeOrders.filter { $0.commitmentId == c.id && !$0.isVoid }
        let approved = cos.filter { $0.status == RecordStatus.posted }.reduce(0) { $0 + $1.amountCents }
        let pending = cos.filter { $0.status == RecordStatus.pendingReview }.reduce(0) { $0 + $1.amountCents }
        let billed = s.bills.filter { $0.commitmentId == c.id && !$0.isVoid }.reduce(0) { $0 + balance(bill: $1.id).billedCents }
        return CommitmentStatus(originalCents: c.amountCents, approvedChangeOrdersCents: approved,
                                pendingChangeOrdersCents: pending, billedCents: billed)
    }

    // MARK: Projects

    public func categorySummary(project pid: UUID) -> [CategoryLine] {
        var lines: [UUID: CategoryLine] = [:]
        let uncategorized = UUID(uuidString: "00000000-0000-0000-0000-000000000000")!
        func line(_ cid: UUID?) -> CategoryLine {
            let id = cid ?? uncategorized
            return lines[id] ?? CategoryLine(categoryId: id, name: category(id)?.name ?? "Uncategorized")
        }
        func add(_ cid: UUID?, _ ref: EntryRef, _ update: (inout CategoryLine) -> Void) {
            var l = line(cid)
            update(&l)
            if !l.sources.contains(ref) { l.sources.append(ref) }
            lines[l.categoryId] = l
        }

        for b in s.budgets where b.projectId == pid {
            var l = line(b.categoryId); l.budgetCents += b.amountCents; lines[l.categoryId] = l
        }
        for e in s.expenses where e.projectId == pid && !e.isVoid {
            for (cid, amt) in categoryShares(expense: e) { add(cid, EntryRef(.expense, e.id)) { $0.paidCents += amt } }
        }
        for b in s.bills where b.projectId == pid && !b.isVoid {
            for p in payments(bill: b.id) where !p.isVoid && p.paidEffect != 0 {
                for (cid, amt) in categoryShares(payment: p) { add(cid, EntryRef(.payment, p.id)) { $0.paidCents += amt } }
            }
            for (cid, amt) in categoryShares(outstandingOf: b) where amt != 0 {
                add(cid, EntryRef(.bill, b.id)) { $0.unpaidBilledCents += amt }
            }
        }
        for c in s.commitments where c.projectId == pid && !c.isVoid {
            let unbilled = status(commitment: c).unbilledCents
            if unbilled > 0 { add(c.categoryId, EntryRef(.commitment, c.id)) { $0.unbilledCommittedCents += unbilled } }
        }
        let order = Dictionary(uniqueKeysWithValues: s.categories.map { ($0.id, $0.sortOrder) })
        return lines.values.sorted { (order[$0.categoryId] ?? 999) < (order[$1.categoryId] ?? 999) }
    }

    public func totals(project pid: UUID) -> ProjectTotals {
        var t = ProjectTotals()
        for l in categorySummary(project: pid) {
            t.budgetCents += l.budgetCents
            t.paidCents += l.paidCents
            t.unpaidBilledCents += l.unpaidBilledCents
            t.unbilledCommittedCents += l.unbilledCommittedCents
        }
        t.proceedsCents = s.proceeds.filter { $0.projectId == pid && !$0.isVoid }.reduce(0) { $0 + $1.amountCents }
        return t
    }

    public func vendors(project pid: UUID) -> [Vendor] {
        var ids = Set<UUID>()
        s.expenses.filter { $0.projectId == pid }.forEach { ids.insert($0.vendorId) }
        s.bills.filter { $0.projectId == pid }.forEach { ids.insert($0.vendorId) }
        s.commitments.filter { $0.projectId == pid }.forEach { ids.insert($0.vendorId) }
        return s.vendors.filter { ids.contains($0.id) }.sorted { $0.name < $1.name }
    }

    // MARK: Partners

    public func partnerBalances(project pid: UUID? = nil) -> [PartnerBalance] {
        s.members.sorted { $0.displayName < $1.displayName }.map { partnerBalance($0.userId, project: pid) }
    }

    /// With a project, only out-of-pocket and contributions are project-specific;
    /// reimbursements are paid to the partner overall.
    public func partnerBalance(_ uid: UUID, project pid: UUID? = nil) -> PartnerBalance {
        var b = PartnerBalance(member: member(uid) ?? Member(workspaceId: s.workspace.id, userId: uid, role: "partner", displayName: "Former partner"))
        for e in s.expenses where e.paidByUserId == uid && !e.isVoid && (pid == nil || e.projectId == pid) {
            b.outOfPocketCents += e.signedCents
        }
        for p in s.payments where p.paidByUserId == uid && !p.isVoid {
            if let pid, bill(p.billId)?.projectId != pid { continue }
            b.outOfPocketCents += p.paidEffect
        }
        for c in s.contributions where c.partnerUserId == uid && !c.isVoid && (pid == nil || c.projectId == pid) {
            b.contributionsCents += c.amountCents
        }
        if pid == nil {
            for r in s.reimbursements where r.partnerUserId == uid {
                if r.isPaid { b.reimbursedCents += r.amountCents }
                if r.isPending { b.pendingReimbursementCents += r.amountCents }
            }
        }
        return b
    }

    /// Transactions where this partner's own money moved, newest first.
    public func partnerEntries(_ uid: UUID) -> [Entry] {
        entries().filter { $0.partnerId == uid }
    }

    // MARK: Activity

    public func entries() -> [Entry] {
        var out: [Entry] = []
        let attachmentCounts = attachmentCountsByRef()
        func count(_ k: EntryKind, _ id: UUID) -> Int { attachmentCounts[EntryRef(k, id)] ?? 0 }

        for e in s.expenses {
            out.append(Entry(ref: EntryRef(.expense, e.id), date: e.expenseDate,
                             title: vendor(e.vendorId)?.name ?? "Receipt",
                             subtitle: [e.isRefund ? "Refund" : "Receipt", project(e.projectId)?.nickname, payerName(e.paidByUserId)].compactMap { $0 }.joined(separator: " · "),
                             amountCents: e.signedCents, projectId: e.projectId, vendorId: e.vendorId, partnerId: e.paidByUserId,
                             invoiceNumber: e.reference, categoryIds: allocations(expense: e.id).map(\.categoryId),
                             status: e.isVoid ? StatusLabel("Void", "xmark.circle", .neutral) : StatusLabel("Paid", "checkmark.circle.fill", .good),
                             createdBy: e.createdBy, attachmentCount: count(.expense, e.id)))
        }
        for b in s.bills {
            out.append(Entry(ref: EntryRef(.bill, b.id), date: b.billDate,
                             title: vendor(b.vendorId)?.name ?? "Bill",
                             subtitle: ["Bill" + (b.invoiceNumber.isEmpty ? "" : " #\(b.invoiceNumber)"), project(b.projectId)?.nickname,
                                        b.dueDate.map { "due \(Days.display($0))" }].compactMap { $0 }.joined(separator: " · "),
                             amountCents: b.totalCents, projectId: b.projectId, vendorId: b.vendorId, partnerId: nil,
                             invoiceNumber: b.invoiceNumber, categoryIds: allocations(bill: b.id).map(\.categoryId),
                             status: status(bill: b), createdBy: b.createdBy, attachmentCount: count(.bill, b.id), dueDate: b.dueDate))
        }
        for p in s.payments {
            let b = bill(p.billId)
            out.append(Entry(ref: EntryRef(.payment, p.id), date: p.paymentDate,
                             title: vendor(b?.vendorId)?.name ?? "Payment",
                             subtitle: [p.kindLabel, b.map { $0.invoiceNumber.isEmpty ? "bill" : "bill #\($0.invoiceNumber)" },
                                        p.kind == "credit" ? nil : payerName(p.paidByUserId)].compactMap { $0 }.joined(separator: " · "),
                             amountCents: p.kind == "payment" ? p.amountCents : -p.amountCents,
                             projectId: b?.projectId, vendorId: b?.vendorId, partnerId: p.kind == "credit" ? nil : p.paidByUserId,
                             invoiceNumber: b?.invoiceNumber ?? "", categoryIds: b.map { allocations(bill: $0.id).map(\.categoryId) } ?? [],
                             status: p.isVoid ? StatusLabel("Void", "xmark.circle", .neutral) : StatusLabel("Recorded", "checkmark.circle.fill", .good),
                             createdBy: p.createdBy, attachmentCount: count(.payment, p.id)))
        }
        for r in s.reimbursements {
            let st: StatusLabel = switch r.status {
            case RecordStatus.paid: StatusLabel("Paid", "checkmark.circle.fill", .good)
            case RecordStatus.approved: StatusLabel("Approved, not paid", "checkmark.seal", .warning)
            case RecordStatus.requested: StatusLabel("Requested", "hourglass", .warning)
            default: StatusLabel("Void", "xmark.circle", .neutral)
            }
            out.append(Entry(ref: EntryRef(.reimbursement, r.id), date: r.paidDate ?? r.requestDate,
                             title: "Reimburse \(payerName(r.partnerUserId))", subtitle: "Reimbursement · not a project cost",
                             amountCents: r.amountCents, projectId: nil, vendorId: nil, partnerId: r.partnerUserId,
                             invoiceNumber: r.reference, categoryIds: [], status: st, createdBy: r.createdBy,
                             attachmentCount: count(.reimbursement, r.id)))
        }
        for c in s.contributions {
            out.append(Entry(ref: EntryRef(.contribution, c.id), date: c.contributionDate,
                             title: "\(payerName(c.partnerUserId)) contribution",
                             subtitle: ["Capital contribution", project(c.projectId)?.nickname].compactMap { $0 }.joined(separator: " · "),
                             amountCents: c.amountCents, projectId: c.projectId, vendorId: nil, partnerId: c.partnerUserId,
                             invoiceNumber: c.reference, categoryIds: [],
                             status: c.isVoid ? StatusLabel("Void", "xmark.circle", .neutral) : StatusLabel("Recorded", "checkmark.circle.fill", .good),
                             createdBy: c.createdBy, attachmentCount: count(.contribution, c.id)))
        }
        for p in s.proceeds {
            out.append(Entry(ref: EntryRef(.proceeds, p.id), date: p.saleDate, title: "Sale of \(project(p.projectId)?.nickname ?? "property")",
                             subtitle: "Sale proceeds", amountCents: p.amountCents, projectId: p.projectId, vendorId: nil, partnerId: nil,
                             invoiceNumber: "", categoryIds: [],
                             status: p.isVoid ? StatusLabel("Void", "xmark.circle", .neutral) : StatusLabel("Recorded", "checkmark.circle.fill", .good),
                             createdBy: p.createdBy, attachmentCount: 0))
        }
        for c in s.commitments {
            let st = status(commitment: c)
            out.append(Entry(ref: EntryRef(.commitment, c.id), date: String((c.createdAt ?? today).prefix(10)),
                             title: vendor(c.vendorId)?.name ?? "Commitment",
                             subtitle: ["Commitment", project(c.projectId)?.nickname, "\(Money.format(st.unbilledCents, showCents: false)) not billed yet"].compactMap { $0 }.joined(separator: " · "),
                             amountCents: st.revisedCents, projectId: c.projectId, vendorId: c.vendorId, partnerId: nil,
                             invoiceNumber: "", categoryIds: [c.categoryId],
                             status: c.isVoid ? StatusLabel("Void", "xmark.circle", .neutral) : StatusLabel("Committed", "signature", .neutral),
                             createdBy: c.createdBy, attachmentCount: count(.commitment, c.id)))
        }
        for co in s.changeOrders {
            guard let c = s.commitments.first(where: { $0.id == co.commitmentId }) else { continue }
            let st: StatusLabel = co.isVoid ? StatusLabel("Void", "xmark.circle", .neutral)
                : co.status == RecordStatus.pendingReview ? StatusLabel("Needs approval", "hourglass", .warning)
                : StatusLabel("Approved", "checkmark.seal", .good)
            out.append(Entry(ref: EntryRef(.changeOrder, co.id), date: String((co.createdAt ?? today).prefix(10)),
                             title: vendor(c.vendorId)?.name ?? "Change order",
                             subtitle: ["Change order", co.description].filter { !$0.isEmpty }.joined(separator: " · "),
                             amountCents: co.amountCents, projectId: c.projectId, vendorId: c.vendorId, partnerId: nil,
                             invoiceNumber: "", categoryIds: [c.categoryId], status: st, createdBy: co.createdBy, attachmentCount: 0))
        }
        return out.sorted { $0.date != $1.date ? $0.date > $1.date : $0.title < $1.title }
    }

    private func attachmentCountsByRef() -> [EntryRef: Int] {
        var d: [EntryRef: Int] = [:]
        for a in s.attachments {
            if let id = a.expenseId { d[EntryRef(.expense, id), default: 0] += 1 }
            if let id = a.billId { d[EntryRef(.bill, id), default: 0] += 1 }
            if let id = a.billPaymentId { d[EntryRef(.payment, id), default: 0] += 1 }
            if let id = a.reimbursementId { d[EntryRef(.reimbursement, id), default: 0] += 1 }
            if let id = a.contributionId { d[EntryRef(.contribution, id), default: 0] += 1 }
            if let id = a.commitmentId { d[EntryRef(.commitment, id), default: 0] += 1 }
        }
        return d
    }

    public struct Filter: Sendable {
        public var text = ""
        public var kinds: Set<EntryKind> = []
        public var projectId: UUID?
        public var vendorId: UUID?
        public var partnerId: UUID?
        public var categoryId: UUID?
        public var statusText: String?
        public var from: Day?
        public var to: Day?
        public init() {}
    }

    public func search(_ f: Filter) -> [Entry] {
        let q = f.text.trimmingCharacters(in: .whitespaces).lowercased()
        return entries().filter { e in
            if !f.kinds.isEmpty && !f.kinds.contains(e.ref.kind) { return false }
            if let p = f.projectId, e.projectId != p { return false }
            if let v = f.vendorId, e.vendorId != v { return false }
            if let p = f.partnerId, e.partnerId != p { return false }
            if let c = f.categoryId, !e.categoryIds.contains(c) { return false }
            if let st = f.statusText, e.status.text != st { return false }
            if let from = f.from, e.date < from { return false }
            if let to = f.to, e.date > to { return false }
            if q.isEmpty { return true }
            let hay = [e.title, e.subtitle, e.invoiceNumber, Money.plain(e.amountCents), Money.format(e.amountCents),
                       project(e.projectId)?.nickname ?? "", vendor(e.vendorId)?.name ?? "", payerName(e.partnerId),
                       e.status.text, e.date] + e.categoryIds.compactMap { category($0)?.name }
            return hay.joined(separator: " ").lowercased().contains(q)
        }
    }

    public func entry(_ ref: EntryRef) -> Entry? { entries().first { $0.ref == ref } }

    // MARK: Duplicates

    /// Likely duplicates of a new receipt or bill: same vendor and invoice number, or
    /// same vendor and amount within 3 days. Voided records are ignored.
    public func possibleDuplicates(vendorId: UUID?, date: Day, amountCents: Cents, invoiceNumber: String, excluding: UUID? = nil) -> [Entry] {
        guard let vendorId else { return [] }
        let inv = invoiceNumber.trimmingCharacters(in: .whitespaces).lowercased()
        return entries().filter { e in
            guard e.ref.kind == .expense || e.ref.kind == .bill, e.vendorId == vendorId, e.id != excluding,
                  e.status.text != "Void" else { return false }
            if !inv.isEmpty && e.invoiceNumber.lowercased() == inv { return true }
            return Swift.abs(e.amountCents) == amountCents && Swift.abs(Days.daysBetween(e.date, date)) <= 3
        }
    }

    // MARK: Vendors

    public struct VendorSummary: Sendable {
        public var billedCents: Cents
        public var paidCents: Cents
        public var outstandingCents: Cents
        public var projects: [Project]
        public var entries: [Entry]
        public var attachments: [Attachment]
    }

    public func summary(vendor vid: UUID) -> VendorSummary {
        let bills = s.bills.filter { $0.vendorId == vid && !$0.isVoid }
        let billed = bills.reduce(0) { $0 + balance(bill: $1.id).billedCents }
        let paidBills = bills.reduce(0) { $0 + balance(bill: $1.id).paidCents }
        let receipts = s.expenses.filter { $0.vendorId == vid && !$0.isVoid }.reduce(0) { $0 + $1.signedCents }
        let outstanding = bills.filter { $0.status == RecordStatus.posted || $0.status == RecordStatus.pendingReview }
            .reduce(0) { $0 + balance(bill: $1.id).outstandingCents }
        let es = entries().filter { $0.vendorId == vid }
        let projectIds = Set(es.compactMap(\.projectId))
        let refs = Set(es.map(\.ref))
        let files = s.attachments.filter { a in
            a.vendorId == vid || refs.contains { attachments(for: $0).contains(a) }
        }
        return VendorSummary(billedCents: billed, paidCents: paidBills + receipts, outstandingCents: outstanding,
                             projects: s.projects.filter { projectIds.contains($0.id) }, entries: es, attachments: files)
    }

    // MARK: Home

    public func home(dueWithinDays: Int = 14) -> HomeSummary {
        let active = Set(s.projects.filter(\.isActive).map(\.id))
        var paid = 0
        var sources: [EntryRef] = []
        for pid in active {
            for l in categorySummary(project: pid) {
                paid += l.paidCents
                sources += l.sources.filter { $0.kind == .expense || $0.kind == .payment }
            }
        }
        let all = entries()
        let billEntries = all.filter { $0.ref.kind == .bill && $0.status.text != "Void" }
        let unpaid = billEntries.filter { balance(bill: $0.id).outstandingCents > 0 }
        let unpaidTotal = unpaid.reduce(0) { $0 + balance(bill: $1.id).outstandingCents }
        let overdue = unpaid.filter { $0.status.text == "Overdue" }.sorted { ($0.dueDate ?? "") < ($1.dueDate ?? "") }
        let soonLimit = Days.adding(dueWithinDays, to: today)
        let dueSoon = unpaid.filter { e in
            guard let d = e.dueDate else { return false }
            return d >= today && d <= soonLimit
        }.sorted { ($0.dueDate ?? "") < ($1.dueDate ?? "") }
        let review = all.filter { $0.status.text == "Needs approval" || $0.status.text == "Requested" || $0.status.text == "Approved, not paid" }
        let balances = partnerBalances()
        return HomeSummary(paidActiveCents: paid, paidActiveSources: sources,
                           unpaidBillsCents: unpaidTotal, unpaidBills: unpaid,
                           owedToPartnersCents: balances.reduce(0) { $0 + max($1.owedCents, 0) },
                           partnerBalances: balances, overdue: overdue, dueSoon: dueSoon, needsReview: review)
    }

    /// Commitments with money not billed yet.
    public func openCommitments(project pid: UUID? = nil) -> [(Commitment, CommitmentStatus)] {
        s.commitments.filter { !$0.isVoid && (pid == nil || $0.projectId == pid) }
            .map { ($0, status(commitment: $0)) }
            .filter { $0.1.unbilledCents > 0 }
    }

    /// Personal-money items for a partner that aren't fully covered by reimbursement items yet.
    public func reimbursableItems(_ uid: UUID) -> [(ref: EntryRef, entry: Entry, remainingCents: Cents)] {
        var covered: [EntryRef: Cents] = [:]
        let paidIds = Set(s.reimbursements.filter { $0.isPaid || $0.isPending }.map(\.id))
        for i in s.reimbursementItems where paidIds.contains(i.reimbursementId) {
            if let e = i.expenseId { covered[EntryRef(.expense, e), default: 0] += i.amountCents }
            if let p = i.billPaymentId { covered[EntryRef(.payment, p), default: 0] += i.amountCents }
        }
        return entries().compactMap { e in
            guard e.partnerId == uid, e.status.text != "Void", e.ref.kind == .expense || e.ref.kind == .payment,
                  e.amountCents > 0 else { return nil }
            let left = e.amountCents - (covered[e.ref] ?? 0)
            return left > 0 ? (e.ref, e, left) : nil
        }
    }
}
