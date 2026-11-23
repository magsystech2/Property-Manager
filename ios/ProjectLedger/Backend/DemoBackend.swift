import Foundation
import LedgerCore

/// DEMO MODE: sample LLC kept in memory on this phone. Nothing is uploaded or shared.
/// Applies the same rules as the server so balances behave exactly like live mode.
@MainActor
final class DemoBackend: LedgerBackend {
    var isDemo: Bool { true }
    private(set) var snapshot: LedgerSnapshot
    /// Which partner you're acting as (switchable, to try approvals).
    var actingAs: UUID = DemoData.partnerA
    var userId: UUID? { actingAs }
    var userEmail: String? { snapshot.members.first { $0.userId == actingAs }?.email }
    private var continuations: [UUID: AsyncStream<Void>.Continuation] = [:]
    private let filesDir: URL

    init() {
        snapshot = DemoData.snapshot()
        filesDir = FileManager.default.temporaryDirectory.appendingPathComponent("demo-files", isDirectory: true)
        try? FileManager.default.createDirectory(at: filesDir, withIntermediateDirectories: true)
    }

    private var ledger: Ledger { Ledger(snapshot) }
    private func now() -> String { ISO8601DateFormatter().string(from: Date()) }
    private func changed() { continuations.values.forEach { $0.yield() } }

    func restoreSession() async -> Bool { true }
    func signIn(email: String, password: String) async throws {}
    func signUp(email: String, password: String) async throws {}
    func signOut() async {}
    func myWorkspaces() async throws -> [Workspace] { [snapshot.workspace] }
    func acceptInvites(displayName: String) async throws -> Int { 0 }
    func createWorkspace(name: String, displayName: String) async throws -> UUID { snapshot.workspace.id }
    func load(workspace: UUID) async throws -> LedgerSnapshot { snapshot }

    func post(expense: Expense, allocations: [Allocation]) async throws {
        if snapshot.expenses.contains(where: { $0.id == expense.id }) { return }      // idempotent
        try Rules.checkExpense(expense, allocations: allocations)
        try checkPartner(expense.paidByUserId)
        var e = expense
        e.status = RecordStatus.posted; e.createdBy = actingAs; e.createdAt = now()
        snapshot.expenses.append(e)
        snapshot.allocations += allocations.map { var a = $0; a.expenseId = e.id; a.billId = nil; return a }
        audit("expenses", e.id, "insert")
        changed()
    }

    func post(bill: Bill, allocations: [Allocation]) async throws {
        if snapshot.bills.contains(where: { $0.id == bill.id }) { return }
        try Rules.checkBill(bill, allocations: allocations, in: ledger)
        var b = bill
        b.status = snapshot.workspace.requireReview ? RecordStatus.pendingReview : RecordStatus.posted
        b.createdBy = actingAs; b.createdAt = now()
        snapshot.bills.append(b)
        snapshot.allocations += allocations.map { var a = $0; a.billId = b.id; a.expenseId = nil; return a }
        audit("bills", b.id, "insert")
        changed()
    }

    func insert(_ record: NewRecord) async throws {
        let review = snapshot.workspace.requireReview
        switch record {
        case .payment(var p):
            guard !snapshot.payments.contains(where: { $0.id == p.id }) else { return }
            try Rules.checkPayment(p, in: ledger)
            try checkPartner(p.paidByUserId)
            p.status = RecordStatus.posted; p.createdBy = actingAs; p.createdAt = now()
            snapshot.payments.append(p); audit("bill_payments", p.id, "insert")
        case .reimbursement(var r, let items):
            guard !snapshot.reimbursements.contains(where: { $0.id == r.id }) else { return }
            if review { r.status = RecordStatus.requested; r.paidDate = nil }
            if r.status == RecordStatus.paid {
                if r.paidDate == nil { r.paidDate = Days.today }
                try Rules.checkReimbursementPaid(r, in: ledger)
            }
            r.createdBy = actingAs; r.createdAt = now()
            snapshot.reimbursements.append(r)
            snapshot.reimbursementItems += items
            audit("reimbursements", r.id, "insert")
        case .contribution(var c):
            guard !snapshot.contributions.contains(where: { $0.id == c.id }) else { return }
            guard c.amountCents > 0 else { throw LedgerError("Enter an amount greater than zero.") }
            c.status = RecordStatus.posted; c.createdBy = actingAs; c.createdAt = now()
            snapshot.contributions.append(c); audit("contributions", c.id, "insert")
        case .proceeds(var p):
            guard !snapshot.proceeds.contains(where: { $0.id == p.id }) else { return }
            guard p.amountCents > 0 else { throw LedgerError("Enter an amount greater than zero.") }
            p.status = RecordStatus.posted; p.createdBy = actingAs; p.createdAt = now()
            snapshot.proceeds.append(p); audit("sale_proceeds", p.id, "insert")
        case .commitment(var c):
            guard !snapshot.commitments.contains(where: { $0.id == c.id }) else { return }
            guard c.amountCents > 0 else { throw LedgerError("Enter an amount greater than zero.") }
            c.status = RecordStatus.posted; c.createdBy = actingAs; c.createdAt = now()
            snapshot.commitments.append(c); audit("commitments", c.id, "insert")
        case .changeOrder(var co):
            guard !snapshot.changeOrders.contains(where: { $0.id == co.id }) else { return }
            guard co.amountCents != 0 else { throw LedgerError("Enter a non-zero amount.") }
            co.status = review ? RecordStatus.pendingReview : RecordStatus.posted
            co.createdBy = actingAs; co.createdAt = now()
            snapshot.changeOrders.append(co); audit("change_orders", co.id, "insert")
        }
        changed()
    }

