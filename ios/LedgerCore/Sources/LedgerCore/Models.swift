import Foundation

/// Money is always integer cents.
public typealias Cents = Int
/// Calendar day as "yyyy-MM-dd" (no time zone surprises).
public typealias Day = String

public enum RecordStatus {
    public static let pendingReview = "pending_review"
    public static let posted = "posted"
    public static let void = "void"
    // reimbursements
    public static let requested = "requested"
    public static let approved = "approved"
    public static let paid = "paid"
}

public enum PaymentMethod: String, CaseIterable, Codable, Sendable {
    case card, check, cash, ach, zelle, wire, other
    public var label: String {
        switch self {
        case .card: "Card"; case .check: "Check"; case .cash: "Cash"; case .ach: "ACH"
        case .zelle: "Zelle"; case .wire: "Wire"; case .other: "Other"
        }
    }
}

public struct Workspace: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var requireReview: Bool
    public init(id: UUID = UUID(), name: String, requireReview: Bool = false) {
        self.id = id; self.name = name; self.requireReview = requireReview
    }
}

public struct Member: Codable, Hashable, Identifiable, Sendable {
    public var workspaceId: UUID
    public var userId: UUID
    public var role: String          // owner, partner
    public var displayName: String
    public var email: String?
    /// Set when an owner removed this partner's access. They stay in the books (names, balances) but can't see the LLC.
    public var accessRevokedAt: String?
    public var id: UUID { userId }
    public var isOwner: Bool { role == "owner" }
    public var hasAccess: Bool { accessRevokedAt == nil }
    public init(workspaceId: UUID, userId: UUID, role: String, displayName: String, email: String? = nil, accessRevokedAt: String? = nil) {
        self.workspaceId = workspaceId; self.userId = userId; self.role = role; self.displayName = displayName; self.email = email
        self.accessRevokedAt = accessRevokedAt
    }
}

public struct Invite: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var email: String
    public var role: String
    public var acceptedAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, email: String, role: String = "partner", acceptedAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.email = email; self.role = role; self.acceptedAt = acceptedAt
    }
}

public struct BudgetCategory: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var name: String
    public var sortOrder: Int
    public var archived: Bool
    public init(id: UUID = UUID(), workspaceId: UUID, name: String, sortOrder: Int, archived: Bool = false) {
        self.id = id; self.workspaceId = workspaceId; self.name = name; self.sortOrder = sortOrder; self.archived = archived
    }
    public static let defaultNames = ["Acquisition", "Permits", "Demolition", "Framing", "Plumbing", "Electrical", "HVAC",
                                      "Labor", "Materials", "Equipment Rentals", "Utilities", "Financing", "Insurance",
                                      "Closing Costs"]
}

public struct Project: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var nickname: String
    public var address: String
    public var projectType: String   // flip, new_construction
    public var status: String        // planning, active, listed, sold, on_hold
    public var startDate: Day?
    public var targetCompleteDate: Day?
    public var targetSaleDate: Day?
    public var notes: String
    // Profit forecast inputs (all optional).
    public var expectedSaleCents: Cents?
    /// 600 = 6% of the sale price.
    public var sellingCostBps: Int?
    public var monthlyHoldingCents: Cents?
    public var loanBalanceCents: Cents?
    /// 1100 = 11% a year.
    public var loanRateBps: Int?
    public init(id: UUID = UUID(), workspaceId: UUID, nickname: String, address: String = "", projectType: String = "flip",
                status: String = "active", startDate: Day? = nil, targetCompleteDate: Day? = nil, targetSaleDate: Day? = nil, notes: String = "",
                expectedSaleCents: Cents? = nil, sellingCostBps: Int? = nil, monthlyHoldingCents: Cents? = nil,
                loanBalanceCents: Cents? = nil, loanRateBps: Int? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.nickname = nickname; self.address = address
        self.projectType = projectType; self.status = status; self.startDate = startDate
        self.targetCompleteDate = targetCompleteDate; self.targetSaleDate = targetSaleDate; self.notes = notes
        self.expectedSaleCents = expectedSaleCents; self.sellingCostBps = sellingCostBps; self.monthlyHoldingCents = monthlyHoldingCents
        self.loanBalanceCents = loanBalanceCents; self.loanRateBps = loanRateBps
    }
    public static let types = [("flip", "Flip"), ("new_construction", "New construction")]
    public static let statuses = [("planning", "Planning"), ("active", "Active"), ("listed", "Listed"), ("sold", "Sold"), ("on_hold", "On hold")]
    public var typeLabel: String { Self.types.first { $0.0 == projectType }?.1 ?? projectType }
    public var statusLabel: String { Self.statuses.first { $0.0 == status }?.1 ?? status }
    public var isActive: Bool { status != "sold" }
}

