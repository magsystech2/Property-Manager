import Foundation
import Observation
import UIKit
import UniformTypeIdentifiers
import LedgerCore

/// App state shared by all screens.
@Observable
@MainActor
final class AppModel {
    enum Phase: Equatable { case launching, welcome, signIn, chooseWorkspace, ready }

    var phase: Phase = .launching
    private(set) var backend: LedgerBackend?
    private(set) var snapshot: LedgerSnapshot?
    private(set) var ledger: Ledger = Ledger(LedgerSnapshot(workspace: Workspace(name: "")))
    private(set) var drafts: DraftStore?
    var workspaces: [Workspace] = []
    var isSyncing = false
    var lastSynced: Date?
    var toast: String?
    var errorMessage: String?
    /// Bumped when drafts or pending uploads change, so views refresh.
    var draftsVersion = 0
    /// The form or capture screen currently shown as a sheet (any screen can open one).
    var sheet: FormRoute?
    /// The project screen being viewed, so Add starts on that property (still changeable in the form).
    var currentProjectId: UUID?
    private var liveTask: Task<Void, Never>?

    var isDemo: Bool { backend?.isDemo ?? false }
    var me: UUID? { backend?.userId }
    var myMember: Member? { snapshot?.members.first { $0.userId == me } }
    var isOwner: Bool { myMember?.isOwner ?? false }
    var workspace: Workspace? { snapshot?.workspace }
    var demo: DemoBackend? { backend as? DemoBackend }

    // MARK: Startup

    func launch() async {
        if AppConfig.lastMode == "demo" { startDemo(); return }
        if AppConfig.lastMode == "live", AppConfig.isLiveConfigured {
            let b = makeLive()
            if await b.restoreSession() { await afterSignIn(); return }
            phase = .signIn
            return
        }
        phase = .welcome
    }

    func startDemo() {
        AppConfig.lastMode = "demo"
        let b = DemoBackend()
        backend = b
        drafts = DraftStore(namespace: "demo")
        Task { await open(workspace: b.snapshot.workspace.id) }
    }

    @discardableResult
    func makeLive() -> SupabaseBackend {
        let b = SupabaseBackend(url: URL(string: AppConfig.supabaseURL)!, anonKey: AppConfig.supabaseAnonKey)
        backend = b
        return b
    }

    func chooseLive() {
        guard AppConfig.isLiveConfigured else { phase = .welcome; return }
        AppConfig.lastMode = "live"
        makeLive()
        phase = .signIn
    }

    func signIn(email: String, password: String, create: Bool) async {
        guard let backend else { return }
        await run {
            if create { try await backend.signUp(email: email, password: password) }
            try await backend.signIn(email: email, password: password)
            await self.afterSignIn()
        }
    }

    private func afterSignIn() async {
        guard let backend else { return }
        await run {
            self.workspaces = try await backend.myWorkspaces()
            if let last = AppConfig.lastWorkspace, self.workspaces.contains(where: { $0.id == last }) {
                await self.open(workspace: last)
            } else if self.workspaces.count == 1 {
                await self.open(workspace: self.workspaces[0].id)
            } else {
                self.phase = .chooseWorkspace
            }
        }
    }

    func joinInvites(displayName: String) async {
        guard let backend else { return }
        await run {
            let n = try await backend.acceptInvites(displayName: displayName)
            if n == 0 { self.errorMessage = "No invitation found for \(backend.userEmail ?? "this email"). Ask the owner to invite this exact email." }
            await self.afterSignIn()
        }
    }

    func createWorkspace(name: String, displayName: String) async {
        guard let backend else { return }
        await run {
            let id = try await backend.createWorkspace(name: name, displayName: displayName)
            self.workspaces = try await backend.myWorkspaces()
            await self.open(workspace: id)
        }
    }

    func open(workspace id: UUID) async {
        guard let backend else { return }
        AppConfig.lastWorkspace = id
        if drafts == nil || !isDemo { drafts = DraftStore(namespace: isDemo ? "demo" : id.uuidString) }
        await reload()
        guard snapshot != nil else { return }
        phase = .ready
        liveTask?.cancel()
        liveTask = Task { [weak self] in
            for await _ in backend.changes(workspace: id) {
                try? await Task.sleep(for: .milliseconds(400))   // coalesce bursts
                await self?.reload(quiet: true)
            }
        }
        await syncPending()
    }

