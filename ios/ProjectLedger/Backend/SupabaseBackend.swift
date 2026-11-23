import Foundation
import Supabase
import LedgerCore

/// LIVE MODE: shared data in your Supabase project. Access rules are enforced by the database
/// (row-level security + triggers), so the app can't bypass them.
@MainActor
final class SupabaseBackend: LedgerBackend {
    let client: SupabaseClient
    var isDemo: Bool { false }
    var userId: UUID? { client.auth.currentUser?.id }
    var userEmail: String? { client.auth.currentUser?.email }
    private var channels: [RealtimeChannelV2] = []

    init(url: URL, anonKey: String) {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        client = SupabaseClient(supabaseURL: url, supabaseKey: anonKey,
                                options: SupabaseClientOptions(db: .init(encoder: encoder, decoder: decoder)))
    }

    // MARK: Auth

    func restoreSession() async -> Bool {
        (try? await client.auth.session) != nil
    }
    func signIn(email: String, password: String) async throws {
        try await wrap { _ = try await self.client.auth.signIn(email: email, password: password) }
    }
    func signUp(email: String, password: String) async throws {
        try await wrap { _ = try await self.client.auth.signUp(email: email, password: password) }
    }
    func signOut() async {
        try? await client.auth.signOut()
        for c in channels { await c.unsubscribe() }
        channels = []
    }

    // MARK: Workspace

    func myWorkspaces() async throws -> [Workspace] {
        try await wrap { try await self.client.from("workspaces").select().execute().value }
    }

    func acceptInvites(displayName: String) async throws -> Int {
        try await wrap {
            let ids: [UUID] = try await self.client.rpc("accept_invites", params: ["p_display_name": displayName]).execute().value
            return ids.count
        }
    }

    func createWorkspace(name: String, displayName: String) async throws -> UUID {
        try await wrap {
            try await self.client.rpc("create_workspace", params: ["p_name": name, "p_display_name": displayName]).execute().value
        }
    }

    func load(workspace ws: UUID) async throws -> LedgerSnapshot {
        try await wrap {
            let id = ws.uuidString
            func rows<T: Decodable & Sendable>(_ table: String, _ type: T.Type) async throws -> [T] {
                try await self.client.from(table).select().eq("workspace_id", value: id).execute().value
            }
            let wsRows: [Workspace] = try await self.client.from("workspaces").select().eq("id", value: id).execute().value
            guard let workspace = wsRows.first else { throw BackendError.server("You don't have access to this workspace.") }
            var s = LedgerSnapshot(workspace: workspace)
            async let members = rows("workspace_members", Member.self)
            async let categories = rows("budget_categories", BudgetCategory.self)
            async let projects = rows("projects", Project.self)
            async let budgets = rows("project_budgets", ProjectBudget.self)
            async let vendors = rows("vendors", Vendor.self)
            async let commitments = rows("commitments", Commitment.self)
            async let changeOrders = rows("change_orders", ChangeOrder.self)
            async let bills = rows("bills", Bill.self)
            async let expenses = rows("expenses", Expense.self)
            async let allocations = rows("allocations", Allocation.self)
            async let payments = rows("bill_payments", BillPayment.self)
            async let reimbursements = rows("reimbursements", Reimbursement.self)
            async let items = rows("reimbursement_items", ReimbursementItem.self)
            async let contributions = rows("contributions", Contribution.self)
            async let proceeds = rows("sale_proceeds", SaleProceed.self)
            async let attachments = rows("attachments", Attachment.self)
            async let invites = rows("invites", Invite.self)
            let audit: [AuditEntry] = try await self.client.from("audit_log").select("id,workspace_id,table_name,record_id,action,actor,at,reason")
                .eq("workspace_id", value: id).order("id", ascending: false).limit(1000).execute().value
            s.members = try await members; s.categories = try await categories; s.projects = try await projects
            s.budgets = try await budgets; s.vendors = try await vendors; s.commitments = try await commitments
            s.changeOrders = try await changeOrders; s.bills = try await bills; s.expenses = try await expenses
            s.allocations = try await allocations; s.payments = try await payments; s.reimbursements = try await reimbursements
            s.reimbursementItems = try await items; s.contributions = try await contributions; s.proceeds = try await proceeds
            s.attachments = try await attachments; s.invites = (try? await invites) ?? []; s.audit = audit
            return s
        }
    }

    // MARK: Posting

    private struct AllocationParam: Encodable { let categoryId: UUID; let amountCents: Int }
    private struct PostParams<T: Encodable>: Encodable { let pTable: String; let pRecord: T; let pAllocations: [AllocationParam] }

