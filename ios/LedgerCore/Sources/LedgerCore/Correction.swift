import Foundation

// Correcting posted money. Receipts and bills are never overwritten: a correction voids the original (with a reason
// that says what changed) and posts a fixed copy, so the history shows both. Same rules as web/src/core/correction.ts.

/// What to change on a receipt or bill. nil = leave as is. For optional values (due date, paid by), the outer
/// optional says "change it" and the inner one is the new value (nil = none / LLC account).
public struct CorrectionPatch: Sendable {
    public var totalCents: Cents?
    public var date: Day?
    public var dueDate: Day??
    public var description: String?
    public var invoiceNumber: String?
    public var vendorId: UUID?
    public var projectId: UUID?
    public var paidByUserId: UUID??
    public var categoryId: UUID?
    public init(totalCents: Cents? = nil, date: Day? = nil, dueDate: Day?? = nil, description: String? = nil, invoiceNumber: String? = nil,
                vendorId: UUID? = nil, projectId: UUID? = nil, paidByUserId: UUID?? = nil, categoryId: UUID? = nil) {
        self.totalCents = totalCents; self.date = date; self.dueDate = dueDate; self.description = description; self.invoiceNumber = invoiceNumber
        self.vendorId = vendorId; self.projectId = projectId; self.paidByUserId = paidByUserId; self.categoryId = categoryId
    }
}

public struct Correction<T: Sendable>: Sendable {
    public var row: T
    public var allocations: [Allocation]
    /// "amount $1,200.00 → $1,250.00; vendor A → B". Empty when nothing changed.
    public var summary: String
}

public struct CorrectionNames {
    public var vendor: (UUID) -> String
    public var project: (UUID) -> String
    public var payer: (UUID?) -> String
    public var category: (UUID) -> String
    public init(vendor: @escaping (UUID) -> String, project: @escaping (UUID) -> String, payer: @escaping (UUID?) -> String, category: @escaping (UUID) -> String) {
        self.vendor = vendor; self.project = project; self.payer = payer; self.category = category
    }
}

public enum Corrections {
    /// Why this receipt can't be corrected in place (nil = it can).
    public static func blocker(expense e: Expense, in s: LedgerSnapshot) -> String? {
        if e.isVoid { return "This record is void." }
        let inReimb = s.reimbursementItems.contains { i in
            i.expenseId == e.id && s.reimbursements.contains { $0.id == i.reimbursementId && !$0.isVoid }
        }
        return inReimb ? "This receipt is part of a reimbursement. Void the reimbursement first." : nil
    }
    /// Why this bill can't be corrected in place (nil = it can).
    public static func blocker(bill b: Bill, in s: LedgerSnapshot) -> String? {
        if b.isVoid { return "This record is void." }
        if s.payments.contains(where: { $0.billId == b.id && !$0.isVoid }) {
            return "This bill has payments or credits recorded. Void those first, or void the bill and enter it again."
        }
        return nil
    }

    /// Spread a new total over the existing category split, keeping the proportions (the remainder goes to the largest line).
    public static func rescale(_ allocs: [(categoryId: UUID, amountCents: Cents)], oldTotal: Cents, newTotal: Cents) -> [(categoryId: UUID, amountCents: Cents)] {
        guard let first = allocs.first else { return [] }
        if allocs.count == 1 || oldTotal == 0 { return [(first.categoryId, newTotal)] }
        var out = allocs.map { (categoryId: $0.categoryId, amountCents: Int((Double($0.amountCents) * Double(newTotal) / Double(oldTotal)).rounded(.down))) }
        let diff = newTotal - out.reduce(0) { $0 + $1.amountCents }
        var big = 0
        for i in out.indices where out[i].amountCents > out[big].amountCents { big = i }
        out[big].amountCents += diff
        return out
    }

    private static func day(_ d: Day?) -> String { d.map { Days.display($0) } ?? "none" }