extension Project {
    /// Writes every column, nulls included, so clearing a date or a forecast input saves as empty.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(workspaceId, forKey: .workspaceId); try c.encode(nickname, forKey: .nickname)
        try c.encode(address, forKey: .address); try c.encode(projectType, forKey: .projectType); try c.encode(status, forKey: .status)
        try c.encode(startDate, forKey: .startDate); try c.encode(targetCompleteDate, forKey: .targetCompleteDate)
        try c.encode(targetSaleDate, forKey: .targetSaleDate); try c.encode(notes, forKey: .notes)
        try c.encode(expectedSaleCents, forKey: .expectedSaleCents); try c.encode(sellingCostBps, forKey: .sellingCostBps)
        try c.encode(monthlyHoldingCents, forKey: .monthlyHoldingCents); try c.encode(loanBalanceCents, forKey: .loanBalanceCents)
        try c.encode(loanRateBps, forKey: .loanRateBps)
    }
}

public struct ProjectBudget: Codable, Hashable, Sendable {
    public var workspaceId: UUID
    public var projectId: UUID
    public var categoryId: UUID
    public var amountCents: Cents
    public init(workspaceId: UUID, projectId: UUID, categoryId: UUID, amountCents: Cents) {
        self.workspaceId = workspaceId; self.projectId = projectId; self.categoryId = categoryId; self.amountCents = amountCents
    }
}

public struct Vendor: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var name: String
    public var kind: String        // contractor, supplier, utility, government, other
    public var contactName: String
    public var phone: String
    public var email: String
    public var address: String
    public var notes: String
    public init(id: UUID = UUID(), workspaceId: UUID, name: String, kind: String = "supplier", contactName: String = "",
                phone: String = "", email: String = "", address: String = "", notes: String = "") {
        self.id = id; self.workspaceId = workspaceId; self.name = name; self.kind = kind; self.contactName = contactName
        self.phone = phone; self.email = email; self.address = address; self.notes = notes
    }
    public static let kinds = ["contractor", "supplier", "utility", "government", "other"]
}

/// Fields every posted financial record carries.
public protocol LedgerRecord: Identifiable, Codable, Hashable, Sendable {
    var id: UUID { get }
    var status: String { get }
    var createdBy: UUID? { get }
    var createdAt: String? { get }
    var voidedBy: UUID? { get }
    var voidedAt: String? { get }
    var voidReason: String? { get }
}
public extension LedgerRecord {
    var isVoid: Bool { status == RecordStatus.void }
}

public struct Commitment: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var projectId: UUID
    public var vendorId: UUID
    public var categoryId: UUID
    public var description: String
    public var amountCents: Cents
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, projectId: UUID, vendorId: UUID, categoryId: UUID, description: String,
                amountCents: Cents, status: String = RecordStatus.posted, clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.projectId = projectId; self.vendorId = vendorId; self.categoryId = categoryId
        self.description = description; self.amountCents = amountCents; self.status = status; self.clientId = clientId
        self.createdBy = createdBy; self.createdAt = createdAt
    }
}

public struct ChangeOrder: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var commitmentId: UUID
    public var description: String
    public var amountCents: Cents
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var approvedBy: UUID?
    public var approvedAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, commitmentId: UUID, description: String, amountCents: Cents,
                status: String = RecordStatus.posted, clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.commitmentId = commitmentId; self.description = description
        self.amountCents = amountCents; self.status = status; self.clientId = clientId; self.createdBy = createdBy; self.createdAt = createdAt
    }
}