    func change(_ ref: EntryRef, _ change: StatusChange) async throws {
        let l = ledger
        switch change {
        case .void(let reason):
            try Rules.checkVoid(ref, reason: reason, in: l)
            try mutate(ref) { status, voidReason in
                guard status != RecordStatus.void else { throw LedgerError("Already void.") }
                status = RecordStatus.void; voidReason = reason
            }
            audit(ref.kind.table, ref.id, "void", reason: reason)
        case .approve:
            switch ref.kind {
            case .bill:
                guard let i = snapshot.bills.firstIndex(where: { $0.id == ref.id }), snapshot.bills[i].status == RecordStatus.pendingReview else { throw LedgerError("Nothing to approve.") }
                try Rules.checkApproval(creator: snapshot.bills[i].createdBy, approver: actingAs)
                snapshot.bills[i].status = RecordStatus.posted; snapshot.bills[i].approvedBy = actingAs; snapshot.bills[i].approvedAt = now()
            case .changeOrder:
                guard let i = snapshot.changeOrders.firstIndex(where: { $0.id == ref.id }), snapshot.changeOrders[i].status == RecordStatus.pendingReview else { throw LedgerError("Nothing to approve.") }
                try Rules.checkApproval(creator: snapshot.changeOrders[i].createdBy, approver: actingAs)
                snapshot.changeOrders[i].status = RecordStatus.posted; snapshot.changeOrders[i].approvedBy = actingAs; snapshot.changeOrders[i].approvedAt = now()
            case .reimbursement:
                guard let i = snapshot.reimbursements.firstIndex(where: { $0.id == ref.id }), snapshot.reimbursements[i].status == RecordStatus.requested else { throw LedgerError("Nothing to approve.") }
                try Rules.checkApproval(creator: snapshot.reimbursements[i].createdBy, partner: snapshot.reimbursements[i].partnerUserId, approver: actingAs)
                snapshot.reimbursements[i].status = RecordStatus.approved; snapshot.reimbursements[i].approvedBy = actingAs; snapshot.reimbursements[i].approvedAt = now()
            default: throw LedgerError("This record doesn't need approval.")
            }
            audit(ref.kind.table, ref.id, "approve")
        case .markPaid(let date, let method, let reference):
            guard let i = snapshot.reimbursements.firstIndex(where: { $0.id == ref.id }) else { throw LedgerError("Not found.") }
            let r = snapshot.reimbursements[i]
            guard r.status == RecordStatus.approved || (r.status == RecordStatus.requested && !snapshot.workspace.requireReview) else {
                throw LedgerError(r.status == RecordStatus.requested ? "Another partner must approve this first." : "Can't mark this paid.")
            }
            var paid = r
            paid.status = RecordStatus.paid; paid.paidDate = date; paid.paymentMethod = method; paid.reference = reference
            try Rules.checkReimbursementPaid(paid, in: l)
            snapshot.reimbursements[i] = paid
            audit("reimbursements", r.id, "paid")
        }
        changed()
    }

    private func mutate(_ ref: EntryRef, _ body: (inout String, inout String?) throws -> Void) throws {
        let who = actingAs, at = now()
        func apply<T: LedgerRecord>(_ arr: inout [T], _ set: (inout T, String, String?) -> Void) throws {
            guard let i = arr.firstIndex(where: { $0.id == ref.id }) else { throw LedgerError("Not found.") }
            var status = arr[i].status, reason = arr[i].voidReason
            try body(&status, &reason)
            set(&arr[i], status, reason)
        }
        switch ref.kind {
        case .expense: try apply(&snapshot.expenses) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        case .bill: try apply(&snapshot.bills) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        case .payment: try apply(&snapshot.payments) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        case .reimbursement: try apply(&snapshot.reimbursements) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        case .contribution: try apply(&snapshot.contributions) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        case .proceeds: try apply(&snapshot.proceeds) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        case .commitment: try apply(&snapshot.commitments) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        case .changeOrder: try apply(&snapshot.changeOrders) { $0.status = $1; $0.voidReason = $2; $0.voidedBy = who; $0.voidedAt = at }
        }
    }