    func post(expense: Expense, allocations: [Allocation]) async throws {
        try Rules.checkExpense(expense, allocations: allocations)
        try await wrap {
            let p = PostParams(pTable: "expenses", pRecord: expense,
                               pAllocations: allocations.map { AllocationParam(categoryId: $0.categoryId, amountCents: $0.amountCents) })
            _ = try await self.client.rpc("post_with_allocations", params: p).execute()
        }
    }

    func post(bill: Bill, allocations: [Allocation]) async throws {
        try await wrap {
            let p = PostParams(pTable: "bills", pRecord: bill,
                               pAllocations: allocations.map { AllocationParam(categoryId: $0.categoryId, amountCents: $0.amountCents) })
            _ = try await self.client.rpc("post_with_allocations", params: p).execute()
        }
    }

    /// Insert that is safe to repeat: a second submission with the same client_id is ignored.
    private func insertOnce<T: Encodable & Sendable>(_ table: String, _ value: T) async throws {
        try await client.from(table).upsert(value, onConflict: "client_id", ignoreDuplicates: true).execute()
    }

    func insert(_ record: NewRecord) async throws {
        try await wrap {
            switch record {
            case .payment(let p): try await self.insertOnce("bill_payments", p)
            case .reimbursement(let r, let items):
                try await self.insertOnce("reimbursements", r)
                if !items.isEmpty {
                    try await self.client.from("reimbursement_items").upsert(items, onConflict: "id", ignoreDuplicates: true).execute()
                }
            case .contribution(let c): try await self.insertOnce("contributions", c)
            case .proceeds(let p): try await self.insertOnce("sale_proceeds", p)
            case .commitment(let c): try await self.insertOnce("commitments", c)
            case .changeOrder(let c): try await self.insertOnce("change_orders", c)
            }
        }
    }

    private struct VoidUpdate: Encodable { let status = "void"; let voidReason: String }
    private struct StatusUpdate: Encodable { let status: String }
    private struct PaidUpdate: Encodable { let status = "paid"; let paidDate: String; let paymentMethod: String; let reference: String }
    private struct IdRow: Decodable { let id: UUID }

    func change(_ ref: EntryRef, _ change: StatusChange) async throws {
        try await wrap {
            let q = self.client.from(ref.kind.table)
            let updated: [IdRow]
            switch change {
            case .void(let reason):
                updated = try await q.update(VoidUpdate(voidReason: reason)).eq("id", value: ref.id.uuidString).select("id").execute().value
            case .approve:
                let next = ref.kind == .reimbursement ? "approved" : "posted"
                updated = try await q.update(StatusUpdate(status: next)).eq("id", value: ref.id.uuidString).select("id").execute().value
            case .markPaid(let date, let method, let reference):
                updated = try await q.update(PaidUpdate(paidDate: date, paymentMethod: method, reference: reference))
                    .eq("id", value: ref.id.uuidString).select("id").execute().value
            }
            if updated.isEmpty { throw BackendError.server("You don't have permission to change this record.") }
        }
    }

    // MARK: Reference data

