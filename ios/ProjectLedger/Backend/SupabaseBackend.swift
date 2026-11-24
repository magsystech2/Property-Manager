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
    /// The workspace last loaded (the profit split RPC needs it).
    private var currentWorkspace: UUID?

    init(url: URL, anonKey: String) {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        #if targetEnvironment(macCatalyst)
        // On the Mac, a locally signed build can't use the keychain without a developer team, so the sign-in
        // session is kept in a file in this app's Application Support folder instead.
        client = SupabaseClient(supabaseURL: url, supabaseKey: anonKey,
                                options: SupabaseClientOptions(db: .init(encoder: encoder, decoder: decoder),
                                                               auth: .init(storage: FileAuthStorage())))
        #else
        client = SupabaseClient(supabaseURL: url, supabaseKey: anonKey,
                                options: SupabaseClientOptions(db: .init(encoder: encoder, decoder: decoder)))
        #endif
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
                try await self.client.from(table).select().eq("workspace_id", value: id).limit(10000).execute().value
            }
            let wsRows: [Workspace] = try await self.client.from("workspaces").select().eq("id", value: id).execute().value
            guard let workspace = wsRows.first else { throw BackendError.server("You don't have access to this workspace.") }
            var s = LedgerSnapshot(workspace: workspace)
            self.currentWorkspace = ws
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
            // Tables from migrations 05 and 06; an older database without them still loads.
            async let inbox = rows("inbox_items", InboxItem.self)
            async let lines = rows("statement_lines", StatementLine.self)
            async let matches = rows("statement_matches", StatementMatch.self)
            async let claims = rows("claims", Claim.self)
            async let draws = rows("scheduled_draws", ScheduledDraw.self)
            async let cash = rows("cash_balances", CashBalance.self)
            async let shares = rows("profit_shares", ProfitShare.self)
            async let distributions = rows("distributions", Distribution.self)
            async let materials = rows("materials", Material.self)
            async let templates = rows("entry_templates", EntryTemplate.self)
            s.inboxItems = (try? await inbox) ?? []; s.statementLines = (try? await lines) ?? []
            s.statementMatches = (try? await matches) ?? []; s.claims = (try? await claims) ?? []
            s.scheduledDraws = (try? await draws) ?? []; s.cashBalances = (try? await cash) ?? []
            s.profitShares = (try? await shares) ?? []; s.distributions = (try? await distributions) ?? []
            s.materials = (try? await materials) ?? []; s.entryTemplates = (try? await templates) ?? []
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
            case .distribution(let d): try await self.insertOnce("distributions", d)
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

    // MARK: Inbox, statements, review, cash, sale, materials, templates

    /// Sends the given keys with explicit nulls (a plain Encodable struct would leave nil keys out).
    private struct Patch: Encodable {
        var values: [String: String?]
        struct Key: CodingKey {
            var stringValue: String; var intValue: Int? { nil }
            init(_ s: String) { stringValue = s }
            init?(stringValue: String) { self.stringValue = stringValue }
            init?(intValue: Int) { nil }
        }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: Key.self)
            for (k, v) in values { if let v { try c.encode(v, forKey: Key(k)) } else { try c.encodeNil(forKey: Key(k)) } }
        }
    }
    private struct ShareParam: Encodable { let partnerUserId: UUID; let shareBps: Int }
    private struct SharesParams: Encodable { let pWorkspace: UUID; let pProject: UUID?
        let pShares: [ShareParam]
        enum CodingKeys: String, CodingKey { case pWorkspace, pProject, pShares }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(pWorkspace, forKey: .pWorkspace); try c.encode(pProject, forKey: .pProject); try c.encode(pShares, forKey: .pShares)
        }
    }

    private func update(_ table: String, _ id: UUID, _ patch: [String: String?], denied: String) async throws {
        let rows: [IdRow] = try await client.from(table).update(Patch(values: patch)).eq("id", value: id.uuidString).select("id").execute().value
        if rows.isEmpty { throw BackendError.server(denied) }
    }

    @discardableResult
    func perform(_ op: PlanningOp) async throws -> Int {
        try await wrap {
            let c = self.client
            switch op {
            case .addInbox(var i):
                i.createdBy = nil; i.createdAt = nil; i.handledBy = nil; i.handledAt = nil
                try await self.insertOnce("inbox_items", i)
            case .fileInbox(let id, let expenseId, let billId):
                var p: [String: String?] = ["status": "filed"]
                if let expenseId { p["filed_expense_id"] = expenseId.uuidString }
                if let billId { p["filed_bill_id"] = billId.uuidString }
                try await self.update("inbox_items", id, p, denied: "You don't have permission to change this inbox item.")
            case .dismissInbox(let id, let reason):
                try await self.update("inbox_items", id, ["status": "dismissed", "dismiss_reason": reason], denied: "You don't have permission to change this inbox item.")
            case .reopenInbox(let id):
                try await self.update("inbox_items", id, ["status": "new", "dismiss_reason": nil], denied: "You don't have permission to change this inbox item.")
            case .importLines(let lines):
                var added = 0
                for start in stride(from: 0, to: lines.count, by: 500) {
                    let chunk = lines[start..<min(start + 500, lines.count)].map { l -> StatementLine in
                        var x = l; x.createdBy = nil; x.createdAt = nil; x.handledBy = nil; x.handledAt = nil; x.ignoreReason = nil; return x
                    }
                    let ids: [IdRow] = try await c.from("statement_lines").upsert(Array(chunk), onConflict: "workspace_id,fingerprint", ignoreDuplicates: true)
                        .select("id").execute().value
                    added += ids.count
                }
                return added
            case .setLineStatus(let id, let status, let reason):
                try await self.update("statement_lines", id, ["status": status, "ignore_reason": status == "ignored" ? reason : nil],
                                      denied: "You don't have permission to change this statement line.")
            case .setLineOwner(let id, let owner):
                try await self.update("statement_lines", id, ["account_owner": owner?.uuidString], denied: "You don't have permission to change this statement line.")
            case .addMatch(var m):
                m.createdBy = nil; m.createdAt = nil
                try await c.from("statement_matches").upsert(m, onConflict: "id", ignoreDuplicates: true).execute()
            case .removeMatch(let id):
                try await c.from("statement_matches").delete().eq("id", value: id.uuidString).execute()
            case .claim(var cl):
                cl.claimedAt = nil
                try await c.from("claims").insert(cl).execute()
            case .releaseClaim(let id):
                try await c.from("claims").delete().eq("id", value: id.uuidString).execute()
            case .saveDraw(var d):
                d.createdBy = nil; d.createdAt = nil
                try await c.from("scheduled_draws").upsert(d, onConflict: "id").execute()
            case .deleteDraw(let id):
                try await c.from("scheduled_draws").delete().eq("id", value: id.uuidString).execute()
            case .addCashBalance(var b):
                b.createdBy = nil; b.createdAt = nil
                try await c.from("cash_balances").insert(b).execute()
            case .setProfitShares(let projectId, let shares):
                guard let ws = self.currentWorkspace else { throw BackendError.notSignedIn }
                let p = SharesParams(pWorkspace: ws, pProject: projectId, pShares: shares.map { ShareParam(partnerUserId: $0.partnerUserId, shareBps: $0.shareBps) })
                try await c.rpc("set_profit_shares", params: p).execute()
            case .saveMaterial(let m):
                try await c.from("materials").upsert(m, onConflict: "id").execute()
            case .deleteMaterial(let id):
                try await c.from("materials").delete().eq("id", value: id.uuidString).execute()
            case .saveTemplate(let t):
                try await c.from("entry_templates").upsert(t, onConflict: "id").execute()
            case .deleteTemplate(let id):
                try await c.from("entry_templates").delete().eq("id", value: id.uuidString).execute()
            }
            return 0
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
        if message.contains("claims_workspace_id_item_kind_item_id_key") { return "Someone already claimed this. Refresh to see who." }
        if message.contains("statement_matches_expense_uq") || message.contains("statement_matches_payment_uq") { return "That record is already matched to a statement line." }
        if message.contains("row-level security") { return "You don't have access to do that in this workspace." }
        return message
    }
}

#if targetEnvironment(macCatalyst)
/// Sign-in session storage for the Mac app: one small file per key, readable only by this user.
struct FileAuthStorage: AuthLocalStorage {
    private var dir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("ProjectLedger/auth", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return d
    }
    private func url(_ key: String) -> URL { dir.appendingPathComponent(key.replacingOccurrences(of: "/", with: "_")) }
    func store(key: String, value: Data) throws {
        try value.write(to: url(key), options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url(key).path)
    }
    func retrieve(key: String) throws -> Data? { try? Data(contentsOf: url(key)) }
    func remove(key: String) throws { try? FileManager.default.removeItem(at: url(key)) }
}
#endif
