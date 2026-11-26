import Foundation

// Tables from migrations 05 and 06, shared with the web app. Field names map to snake_case columns.

/// A receipt photo or invoice PDF dropped in for someone to file later.
public struct InboxItem: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var storagePath: String
    public var filename: String
    public var mimeType: String
    public var sizeBytes: Int
    public var note: String
    /// upload, share, email
    public var source: String
    public var suggestedKind: String?
    public var suggestedProjectId: UUID?
    public var suggestedVendor: String?
    public var suggestedDate: Day?
    public var suggestedTotalCents: Cents?
    /// new, filed, dismissed
    public var status: String
    public var filedExpenseId: UUID?
    public var filedBillId: UUID?
    public var dismissReason: String?
    public var handledBy: UUID?
    public var handledAt: String?
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, storagePath: String, filename: String, mimeType: String, sizeBytes: Int,
                note: String = "", source: String = "upload", suggestedKind: String? = nil, suggestedProjectId: UUID? = nil,
                suggestedVendor: String? = nil, suggestedDate: Day? = nil, suggestedTotalCents: Cents? = nil, status: String = "new",
                clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.storagePath = storagePath; self.filename = filename; self.mimeType = mimeType
        self.sizeBytes = sizeBytes; self.note = note; self.source = source; self.suggestedKind = suggestedKind
        self.suggestedProjectId = suggestedProjectId; self.suggestedVendor = suggestedVendor; self.suggestedDate = suggestedDate
        self.suggestedTotalCents = suggestedTotalCents; self.status = status; self.clientId = clientId
        self.createdBy = createdBy; self.createdAt = createdAt
    }
    public var isImage: Bool { mimeType.hasPrefix("image/") }
    public var createdDay: Day { String((createdAt ?? Days.today).prefix(10)) }
}

/// One row from a card or bank statement. amountCents > 0 is money out, < 0 money in.
public struct StatementLine: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var account: String
    /// Partner whose personal card it is; nil = LLC account.
    public var accountOwner: UUID?
    public var postedDate: Day
    public var description: String
    public var amountCents: Cents
    public var fingerprint: String
    public var importBatch: UUID
    /// unmatched, matched, ignored
    public var status: String
    public var ignoreReason: String?
    public var handledBy: UUID?
    public var handledAt: String?
    public var createdBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, account: String, accountOwner: UUID?, postedDate: Day, description: String,
                amountCents: Cents, fingerprint: String, importBatch: UUID, status: String = "unmatched", createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.account = account; self.accountOwner = accountOwner; self.postedDate = postedDate
        self.description = description; self.amountCents = amountCents; self.fingerprint = fingerprint; self.importBatch = importBatch
        self.status = status; self.createdBy = createdBy; self.createdAt = createdAt
    }
}

/// Links a statement line to the receipt or bill payment that explains it. Several per line = a split.
public struct StatementMatch: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var statementLineId: UUID
    public var expenseId: UUID?
    public var billPaymentId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, statementLineId: UUID, expenseId: UUID? = nil, billPaymentId: UUID? = nil,
                createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.statementLineId = statementLineId; self.expenseId = expenseId
        self.billPaymentId = billPaymentId; self.createdBy = createdBy; self.createdAt = createdAt
    }
}

public enum ClaimKind: String, Codable, Sendable { case bill, reimbursement, changeOrder = "change_order", inboxItem = "inbox_item", statementLine = "statement_line", expense }

/// "I'll handle this" in the weekly review.
public struct Claim: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var itemKind: String
    public var itemId: UUID
    public var claimedBy: UUID
    public var claimedAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, itemKind: ClaimKind, itemId: UUID, claimedBy: UUID, claimedAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.itemKind = itemKind.rawValue; self.itemId = itemId
        self.claimedBy = claimedBy; self.claimedAt = claimedAt
    }
}

/// An expected draw on a contractor agreement, for the cash plan.
public struct ScheduledDraw: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var commitmentId: UUID
    public var dueDate: Day
    public var amountCents: Cents
    public var description: String
    public var createdBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, commitmentId: UUID, dueDate: Day, amountCents: Cents, description: String = "",
                createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.commitmentId = commitmentId; self.dueDate = dueDate
        self.amountCents = amountCents; self.description = description; self.createdBy = createdBy; self.createdAt = createdAt
    }
}

/// The LLC's cash on hand. Append-only; the latest row wins.
public struct CashBalance: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var asOf: Day
    public var amountCents: Cents
    public var note: String
    public var createdBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, asOf: Day, amountCents: Cents, note: String = "", createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.asOf = asOf; self.amountCents = amountCents; self.note = note
        self.createdBy = createdBy; self.createdAt = createdAt
    }
}