public struct Bill: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var projectId: UUID
    public var vendorId: UUID
    public var commitmentId: UUID?
    public var invoiceNumber: String
    public var billDate: Day
    public var dueDate: Day?
    public var description: String
    /// Free-text note (migration 07). Never changes amounts, so it can be edited after posting.
    public var notes: String?
    public var totalCents: Cents
    public var taxCents: Cents
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var approvedBy: UUID?
    public var approvedAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, projectId: UUID, vendorId: UUID, commitmentId: UUID? = nil,
                invoiceNumber: String = "", billDate: Day, dueDate: Day? = nil, description: String = "", notes: String? = nil,
                totalCents: Cents, taxCents: Cents = 0, status: String = RecordStatus.posted, clientId: UUID? = UUID(),
                createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.projectId = projectId; self.vendorId = vendorId
        self.commitmentId = commitmentId; self.invoiceNumber = invoiceNumber; self.billDate = billDate; self.dueDate = dueDate
        self.description = description; self.totalCents = totalCents; self.taxCents = taxCents; self.status = status
        self.notes = notes; self.clientId = clientId; self.createdBy = createdBy; self.createdAt = createdAt
    }
}

/// A receipt: a purchase that was already paid.
public struct Expense: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var projectId: UUID
    public var vendorId: UUID
    public var expenseDate: Day
    public var description: String
    /// Free-text note (migration 07). Never changes amounts, so it can be edited after posting.
    public var notes: String?
    public var totalCents: Cents
    public var taxCents: Cents
    public var isRefund: Bool
    /// nil = paid from the LLC account
    public var paidByUserId: UUID?
    public var paymentMethod: String
    public var reference: String
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, projectId: UUID, vendorId: UUID, expenseDate: Day, description: String = "", notes: String? = nil,
                totalCents: Cents, taxCents: Cents = 0, isRefund: Bool = false, paidByUserId: UUID?, paymentMethod: String = "card",
                reference: String = "", status: String = RecordStatus.posted, clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.projectId = projectId; self.vendorId = vendorId
        self.expenseDate = expenseDate; self.description = description; self.notes = notes; self.totalCents = totalCents; self.taxCents = taxCents
        self.isRefund = isRefund; self.paidByUserId = paidByUserId; self.paymentMethod = paymentMethod; self.reference = reference
        self.status = status; self.clientId = clientId; self.createdBy = createdBy; self.createdAt = createdAt
    }
    /// Effect on project cost: refunds reduce it.
    public var signedCents: Cents { isRefund ? -totalCents : totalCents }
}

public struct Allocation: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var billId: UUID?
    public var expenseId: UUID?
    public var categoryId: UUID
    public var amountCents: Cents
    public init(id: UUID = UUID(), workspaceId: UUID, billId: UUID? = nil, expenseId: UUID? = nil, categoryId: UUID, amountCents: Cents) {
        self.id = id; self.workspaceId = workspaceId; self.billId = billId; self.expenseId = expenseId
        self.categoryId = categoryId; self.amountCents = amountCents
    }
}

public struct BillPayment: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var billId: UUID
    /// payment, credit (vendor credit memo), refund (vendor returned cash)
    public var kind: String
    public var paymentDate: Day
    public var amountCents: Cents
    /// nil = LLC account
    public var paidByUserId: UUID?
    public var paymentMethod: String
    public var reference: String
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, billId: UUID, kind: String = "payment", paymentDate: Day, amountCents: Cents,
                paidByUserId: UUID?, paymentMethod: String = "check", reference: String = "", status: String = RecordStatus.posted,
                clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.billId = billId; self.kind = kind; self.paymentDate = paymentDate
        self.amountCents = amountCents; self.paidByUserId = paidByUserId; self.paymentMethod = paymentMethod
        self.reference = reference; self.status = status; self.clientId = clientId; self.createdBy = createdBy; self.createdAt = createdAt
    }
    /// Effect on cash paid to the vendor.
    public var paidEffect: Cents { kind == "payment" ? amountCents : kind == "refund" ? -amountCents : 0 }
    /// Effect on the bill's outstanding balance.
    public var outstandingEffect: Cents { kind == "refund" ? amountCents : -amountCents }
    public var kindLabel: String { kind == "credit" ? "Vendor credit" : kind == "refund" ? "Vendor refund" : "Payment" }
}