    func signOut() async {
        liveTask?.cancel()
        await backend?.signOut()
        snapshot = nil
        backend = nil
        drafts = nil
        AppConfig.lastMode = nil
        AppConfig.lastWorkspace = nil
        phase = .welcome
    }

    // MARK: Loading

    func reload(quiet: Bool = false) async {
        guard let backend, let id = AppConfig.lastWorkspace ?? snapshot?.workspace.id else { return }
        if !quiet { isSyncing = true }
        defer { isSyncing = false }
        do {
            let s = try await backend.load(workspace: id)
            snapshot = s
            ledger = Ledger(s)
            lastSynced = Date()
        } catch {
            if !quiet { errorMessage = error.localizedDescription }
        }
    }

    /// Runs an action, shows its error, and refreshes data afterwards.
    @discardableResult
    func run(_ action: @MainActor () async throws -> Void) async -> Bool {
        do {
            try await action()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    // MARK: Drafts

    var allDrafts: [TransactionDraft] { _ = draftsVersion; return drafts?.drafts.sorted { $0.updatedAt > $1.updatedAt } ?? [] }
    var pendingAttachments: [DraftStore.PendingAttachment] { _ = draftsVersion; return drafts?.pendingAttachments ?? [] }

    func saveDraft(_ d: TransactionDraft) {
        drafts?.save(d)
        draftsVersion += 1
    }

    func deleteDraft(_ d: TransactionDraft) {
        drafts?.remove(d.id)
        draftsVersion += 1
    }

    func storeFile(_ data: Data, filename: String, mimeType: String) -> LocalFile? {
        try? drafts?.store(data, filename: filename, mimeType: mimeType)
    }

    /// Validates and posts a receipt or bill. On a connection problem it stays on the phone,
    /// marked "waiting to sync", and is retried automatically.
    func submit(_ draft: TransactionDraft) async -> Bool {
        guard let ws = workspace?.id else { return false }
        var d = draft
        do {
            let (record, allocations) = try build(d, workspace: ws)
            _ = record; _ = allocations
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
        d.sync = .waiting
        d.errorMessage = nil
        saveDraft(d)
        await push(d)
        return true
    }

    /// Builds the records from a draft, checking the same rules as the server.
    private func build(_ d: TransactionDraft, workspace ws: UUID) throws -> (Any, [Allocation]) {
        guard let pid = d.projectId else { throw LedgerError("Choose a project.") }
        guard d.vendorId != nil || !d.newVendorName.trimmingCharacters(in: .whitespaces).isEmpty else { throw LedgerError("Choose or type a vendor.") }
        guard let total = d.totalCents, total > 0 else { throw LedgerError("Enter the total.") }
        let allocations = d.allocations(workspace: ws)
        let vendorId = d.vendorId ?? d.newVendorId
        switch d.kind {
        case .receipt:
            let payer: UUID? = switch d.payer { case .me: me; case .llc: nil; case .partner(let id): id }
            let e = Expense(id: d.id, workspaceId: ws, projectId: pid, vendorId: vendorId, expenseDate: d.date, description: d.description,
                            totalCents: total, taxCents: d.taxCents, isRefund: d.isRefund, paidByUserId: payer,
                            paymentMethod: d.paymentMethod, reference: d.reference.isEmpty ? d.invoiceNumber : d.reference, clientId: d.id)
            try Rules.checkExpense(e, allocations: allocations)
            return (e, allocations)
        case .bill:
            let b = Bill(id: d.id, workspaceId: ws, projectId: pid, vendorId: vendorId, commitmentId: d.commitmentId,
                         invoiceNumber: d.invoiceNumber.trimmingCharacters(in: .whitespaces), billDate: d.date, dueDate: d.dueDate,
                         description: d.description, totalCents: total, taxCents: d.taxCents, clientId: d.id)
            try Rules.checkBill(b, allocations: allocations, in: ledger)
            return (b, allocations)
        }
    }

    private func push(_ draft: TransactionDraft) async {
        guard let backend, let ws = workspace?.id, let store = drafts else { return }
        var d = draft
        do {
            // 1. Vendor typed by name: reuse an existing one or create it (same id every retry).
            if d.vendorId == nil {
                let name = d.newVendorName.trimmingCharacters(in: .whitespaces)
                if let existing = snapshot?.vendors.first(where: { $0.name.lowercased() == name.lowercased() }) {
                    d.vendorId = existing.id
                } else {
                    try await backend.save(vendor: Vendor(id: d.newVendorId, workspaceId: ws, name: name,
                                                          kind: d.kind == .bill ? "contractor" : "supplier"))
                    d.vendorId = d.newVendorId
                }
                store.save(d)
            }
            // 2. Upload files (safe to repeat).
            for f in d.files {
                guard let data = store.data(f) else { continue }
                try await backend.upload(data, path: storagePath(ws, f), mimeType: f.mimeType)
            }
            // 3. Post the record with its category split (idempotent by id).
            let (record, allocations) = try build(d, workspace: ws)
            if let e = record as? Expense { try await backend.post(expense: e, allocations: allocations) }
            if let b = record as? Bill { try await backend.post(bill: b, allocations: allocations) }
            // 4. Link the files.
            let ref = EntryRef(d.kind == .bill ? .bill : .expense, d.id)
            for f in d.files {
                try await backend.add(attachment: Attachment(workspaceId: ws, storagePath: storagePath(ws, f), filename: f.filename,
                                                             mimeType: f.mimeType, sizeBytes: f.size, link: ref, clientId: f.id))
            }
            // 5. From the inbox: the inbox file becomes this record's document, and the item is marked filed.
            if let iid = d.inboxItemId, let item = snapshot?.inboxItems.first(where: { $0.id == iid }), item.status == "new" {
                try await backend.add(attachment: Attachment(workspaceId: ws, storagePath: item.storagePath, filename: item.filename,
                                                             mimeType: item.mimeType, sizeBytes: item.sizeBytes, link: ref, clientId: item.id))
                try await backend.perform(.fileInbox(id: iid, expenseId: d.kind == .receipt ? d.id : nil, billId: d.kind == .bill ? d.id : nil))
            }
            // 6. From a statement line: match the new receipt to it.
            if let lid = d.statementLineId, d.kind == .receipt, let line = snapshot?.statementLines.first(where: { $0.id == lid }),
               !(snapshot?.statementMatches.contains { $0.expenseId == d.id } ?? false) {
                try await backend.perform(.addMatch(StatementMatch(workspaceId: ws, statementLineId: lid, expenseId: d.id)))
                let signed = d.isRefund ? -(d.totalCents ?? 0) : (d.totalCents ?? 0)
                if ledger.matchedCents(line: lid) + signed == line.amountCents {
                    try await backend.perform(.setLineStatus(id: lid, status: "matched", reason: nil))
                }
            }
            // 7. From a repeating template: move it to the next due date.
            if let tid = d.templateId, var t = snapshot?.entryTemplates.first(where: { $0.id == tid }), t.repeat != "none", let due = t.nextDue {
                t.nextDue = Settlements.advance(due, repeat: t.repeat)
                try await backend.perform(.saveTemplate(t))
            }
            store.remove(d.id)
            draftsVersion += 1
            toast = d.kind == .bill ? "Bill saved" : "Receipt saved"
            await reload(quiet: true)
        } catch {
            if BackendError.isNetwork(error) {
                d.sync = .waiting
                d.errorMessage = "Waiting to sync: no connection."
            } else {
                d.sync = .failed
                d.errorMessage = error.localizedDescription
            }
            store.save(d)
            draftsVersion += 1
            if d.sync == .failed { errorMessage = error.localizedDescription }
        }
    }

    private func storagePath(_ ws: UUID, _ f: LocalFile) -> String {
        let safe = f.filename.map { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" ? String($0) : "-" }.joined()
        return "\(ws.uuidString.lowercased())/\(f.id.uuidString.lowercased())-\(safe)"
    }

    /// Retries everything waiting to sync.
    func syncPending() async {
        guard let store = drafts else { return }
        for d in store.drafts where d.sync == .waiting { await push(d) }
        for p in store.pendingAttachments { await pushAttachment(p) }
    }

    // MARK: Attachments on existing records

    func attach(_ data: Data, filename: String, mimeType: String, to ref: EntryRef) async {
        await attach(data, filename: filename, mimeType: mimeType, target: .record(ref))
    }

    /// Where a document gets filed: on a transaction, or directly on a project or vendor (permits, contracts, W-9s…).
    enum AttachTarget: Hashable, Identifiable {
        case record(EntryRef), project(UUID), vendor(UUID)
        var id: Self { self }
    }

    func attach(_ data: Data, filename: String, mimeType: String, target: AttachTarget) async {
        guard let store = drafts, let file = try? store.store(data, filename: filename, mimeType: mimeType) else { return }
        var p = DraftStore.PendingAttachment(ref: nil, file: file)
        switch target {
        case .record(let ref): p.ref = ref
        case .project(let id): p.projectId = id
        case .vendor(let id): p.vendorId = id
        }
        store.addPending(p)
        draftsVersion += 1
        await pushAttachment(p)
    }

    private func pushAttachment(_ p: DraftStore.PendingAttachment) async {
        guard let backend, let ws = workspace?.id, let store = drafts, let data = store.data(p.file) else { return }
        do {
            try await backend.upload(data, path: storagePath(ws, p.file), mimeType: p.file.mimeType)
            var a = Attachment(workspaceId: ws, storagePath: storagePath(ws, p.file), filename: p.file.filename,
                               mimeType: p.file.mimeType, sizeBytes: p.file.size, link: p.ref, clientId: p.file.id)
            if let ref = p.ref, ref.kind == .proceeds { a.projectId = snapshot?.proceeds.first { $0.id == ref.id }?.projectId }
            if let id = p.projectId { a.projectId = id }
            if let id = p.vendorId { a.vendorId = id }
            try await backend.add(attachment: a)
            store.removePending(p.id)
            draftsVersion += 1
            toast = "Document attached"
            await reload(quiet: true)
        } catch {
            var failed = p
            failed.errorMessage = BackendError.isNetwork(error) ? "Waiting to sync" : error.localizedDescription
            store.updatePending(failed)
            draftsVersion += 1
        }
    }

    func pending(for ref: EntryRef) -> [DraftStore.PendingAttachment] { pendingAttachments.filter { $0.ref == ref } }
    func pending(for target: AttachTarget) -> [DraftStore.PendingAttachment] {
        switch target {
        case .record(let ref): pending(for: ref)
        case .project(let id): pendingAttachments.filter { $0.projectId == id }
        case .vendor(let id): pendingAttachments.filter { $0.vendorId == id }
        }
    }

    func fileURL(_ a: Attachment) async -> URL? {
        try? await backend?.fileURL(path: a.storagePath)
    }

    // MARK: Other records

    @discardableResult
    func insert(_ record: NewRecord, success: String) async -> Bool {
        guard let backend else { return false }
        let ok = await run { try await backend.insert(record) }
        if ok { toast = success; await reload(quiet: true) }
        return ok
    }

    @discardableResult
    func change(_ ref: EntryRef, _ c: StatusChange, success: String) async -> Bool {
        guard let backend else { return false }
        let ok = await run { try await backend.change(ref, c) }
        if ok { toast = success; await reload(quiet: true) }
        return ok
    }

    @discardableResult
    func save(project: Project) async -> Bool {
        guard let backend else { return false }
        let ok = await run { try await backend.save(project: project) }
        if ok { await reload(quiet: true) }
        return ok
    }

    @discardableResult
    func save(vendor: Vendor) async -> Bool {
        guard let backend else { return false }
        let ok = await run { try await backend.save(vendor: vendor) }
        if ok { await reload(quiet: true) }
        return ok
    }

    func save(budgets: [ProjectBudget]) async -> Bool {
        guard let backend else { return false }
        let ok = await run { for b in budgets { try await backend.save(budget: b) } }
        if ok { toast = "Budget saved"; await reload(quiet: true) }
        return ok
    }

    func save(category: BudgetCategory) async {
        guard let backend else { return }
        if await run({ try await backend.save(category: category) }) { await reload(quiet: true) }
    }

    func save(workspace: Workspace) async {
        guard let backend else { return }
        if await run({ try await backend.save(workspace: workspace) }) { await reload(quiet: true) }
    }

    func save(member: Member) async {
        guard let backend else { return }
        if await run({ try await backend.save(member: member) }) { await reload(quiet: true) }
    }

    func setAccess(member: Member, revoked: Bool) async {
        guard let backend else { return }
        if await run({ try await backend.setAccess(member: member, revoked: revoked) }) {
            toast = revoked ? "\(member.displayName) can no longer see this LLC" : "\(member.displayName) has access again"
            await reload(quiet: true)
        }
    }

    func invite(email: String, role: String) async -> Bool {
        guard let backend, let ws = workspace?.id else { return false }
        let ok = await run { try await backend.invite(email: email, role: role, workspace: ws) }
        if ok { toast = "Invitation saved"; await reload(quiet: true) }
        return ok
    }

    func cancel(invite: Invite) async {
        guard let backend else { return }
        if await run({ try await backend.cancelInvite(invite) }) { await reload(quiet: true) }
    }

    func readVoice(_ transcript: String) async -> Suggestion {
        if let backend, let s = await backend.readVoice(transcript, projects: ledger.s.projects, categories: ledger.activeCategories) {
            return s
        }
        return VoiceParser.parse(transcript, projects: ledger.s.projects, vendors: ledger.s.vendors, categories: ledger.activeCategories)
    }

    // MARK: Inbox, statements, review, cash, sale, materials, templates

    @discardableResult
    func perform(_ op: PlanningOp, success: String? = nil) async -> Bool {
        guard let backend else { return false }
        let ok = await run { try await backend.perform(op) }
        if ok { if let success { toast = success }; await reload(quiet: true) }
        return ok
    }

    /// Imports statement lines; returns how many were new, or nil on failure.
    func importStatement(_ lines: [StatementLine]) async -> Int? {
        guard let backend else { return nil }
        var added = 0
        guard await run({ added = try await backend.perform(.importLines(lines)) }) else { return nil }
        toast = added == lines.count ? "\(added) statement lines imported" : "\(added) new lines imported, \(lines.count - added) already in"
        await reload(quiet: true)
        return added
    }

    /// Drops files into the receipt inbox for someone to file later (also used by Share / Open in).
    @discardableResult
    func addToInbox(_ files: [PickedFile], note: String = "", source: String = "upload") async -> Bool {
        guard let backend, let ws = workspace?.id, !files.isEmpty else { return false }
        let ok = await run {
            for f in files {
                let id = UUID()
                let local = LocalFile(id: id, filename: f.filename, mimeType: f.mimeType, localName: "", size: f.data.count)
                let path = self.storagePath(ws, local)
                try await backend.upload(f.data, path: path, mimeType: f.mimeType)
                let s = self.ledger.suggestFromText("\(note) \(f.filename)")
                try await backend.perform(.addInbox(InboxItem(id: id, workspaceId: ws, storagePath: path, filename: f.filename, mimeType: f.mimeType,
                                                              sizeBytes: f.data.count, note: note.trimmingCharacters(in: .whitespaces), source: source,
                                                              suggestedKind: s.kind, suggestedProjectId: s.projectId, suggestedVendor: s.vendor,
                                                              suggestedDate: s.date, suggestedTotalCents: s.totalCents, clientId: id)))
            }
        }
        if ok { toast = files.count == 1 ? "Added to the inbox" : "\(files.count) files added to the inbox"; await reload(quiet: true) }
        return ok
    }

    /// A file shared or opened into the app ("Open in Project Ledger"): goes to the inbox.
    func handleOpenedFile(_ url: URL) async {
        guard phase == .ready else { errorMessage = "Sign in first, then share the file again."; return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { errorMessage = "Couldn't read that file."; return }
        let ext = url.pathExtension.lowercased()
        let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? (ext == "pdf" ? "application/pdf" : "application/octet-stream")
        await addToInbox([PickedFile(data: data, filename: url.lastPathComponent, mimeType: mime, image: nil)], source: "share")
    }

    /// The category this vendor's latest receipt or bill used, so filing from the inbox or a statement needs one less pick.
    func usualCategory(_ vendorId: UUID?) -> UUID? {
        guard let s = snapshot, let vendorId else { return nil }
        let recs: [(Day, EntryRef)] = s.bills.filter { $0.vendorId == vendorId && !$0.isVoid }.map { ($0.billDate, EntryRef(.bill, $0.id)) }
            + s.expenses.filter { $0.vendorId == vendorId && !$0.isVoid }.map { ($0.expenseDate, EntryRef(.expense, $0.id)) }
        for (_, r) in recs.sorted(by: { $0.0 > $1.0 }) {
            if let a = s.allocations.first(where: { r.kind == .bill ? $0.billId == r.id : $0.expenseId == r.id }) { return a.categoryId }
        }
        return nil
    }

    func payerChoice(_ uid: UUID?) -> TransactionDraft.Payer { uid == nil ? .llc : uid == me ? .me : .partner(uid!) }

    /// Draft for filing an inbox item, from its suggestions.
    func inboxDraft(_ i: InboxItem) -> TransactionDraft {
        var d = TransactionDraft()
        d.kind = i.suggestedKind == "bill" ? .bill : .receipt
        d.projectId = i.suggestedProjectId
        if let name = i.suggestedVendor, !name.isEmpty {
            if let v = ledger.s.vendors.first(where: { $0.name.lowercased() == name.lowercased() }) { d.vendorId = v.id } else { d.newVendorName = name }
        }
        if let t = i.suggestedTotalCents { d.totalText = Money.plain(t) }
        if let day = i.suggestedDate { d.date = day }
        if d.kind == .bill { d.payer = .llc }
        d.splits[0].categoryId = usualCategory(d.vendorId)
        d.description = i.note
        d.inboxItemId = i.id
        d.source = "inbox"
        return d
    }

    /// Draft receipt for a card charge: amount, date, vendor guess, and the card owner as payer.
    func lineDraft(_ line: StatementLine, projectId: UUID? = nil, amountCents: Cents? = nil) -> TransactionDraft {
        var d = TransactionDraft()
        d.projectId = projectId
        let v = ledger.vendorFromDescription(line.description)
        if let id = v.vendorId { d.vendorId = id } else { d.newVendorName = v.name }
        let amount = amountCents ?? (line.amountCents - ledger.matchedCents(line: line.id))
        d.totalText = Money.plain(Swift.abs(amount))
        d.isRefund = amount < 0
        d.date = line.postedDate
        d.payer = payerChoice(line.accountOwner)
        d.paymentMethod = line.accountOwner != nil ? "card" : (line.description.localizedCaseInsensitiveContains("check") ? "check" : "ach")
        d.splits[0].categoryId = usualCategory(d.vendorId)
        d.description = line.description
        d.statementLineId = line.id
        d.source = "statement"
        return d
    }

    /// Draft from a template: today's date, everything else filled in.
    func templateDraft(_ t: EntryTemplate) -> TransactionDraft {
        var d = TransactionDraft()
        d.kind = t.kind == "bill" ? .bill : .receipt
        d.projectId = t.projectId
        d.vendorId = t.vendorId
        if let a = t.amountCents { d.totalText = Money.plain(a) }
        d.splits[0].categoryId = t.categoryId
        d.description = t.description
        d.paymentMethod = t.paymentMethod
        d.payer = d.kind == .bill ? .llc : payerChoice(t.paidByUserId)
        if d.kind == .bill, let due = t.nextDue { d.dueDate = due }
        d.templateId = t.id
        d.source = "template"
        return d
    }

    func matchLine(_ line: StatementLine, refs: [EntryRef]) async -> Bool {
        guard let backend else { return false }
        let ok = await run {
            for r in refs {
                try await backend.perform(.addMatch(StatementMatch(workspaceId: line.workspaceId, statementLineId: line.id,
                                                                   expenseId: r.kind == .expense ? r.id : nil, billPaymentId: r.kind == .payment ? r.id : nil)))
            }
            // Fully explained: matched. Partly (one of two receipts found so far): stays in the to-match list.
            let added = refs.reduce(0) { sum, r in
                if r.kind == .expense, let e = self.ledger.s.expenses.first(where: { $0.id == r.id }) { return sum + e.signedCents }
                if let p = self.ledger.s.payments.first(where: { $0.id == r.id }) { return sum + (p.kind == "refund" ? -p.amountCents : p.amountCents) }
                return sum
            }
            if self.ledger.matchedCents(line: line.id) + added == line.amountCents {
                try await backend.perform(.setLineStatus(id: line.id, status: "matched", reason: nil))
            }
        }
        if ok { toast = "Matched"; await reload(quiet: true) }
        return ok
    }

    func unmatchLine(_ line: StatementLine) async {
        guard let backend else { return }
        let ok = await run {
            for m in self.ledger.s.statementMatches where m.statementLineId == line.id { try await backend.perform(.removeMatch(id: m.id)) }
            try await backend.perform(.setLineStatus(id: line.id, status: "unmatched", reason: nil))
        }
        if ok { toast = "Match undone"; await reload(quiet: true) }
    }

    func claim(_ kind: ClaimKind, _ id: UUID) async {
        guard let ws = workspace?.id, let me else { return }
        await perform(.claim(Claim(workspaceId: ws, itemKind: kind, itemId: id, claimedBy: me)), success: "Claimed: it’s yours")
    }

    // MARK: Demo helpers

    func actAs(_ uid: UUID) async {
        demo?.actingAs = uid
        await reload(quiet: true)
        toast = "Now acting as \(ledger.payerName(uid))"
    }

    func resetDemo() async {
        demo?.reset()
        await reload(quiet: true)
    }

    func newId() -> UUID { UUID() }
}