/// Profit split. projectId nil = the LLC default. Rows for one project (or the default) add up to 10000.
public struct ProfitShare: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var projectId: UUID?
    public var partnerUserId: UUID
    public var shareBps: Int
    public init(id: UUID = UUID(), workspaceId: UUID, projectId: UUID?, partnerUserId: UUID, shareBps: Int) {
        self.id = id; self.workspaceId = workspaceId; self.projectId = projectId; self.partnerUserId = partnerUserId; self.shareBps = shareBps
    }
}

/// What was bought, used, returned and is left over. Not money (the receipt is), so it can be edited.
public struct Material: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var projectId: UUID
    public var name: String
    public var unit: String
    public var qtyBought: Double
    public var qtyUsed: Double
    public var qtyReturned: Double
    public var unitCostCents: Cents
    public var expenseId: UUID?
    public var location: String
    public var notes: String
    public var createdBy: UUID?
    public var createdAt: String?
    public var updatedAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, projectId: UUID, name: String, unit: String = "", qtyBought: Double = 0,
                qtyUsed: Double = 0, qtyReturned: Double = 0, unitCostCents: Cents = 0, expenseId: UUID? = nil, location: String = "",
                notes: String = "", createdBy: UUID? = nil, createdAt: String? = nil, updatedAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.projectId = projectId; self.name = name; self.unit = unit
        self.qtyBought = qtyBought; self.qtyUsed = qtyUsed; self.qtyReturned = qtyReturned; self.unitCostCents = unitCostCents
        self.expenseId = expenseId; self.location = location; self.notes = notes; self.createdBy = createdBy
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    enum CodingKeys: String, CodingKey {
        case id, workspaceId, projectId, name, unit, qtyBought, qtyUsed, qtyReturned, unitCostCents, expenseId, location, notes, createdBy, createdAt, updatedAt
    }
    /// Quantities are numeric columns; accept them as numbers or strings.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func qty(_ k: CodingKeys) throws -> Double {
            if let d = try? c.decode(Double.self, forKey: k) { return d }
            if let s = try? c.decode(String.self, forKey: k), let d = Double(s) { return d }
            return 0
        }
        id = try c.decode(UUID.self, forKey: .id); workspaceId = try c.decode(UUID.self, forKey: .workspaceId)
        projectId = try c.decode(UUID.self, forKey: .projectId); name = try c.decode(String.self, forKey: .name)
        unit = try c.decodeIfPresent(String.self, forKey: .unit) ?? ""
        qtyBought = try qty(.qtyBought); qtyUsed = try qty(.qtyUsed); qtyReturned = try qty(.qtyReturned)
        unitCostCents = try c.decodeIfPresent(Cents.self, forKey: .unitCostCents) ?? 0
        expenseId = try c.decodeIfPresent(UUID.self, forKey: .expenseId)
        location = try c.decodeIfPresent(String.self, forKey: .location) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        createdBy = try c.decodeIfPresent(UUID.self, forKey: .createdBy); createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
    }
    /// Who and when are set by the database, so they're never sent.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(workspaceId, forKey: .workspaceId); try c.encode(projectId, forKey: .projectId)
        try c.encode(name, forKey: .name); try c.encode(unit, forKey: .unit); try c.encode(qtyBought, forKey: .qtyBought)
        try c.encode(qtyUsed, forKey: .qtyUsed); try c.encode(qtyReturned, forKey: .qtyReturned); try c.encode(unitCostCents, forKey: .unitCostCents)
        try c.encode(expenseId, forKey: .expenseId); try c.encode(location, forKey: .location); try c.encode(notes, forKey: .notes)
    }
    public var qtyLeft: Double { max(qtyBought - qtyUsed - qtyReturned, 0) }
    public var leftValueCents: Cents { Cents((qtyLeft * Double(unitCostCents)).rounded()) }
    public var boughtValueCents: Cents { Cents((qtyBought * Double(unitCostCents)).rounded()) }
    public var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && qtyBought >= 0 && qtyUsed >= 0 && qtyReturned >= 0 && qtyUsed + qtyReturned <= qtyBought + 0.0001 }
}