public struct Reimbursement: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var partnerUserId: UUID
    public var amountCents: Cents
    public var requestDate: Day
    public var paidDate: Day?
    /// requested, approved, paid, void
    public var status: String
    public var paymentMethod: String
    public var reference: String
    public var notes: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var approvedBy: UUID?
    public var approvedAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, partnerUserId: UUID, amountCents: Cents, requestDate: Day, paidDate: Day? = nil,
                status: String, paymentMethod: String = "ach", reference: String = "", notes: String = "",
                clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.partnerUserId = partnerUserId; self.amountCents = amountCents
        self.requestDate = requestDate; self.paidDate = paidDate; self.status = status; self.paymentMethod = paymentMethod
        self.reference = reference; self.notes = notes; self.clientId = clientId; self.createdBy = createdBy; self.createdAt = createdAt
    }
    public var isPaid: Bool { status == RecordStatus.paid }
    public var isPending: Bool { status == RecordStatus.requested || status == RecordStatus.approved }
}

public struct ReimbursementItem: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var reimbursementId: UUID
    public var expenseId: UUID?
    public var billPaymentId: UUID?
    public var amountCents: Cents
    public init(id: UUID = UUID(), workspaceId: UUID, reimbursementId: UUID, expenseId: UUID? = nil, billPaymentId: UUID? = nil, amountCents: Cents) {
        self.id = id; self.workspaceId = workspaceId; self.reimbursementId = reimbursementId
        self.expenseId = expenseId; self.billPaymentId = billPaymentId; self.amountCents = amountCents
    }
}

public struct Contribution: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var partnerUserId: UUID
    public var projectId: UUID?
    public var amountCents: Cents
    public var contributionDate: Day
    public var paymentMethod: String
    public var reference: String
    public var notes: String
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, partnerUserId: UUID, projectId: UUID? = nil, amountCents: Cents,
                contributionDate: Day, paymentMethod: String = "ach", reference: String = "", notes: String = "",
                status: String = RecordStatus.posted, clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.partnerUserId = partnerUserId; self.projectId = projectId
        self.amountCents = amountCents; self.contributionDate = contributionDate; self.paymentMethod = paymentMethod
        self.reference = reference; self.notes = notes; self.status = status; self.clientId = clientId
        self.createdBy = createdBy; self.createdAt = createdAt
    }
}

public struct SaleProceed: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var projectId: UUID
    public var amountCents: Cents
    public var saleDate: Day
    public var notes: String
    /// Optional sale detail: when the sale price is given, amountCents (net) = gross − selling costs.
    public var grossPriceCents: Cents?
    public var sellingCostsCents: Cents?
    /// Paid to the lender at closing. Not a cost; it only shows how much cash is left to distribute.
    public var loanPayoffCents: Cents?
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, projectId: UUID, amountCents: Cents, saleDate: Day, notes: String = "",
                grossPriceCents: Cents? = nil, sellingCostsCents: Cents? = nil, loanPayoffCents: Cents? = nil,
                status: String = RecordStatus.posted, clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.projectId = projectId; self.amountCents = amountCents
        self.grossPriceCents = grossPriceCents; self.sellingCostsCents = sellingCostsCents; self.loanPayoffCents = loanPayoffCents
        self.saleDate = saleDate; self.notes = notes; self.status = status; self.clientId = clientId
        self.createdBy = createdBy; self.createdAt = createdAt
    }
}

/// Money the LLC pays out to a partner from a project (return of capital and profit). Posted or void, never edited.
public struct Distribution: LedgerRecord {
    public var id: UUID
    public var workspaceId: UUID
    public var partnerUserId: UUID
    public var projectId: UUID?
    public var amountCents: Cents
    public var distributionDate: Day
    public var paymentMethod: String
    public var reference: String
    public var notes: String
    public var status: String
    public var clientId: UUID?
    public var createdBy: UUID?
    public var createdAt: String?
    public var voidedBy: UUID?
    public var voidedAt: String?
    public var voidReason: String?
    public init(id: UUID = UUID(), workspaceId: UUID, partnerUserId: UUID, projectId: UUID?, amountCents: Cents, distributionDate: Day,
                paymentMethod: String = "ach", reference: String = "", notes: String = "", status: String = RecordStatus.posted,
                clientId: UUID? = UUID(), createdBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.partnerUserId = partnerUserId; self.projectId = projectId
        self.amountCents = amountCents; self.distributionDate = distributionDate; self.paymentMethod = paymentMethod
        self.reference = reference; self.notes = notes; self.status = status; self.clientId = clientId
        self.createdBy = createdBy; self.createdAt = createdAt
    }
}