    private func checkPartner(_ uid: UUID?) throws {
        if let uid, !snapshot.members.contains(where: { $0.userId == uid }) { throw LedgerError("That person isn't a partner.") }
    }

    private var auditId = 1000
    private func audit(_ table: String, _ id: UUID, _ action: String, reason: String? = nil) {
        auditId += 1
        snapshot.audit.append(AuditEntry(id: auditId, workspaceId: snapshot.workspace.id, tableName: table, recordId: id,
                                         action: action, actor: actingAs, at: now(), reason: reason))
    }

    func save(project: Project) async throws {
        if let i = snapshot.projects.firstIndex(where: { $0.id == project.id }) { snapshot.projects[i] = project } else { snapshot.projects.append(project) }
        audit("projects", project.id, "update"); changed()
    }
    func save(vendor: Vendor) async throws {
        if snapshot.vendors.contains(where: { $0.id != vendor.id && $0.name.lowercased() == vendor.name.lowercased() }) {
            throw LedgerError("A vendor named \(vendor.name) already exists.")
        }
        if let i = snapshot.vendors.firstIndex(where: { $0.id == vendor.id }) { snapshot.vendors[i] = vendor } else { snapshot.vendors.append(vendor) }
        changed()
    }
    func save(budget: ProjectBudget) async throws {
        snapshot.budgets.removeAll { $0.projectId == budget.projectId && $0.categoryId == budget.categoryId }
        snapshot.budgets.append(budget); changed()
    }
    func save(category: BudgetCategory) async throws {
        if let i = snapshot.categories.firstIndex(where: { $0.id == category.id }) { snapshot.categories[i] = category } else { snapshot.categories.append(category) }
        changed()
    }
    func save(workspace: Workspace) async throws {
        guard snapshot.members.first(where: { $0.userId == actingAs })?.isOwner == true else { throw LedgerError("Only an owner can change workspace settings.") }
        snapshot.workspace = workspace; changed()
    }
    func save(member: Member) async throws {
        guard let i = snapshot.members.firstIndex(where: { $0.userId == member.userId }) else { return }
        let me = snapshot.members.first { $0.userId == actingAs }
        if member.role != snapshot.members[i].role && me?.isOwner != true { throw LedgerError("Only an owner can change roles.") }
        snapshot.members[i] = member; changed()
    }
    func setAccess(member: Member, revoked: Bool) async throws {
        guard let i = snapshot.members.firstIndex(where: { $0.userId == member.userId }) else { return }
        let me = snapshot.members.first { $0.userId == actingAs }
        guard me?.isOwner == true, me?.hasAccess == true else { throw LedgerError("Only an owner can change who has access.") }
        if revoked && (snapshot.members[i].isOwner || member.userId == actingAs) {
            throw LedgerError("Change an owner to partner before removing their access.")
        }
        snapshot.members[i].accessRevokedAt = revoked ? now() : nil; changed()
    }
    func invite(email: String, role: String, workspace: UUID) async throws {
        snapshot.invites.append(Invite(workspaceId: workspace, email: email.lowercased(), role: role)); changed()
    }
    func cancelInvite(_ invite: Invite) async throws { snapshot.invites.removeAll { $0.id == invite.id }; changed() }

    func upload(_ data: Data, path: String, mimeType: String) async throws {
        let url = filesDir.appendingPathComponent(path.replacingOccurrences(of: "/", with: "_"))
        if !FileManager.default.fileExists(atPath: url.path) { try data.write(to: url) }
    }
    func add(attachment: Attachment) async throws {
        guard !snapshot.attachments.contains(where: { $0.clientId == attachment.clientId && attachment.clientId != nil }) else { return }
        var a = attachment; a.uploadedBy = actingAs; a.createdAt = now()
        snapshot.attachments.append(a); changed()
    }
    func fileURL(path: String) async throws -> URL {
        let url = filesDir.appendingPathComponent(path.replacingOccurrences(of: "/", with: "_"))
        guard FileManager.default.fileExists(atPath: url.path) else { throw LedgerError("Sample document (demo mode has no real file for this one).") }
        return url
    }
    func readVoice(_ transcript: String, projects: [Project], categories: [BudgetCategory]) async -> Suggestion? { nil }

    func changes(workspace: UUID) -> AsyncStream<Void> {
        let key = UUID()
        return AsyncStream { c in
            continuations[key] = c
            c.onTermination = { [weak self] _ in Task { @MainActor in self?.continuations[key] = nil } }
        }
    }

    func reset() { snapshot = DemoData.snapshot(); changed() }
}