    func save(project: Project) async throws {
        try await wrap { try await self.client.from("projects").upsert(project, onConflict: "id").execute() }
    }
    func save(vendor: Vendor) async throws {
        try await wrap { try await self.client.from("vendors").upsert(vendor, onConflict: "id").execute() }
    }
    func save(budget: ProjectBudget) async throws {
        try await wrap { try await self.client.from("project_budgets").upsert(budget, onConflict: "project_id,category_id").execute() }
    }
    func save(category: BudgetCategory) async throws {
        try await wrap { try await self.client.from("budget_categories").upsert(category, onConflict: "id").execute() }
    }
    private struct WorkspaceUpdate: Encodable { let name: String; let requireReview: Bool }
    func save(workspace: Workspace) async throws {
        try await wrap {
            let rows: [IdRow] = try await self.client.from("workspaces").update(WorkspaceUpdate(name: workspace.name, requireReview: workspace.requireReview))
                .eq("id", value: workspace.id.uuidString).select("id").execute().value
            if rows.isEmpty { throw BackendError.server("Only an owner can change workspace settings.") }
        }
    }
    private struct MemberUpdate: Encodable { let displayName: String; let role: String }
    func save(member: Member) async throws {
        try await wrap {
            try await self.client.from("workspace_members").update(MemberUpdate(displayName: member.displayName, role: member.role))
                .eq("workspace_id", value: member.workspaceId.uuidString).eq("user_id", value: member.userId.uuidString).execute()
        }
    }
    /// Encodes `access_revoked_at` even when nil, so restoring access writes an explicit null.
    private struct AccessUpdate: Encodable {
        let accessRevokedAt: Date?
        enum CodingKeys: String, CodingKey { case accessRevokedAt }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            if let d = accessRevokedAt { try c.encode(ISO8601DateFormatter().string(from: d), forKey: .accessRevokedAt) }
            else { try c.encodeNil(forKey: .accessRevokedAt) }
        }
    }
    func setAccess(member: Member, revoked: Bool) async throws {
        try await wrap {
            try await self.client.from("workspace_members").update(AccessUpdate(accessRevokedAt: revoked ? Date() : nil))
                .eq("workspace_id", value: member.workspaceId.uuidString).eq("user_id", value: member.userId.uuidString).execute()
        }
    }
    func invite(email: String, role: String, workspace: UUID) async throws {
        try await wrap {
            try await self.client.from("invites").insert(Invite(workspaceId: workspace, email: email.lowercased().trimmingCharacters(in: .whitespaces), role: role)).execute()
        }
    }
    func cancelInvite(_ invite: Invite) async throws {
        try await wrap { try await self.client.from("invites").delete().eq("id", value: invite.id.uuidString).execute() }
    }

    // MARK: Files

    func upload(_ data: Data, path: String, mimeType: String) async throws {
        do {
            _ = try await client.storage.from("attachments").upload(path, data: data, options: FileOptions(contentType: mimeType))
        } catch {
            // Already uploaded by an earlier attempt: fine.
            if "\(error)".localizedCaseInsensitiveContains("exists") || "\(error)".contains("409") { return }
            throw map(error)
        }
    }
    func add(attachment: Attachment) async throws {
        try await wrap { try await self.insertOnce("attachments", attachment) }
    }
    func fileURL(path: String) async throws -> URL {
        try await wrap { try await self.client.storage.from("attachments").createSignedURL(path: path, expiresIn: 3600) }
    }

    // MARK: Voice

    private struct VoiceRequest: Encodable { let transcript: String; let projects: [String]; let categories: [String]; let today: String }
    private struct VoiceResponse: Decodable {
        let vendor: String?; let date: String?; let total: Double?; let tax: Double?; let description: String?
        let project: String?; let category: String?; let payer: String?; let paymentMethod: String?; let invoiceNumber: String?
    }
    func readVoice(_ transcript: String, projects: [Project], categories: [BudgetCategory]) async -> Suggestion? {
        let req = VoiceRequest(transcript: transcript, projects: projects.map(\.nickname), categories: categories.map(\.name), today: Days.today)
        let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let r: VoiceResponse = try? await client.functions.invoke("parse-expense", options: FunctionInvokeOptions(body: req), decoder: decoder) else {
            return nil
        }
        var s = Suggestion()
        s.vendorName = r.vendor
        s.date = r.date
        s.totalCents = r.total.map { Int(($0 * 100).rounded()) }
        s.taxCents = r.tax.map { Int(($0 * 100).rounded()) }
        s.description = r.description
        s.projectId = projects.first { $0.nickname == r.project }?.id
        s.categoryId = categories.first { $0.name == r.category }?.id
        s.paidByMe = r.payer.map { $0 == "me" }
        s.paymentMethod = r.paymentMethod
        s.invoiceNumber = r.invoiceNumber
        return s
    }

    // MARK: Live updates

    func changes(workspace: UUID) -> AsyncStream<Void> {
        let channel = client.channel("ledger-\(workspace.uuidString)")
        channels.append(channel)
        let stream = channel.postgresChange(AnyAction.self, schema: "public")
        return AsyncStream { continuation in
            let task = Task {
                await channel.subscribe()
                for await _ in stream { continuation.yield() }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Errors

    private func wrap<T>(_ body: () async throws -> T) async throws -> T {
        do { return try await body() } catch { throw map(error) }
    }

    private func map(_ error: Error) -> Error {
        if error is LedgerError || error is BackendError { return error }
        if (error as NSError).domain == NSURLErrorDomain { return BackendError.offline(error.localizedDescription) }
        if let pg = error as? PostgrestError { return BackendError.server(friendly(pg.message)) }
        if let auth = error as? AuthError { return BackendError.server(auth.localizedDescription) }
        return BackendError.server(error.localizedDescription)
    }

    private func friendly(_ message: String) -> String {
        if message.contains("bills_invoice_uq") { return "That invoice number from this vendor is already entered." }
        if message.contains("vendors_name_uq") { return "A vendor with that name already exists." }
        if message.contains("row-level security") { return "You don't have access to do that in this workspace." }
        return message
    }
}