public struct Attachment: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var workspaceId: UUID
    public var storagePath: String
    public var filename: String
    public var mimeType: String
    public var sizeBytes: Int
    public var expenseId: UUID?
    public var billId: UUID?
    public var billPaymentId: UUID?
    public var reimbursementId: UUID?
    public var contributionId: UUID?
    public var commitmentId: UUID?
    public var vendorId: UUID?
    public var projectId: UUID?
    public var clientId: UUID?
    public var uploadedBy: UUID?
    public var createdAt: String?
    public init(id: UUID = UUID(), workspaceId: UUID, storagePath: String, filename: String, mimeType: String, sizeBytes: Int,
                link: EntryRef? = nil, clientId: UUID? = UUID(), uploadedBy: UUID? = nil, createdAt: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.storagePath = storagePath; self.filename = filename
        self.mimeType = mimeType; self.sizeBytes = sizeBytes; self.clientId = clientId; self.uploadedBy = uploadedBy; self.createdAt = createdAt
        if let link { self.link(to: link) }
    }
    public mutating func link(to ref: EntryRef) {
        switch ref.kind {
        case .expense: expenseId = ref.id
        case .bill: billId = ref.id
        case .payment: billPaymentId = ref.id
        case .reimbursement: reimbursementId = ref.id
        case .contribution: contributionId = ref.id
        case .commitment, .changeOrder: commitmentId = ref.id
        case .proceeds, .distribution: break   // linked to the project by the caller
        }
    }
    public var isImage: Bool { mimeType.hasPrefix("image/") }
}

public struct AuditEntry: Codable, Hashable, Identifiable, Sendable {
    public var id: Int
    public var workspaceId: UUID
    public var tableName: String
    public var recordId: UUID?
    public var action: String
    public var actor: UUID?
    public var at: String
    public var reason: String?
    public init(id: Int, workspaceId: UUID, tableName: String, recordId: UUID?, action: String, actor: UUID?, at: String, reason: String? = nil) {
        self.id = id; self.workspaceId = workspaceId; self.tableName = tableName; self.recordId = recordId
        self.action = action; self.actor = actor; self.at = at; self.reason = reason
    }
}

/// Everything the app shows, for one workspace.
public struct LedgerSnapshot: Codable, Sendable {
    public var workspace: Workspace
    public var members: [Member] = []
    public var invites: [Invite] = []
    public var categories: [BudgetCategory] = []
    public var projects: [Project] = []
    public var budgets: [ProjectBudget] = []
    public var vendors: [Vendor] = []
    public var commitments: [Commitment] = []
    public var changeOrders: [ChangeOrder] = []
    public var bills: [Bill] = []
    public var expenses: [Expense] = []
    public var allocations: [Allocation] = []
    public var payments: [BillPayment] = []
    public var reimbursements: [Reimbursement] = []
    public var reimbursementItems: [ReimbursementItem] = []
    public var contributions: [Contribution] = []
    public var proceeds: [SaleProceed] = []
    public var attachments: [Attachment] = []
    public var audit: [AuditEntry] = []
    // Planning and review (migration 05)
    public var inboxItems: [InboxItem] = []
    public var statementLines: [StatementLine] = []
    public var statementMatches: [StatementMatch] = []
    public var claims: [Claim] = []
    public var scheduledDraws: [ScheduledDraw] = []
    public var cashBalances: [CashBalance] = []
    // Sale, profit split, materials, templates (migration 06)
    public var profitShares: [ProfitShare] = []
    public var distributions: [Distribution] = []
    public var materials: [Material] = []
    public var entryTemplates: [EntryTemplate] = []
    public init(workspace: Workspace) { self.workspace = workspace }
}