    public static func build(expense old: Expense, allocations allocs: [Allocation], patch: CorrectionPatch, newId: UUID,
                             names: CorrectionNames) throws -> Correction<Expense> {
        var row = old
        row.id = newId; row.clientId = newId; row.status = RecordStatus.posted
        row.createdBy = nil; row.createdAt = nil; row.voidedBy = nil; row.voidedAt = nil; row.voidReason = nil
        var changes: [String] = []
        if let v = patch.totalCents, v != old.totalCents { changes.append("amount \(Money.format(old.totalCents)) → \(Money.format(v))"); row.totalCents = v }
        if let v = patch.date, v != old.expenseDate { changes.append("date \(day(old.expenseDate)) → \(day(v))"); row.expenseDate = v }
        if let v = patch.description, v != old.description { changes.append("description “\(old.description)” → “\(v)”"); row.description = v }
        if let v = patch.vendorId, v != old.vendorId { changes.append("vendor \(names.vendor(old.vendorId)) → \(names.vendor(v))"); row.vendorId = v }
        if let v = patch.projectId, v != old.projectId { changes.append("project \(names.project(old.projectId)) → \(names.project(v))"); row.projectId = v }
        if let v = patch.paidByUserId, v != old.paidByUserId { changes.append("paid by \(names.payer(old.paidByUserId)) → \(names.payer(v))"); row.paidByUserId = v }
        if row.taxCents > row.totalCents { row.taxCents = row.totalCents }
        let (lines, catChange) = try allocationsFor(allocs, oldTotal: old.totalCents, newTotal: row.totalCents, category: patch.categoryId, names: names)
        if let catChange { changes.append(catChange) }
        let allocations = lines.map { Allocation(workspaceId: row.workspaceId, expenseId: newId, categoryId: $0.categoryId, amountCents: $0.amountCents) }
        return Correction(row: row, allocations: allocations, summary: changes.joined(separator: "; "))
    }

    public static func build(bill old: Bill, allocations allocs: [Allocation], patch: CorrectionPatch, newId: UUID,
                             names: CorrectionNames) throws -> Correction<Bill> {
        var row = old
        row.id = newId; row.clientId = newId; row.status = RecordStatus.posted
        row.createdBy = nil; row.createdAt = nil; row.approvedBy = nil; row.approvedAt = nil; row.voidedBy = nil; row.voidedAt = nil; row.voidReason = nil
        var changes: [String] = []
        if let v = patch.totalCents, v != old.totalCents { changes.append("amount \(Money.format(old.totalCents)) → \(Money.format(v))"); row.totalCents = v }
        if let v = patch.date, v != old.billDate { changes.append("date \(day(old.billDate)) → \(day(v))"); row.billDate = v }
        if let v = patch.dueDate, v != old.dueDate { changes.append("due date \(day(old.dueDate)) → \(day(v))"); row.dueDate = v }
        if let v = patch.description, v != old.description { changes.append("description “\(old.description)” → “\(v)”"); row.description = v }
        if let v = patch.invoiceNumber, v != old.invoiceNumber { changes.append("invoice # “\(old.invoiceNumber)” → “\(v)”"); row.invoiceNumber = v }
        if let v = patch.vendorId, v != old.vendorId { changes.append("vendor \(names.vendor(old.vendorId)) → \(names.vendor(v))"); row.vendorId = v }
        if let v = patch.projectId, v != old.projectId { changes.append("project \(names.project(old.projectId)) → \(names.project(v))"); row.projectId = v }
        if row.taxCents > row.totalCents { row.taxCents = row.totalCents }
        let (lines, catChange) = try allocationsFor(allocs, oldTotal: old.totalCents, newTotal: row.totalCents, category: patch.categoryId, names: names)
        if let catChange { changes.append(catChange) }
        let allocations = lines.map { Allocation(workspaceId: row.workspaceId, billId: newId, categoryId: $0.categoryId, amountCents: $0.amountCents) }
        return Correction(row: row, allocations: allocations, summary: changes.joined(separator: "; "))
    }

    private static func allocationsFor(_ allocs: [Allocation], oldTotal: Cents, newTotal: Cents, category: UUID?, names: CorrectionNames) throws
        -> ([(categoryId: UUID, amountCents: Cents)], String?) {
        var lines = rescale(allocs.map { ($0.categoryId, $0.amountCents) }, oldTotal: oldTotal, newTotal: newTotal)
        guard let category else { return (lines, nil) }
        if allocs.count > 1 { throw LedgerError("This one is split across categories. Use Void and enter it again to change the split.") }
        let was = allocs.first?.categoryId
        guard category != was else { return (lines, nil) }
        lines = [(category, newTotal)]
        return (lines, "category \(was.map(names.category) ?? "none") → \(names.category(category))")
    }
}