/// A saved receipt or bill to add again; optionally repeating (insurance, utilities). Never posts on its own.
public struct EntryTemplate: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var name: String
    /// receipt, bill
    public var kind: String
    public var projectId: UUID?
    public var vendorId: UUID?
    public var categoryId: UUID?
    public var amountCents: Cents?
    public var paidByUserId: UUID?
    public var paymentMethod: String
    public var description: String
    /// none, monthly, quarterly, yearly
    public var `repeat`: String
    public var nextDue: Day?
    public var active: Bool
    public var createdBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, name: String, kind: String = "receipt", projectId: UUID? = nil, vendorId: UUID? = nil,
                categoryId: UUID? = nil, amountCents: Cents? = nil, paidByUserId: UUID? = nil, paymentMethod: String = "card",
                description: String = "", repeat: String = "none", nextDue: Day? = nil, active: Bool = true,
                createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.name = name; self.kind = kind; self.projectId = projectId; self.vendorId = vendorId
        self.categoryId = categoryId; self.amountCents = amountCents; self.paidByUserId = paidByUserId; self.paymentMethod = paymentMethod
        self.description = description; self.repeat = `repeat`; self.nextDue = nextDue; self.active = active
        self.createdBy = createdBy; self.createdAt = createdAt
    }
    enum CodingKeys: String, CodingKey {
        case id, workspaceId, name, kind, projectId, vendorId, categoryId, amountCents, paidByUserId, paymentMethod, description, `repeat`, nextDue, active, createdBy, createdAt
    }
    /// Writes every editable column, nulls included (clearing the amount or due date saves), never who/when.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(workspaceId, forKey: .workspaceId); try c.encode(name, forKey: .name)
        try c.encode(kind, forKey: .kind); try c.encode(projectId, forKey: .projectId); try c.encode(vendorId, forKey: .vendorId)
        try c.encode(categoryId, forKey: .categoryId); try c.encode(amountCents, forKey: .amountCents)
        try c.encode(paidByUserId, forKey: .paidByUserId); try c.encode(paymentMethod, forKey: .paymentMethod)
        try c.encode(description, forKey: .description); try c.encode(self.repeat, forKey: .repeat)
        try c.encode(nextDue, forKey: .nextDue); try c.encode(active, forKey: .active)
    }
    public static let repeats = [("none", "Doesn't repeat"), ("monthly", "Monthly"), ("quarterly", "Quarterly"), ("yearly", "Yearly")]
    public var repeatLabel: String { Self.repeats.first { $0.0 == self.repeat }?.1 ?? self.repeat }
}

// MARK: - Issue reports (migration 08)

/// What kind of problem a partner is flagging. Same values as the web app and the database check.
public enum IssueCategory: String, CaseIterable, Codable, Sendable {
    case wrongAmount = "wrong_amount", duplicate, wrongDetails = "wrong_details", missing, appError = "app_error", idea, other
    public var label: String {
        switch self {
        case .wrongAmount: "Wrong amount"
        case .duplicate: "Duplicate"
        case .wrongDetails: "Wrong property, vendor or category"
        case .missing: "Something missing"
        case .appError: "Error or something didn't work"
        case .idea: "Idea or request"
        case .other: "Other"
        }
    }
    public static func label(_ raw: String) -> String { IssueCategory(rawValue: raw)?.label ?? raw }
}

/// A problem a partner flagged with a record or the app, collected in one list until someone resolves it.
/// Reports never change money. Only status and resolution change after sending; the server sets who resolved it and when.
public struct IssueReport: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var category: String
    public var note: String
    public var recordKind: EntryKind?
    public var recordId: UUID?
    /// Where the partner was in the app, the last error shown, and the device, to help whoever fixes it.
    public var page: String
    public var errorText: String
    public var userAgent: String
    public var screenshotPath: String?
    public var screenshotName: String?
    /// open, resolved
    public var status: String
    public var resolution: String?
    public var resolvedBy: UUID?
    public var resolvedAt: String?
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?

    public init(id: UUID = UUID(), workspaceId: UUID, category: String = IssueCategory.other.rawValue, note: String,
                recordKind: EntryKind? = nil, recordId: UUID? = nil, page: String = "", errorText: String = "", userAgent: String = "",
                screenshotPath: String? = nil, screenshotName: String? = nil, status: String = "open", resolution: String? = nil,
                resolvedBy: UUID? = nil, resolvedAt: String? = nil, clientId: UUID? = nil, createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.category = category; self.note = note
        self.recordKind = recordKind; self.recordId = recordId; self.page = page; self.errorText = errorText; self.userAgent = userAgent
        self.screenshotPath = screenshotPath; self.screenshotName = screenshotName; self.status = status; self.resolution = resolution
        self.resolvedBy = resolvedBy; self.resolvedAt = resolvedAt; self.clientId = clientId; self.createdBy = createdBy; self.createdAt = createdAt
    }

    public var isOpen: Bool { status == "open" }
    public var ref: EntryRef? {
        guard let k = recordKind, let id = recordId else { return nil }
        return EntryRef(k, id)
    }
}
