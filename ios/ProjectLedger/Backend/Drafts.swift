import Foundation
import LedgerCore

/// A file captured on this phone, kept locally until it has been uploaded.
struct LocalFile: Codable, Hashable, Identifiable {
    var id = UUID()
    var filename: String
    var mimeType: String
    var localName: String           // file name inside DraftStore.filesDir
    var size: Int
}

enum SyncState: String, Codable {
    case draft          // being edited, only on this phone
    case waiting        // posted, waiting to sync (offline or in progress)
    case failed         // the server refused it; needs a fix
}

struct SplitLine: Codable, Hashable, Identifiable {
    var id = UUID()
    var categoryId: UUID?
    var amountText: String = ""
}

/// Receipt or bill being entered. Its id becomes the record id, so re-sending is safe.
struct TransactionDraft: Codable, Identifiable, Hashable {
    enum Kind: String, Codable { case receipt, bill }
    enum Payer: Codable, Hashable { case me, llc, partner(UUID) }

    var id = UUID()
    var kind: Kind = .receipt
    var source = "manual"               // manual, scan, voice
    var projectId: UUID?
    var vendorId: UUID?
    var newVendorName = ""
    var newVendorId = UUID()
    var date: Day = Days.today
    var dueDate: Day?
    var description = ""
    var totalText = ""
    var taxText = ""
    var invoiceNumber = ""
    var splits: [SplitLine] = [SplitLine()]
    var payer: Payer = .me
    var paymentMethod = "card"
    var reference = ""
    var isRefund = false
    var commitmentId: UUID?
    var files: [LocalFile] = []
    var sync: SyncState = .draft
    var errorMessage: String?
    var updatedAt = Date()
    var transcript: String?

    var totalCents: Cents? { Money.parse(totalText) }
    var taxCents: Cents { Money.parse(taxText) ?? 0 }
    var title: String {
        let what = kind == .bill ? "Bill" : "Receipt"
        let amount = totalCents.map { Money.format($0) } ?? "no amount"
        return "\(what) · \(amount)"
    }

    /// Category amounts; a single line always takes the whole total.
    func allocations(workspace: UUID) -> [Allocation] {
        let total = totalCents ?? 0
        if splits.count == 1, let cid = splits[0].categoryId {
            return [Allocation(workspaceId: workspace, categoryId: cid, amountCents: total)]
        }
        return splits.compactMap { s in
            guard let cid = s.categoryId, let amt = Money.parse(s.amountText), amt > 0 else { return nil }
            return Allocation(workspaceId: workspace, categoryId: cid, amountCents: amt)
        }
    }

    var unallocatedCents: Cents {
        guard splits.count > 1 else { return 0 }
        return (totalCents ?? 0) - splits.reduce(0) { $0 + (Money.parse($1.amountText) ?? 0) }
    }

    mutating func apply(_ s: Suggestion, vendors: [Vendor], me: UUID?) {
        if let v = s.vendorId { vendorId = v; newVendorName = "" }
        else if let name = s.vendorName, !name.isEmpty {
            if let v = vendors.first(where: { $0.name.lowercased() == name.lowercased() }) { vendorId = v.id; newVendorName = "" }
            else { vendorId = nil; newVendorName = name }
        }
        if let d = s.date { date = d }
        if let t = s.totalCents { totalText = Money.plain(t) }
        if let t = s.taxCents { taxText = Money.plain(t) }
        if let i = s.invoiceNumber { invoiceNumber = i }
        if let d = s.description, description.isEmpty { description = d }
        if let p = s.projectId { projectId = p }
        if let c = s.categoryId, splits.count == 1 { splits[0].categoryId = c }
        if let mine = s.paidByMe { payer = mine ? .me : .llc }
        if let m = s.paymentMethod { paymentMethod = m }
    }
}

/// Drafts and pending uploads, saved on this phone so nothing is lost offline.
@MainActor
final class DraftStore {
    struct PendingAttachment: Codable, Identifiable, Hashable {
        var id = UUID()
        /// The record the document belongs to; nil for a document filed on a project or vendor itself.
        var ref: EntryRef?
        var file: LocalFile
        var projectId: UUID? = nil
        var vendorId: UUID? = nil
        var errorMessage: String?
    }

    private(set) var drafts: [TransactionDraft] = []
    private(set) var pendingAttachments: [PendingAttachment] = []
    let filesDir: URL
    private let stateURL: URL

    init(namespace: String) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ProjectLedger/\(namespace)", isDirectory: true)
        filesDir = base.appendingPathComponent("files", isDirectory: true)
        stateURL = base.appendingPathComponent("drafts.json")
        try? FileManager.default.createDirectory(at: filesDir, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: stateURL), let state = try? JSONDecoder().decode(State.self, from: data) {
            drafts = state.drafts
            pendingAttachments = state.pending
        }
    }

    private struct State: Codable { var drafts: [TransactionDraft]; var pending: [PendingAttachment] }

    private func persist() {
        let state = State(drafts: drafts, pending: pendingAttachments)
        if let data = try? JSONEncoder().encode(state) { try? data.write(to: stateURL, options: .atomic) }
    }

    func save(_ d: TransactionDraft) {
        var d = d
        d.updatedAt = Date()
        if let i = drafts.firstIndex(where: { $0.id == d.id }) { drafts[i] = d } else { drafts.append(d) }
        persist()
    }

    func remove(_ id: UUID, deleteFiles: Bool = true) {
        if deleteFiles, let d = drafts.first(where: { $0.id == id }) { d.files.forEach(deleteFile) }
        drafts.removeAll { $0.id == id }
        persist()
    }

    func addPending(_ p: PendingAttachment) { pendingAttachments.append(p); persist() }
    func updatePending(_ p: PendingAttachment) {
        if let i = pendingAttachments.firstIndex(where: { $0.id == p.id }) { pendingAttachments[i] = p; persist() }
    }
    func removePending(_ id: UUID) {
        if let p = pendingAttachments.first(where: { $0.id == id }) { deleteFile(p.file) }
        pendingAttachments.removeAll { $0.id == id }
        persist()
    }

    func store(_ data: Data, filename: String, mimeType: String) throws -> LocalFile {
        let f = LocalFile(filename: filename, mimeType: mimeType, localName: UUID().uuidString + "-" + filename, size: data.count)
        try data.write(to: url(f), options: .atomic)
        return f
    }
    func url(_ f: LocalFile) -> URL { filesDir.appendingPathComponent(f.localName) }
    func data(_ f: LocalFile) -> Data? { try? Data(contentsOf: url(f)) }
    func deleteFile(_ f: LocalFile) { try? FileManager.default.removeItem(at: url(f)) }
}
