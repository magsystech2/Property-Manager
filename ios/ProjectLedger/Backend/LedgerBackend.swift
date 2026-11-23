import Foundation
import LedgerCore

/// New records other than receipts and bills (those carry a category split).
enum NewRecord {
    case payment(BillPayment)
    case reimbursement(Reimbursement, [ReimbursementItem])
    case contribution(Contribution)
    case proceeds(SaleProceed)
    case commitment(Commitment)
    case changeOrder(ChangeOrder)
}

/// Status changes on posted records. The server checks who may do what.
enum StatusChange {
    case approve                                 // bill / change order -> posted, reimbursement -> approved
    case markPaid(date: Day, method: String, reference: String)   // reimbursement -> paid
    case void(reason: String)
}

/// Live (Supabase) or demo (in memory). Both must apply the same rules.
@MainActor
protocol LedgerBackend: AnyObject {
    var isDemo: Bool { get }
    var userId: UUID? { get }
    var userEmail: String? { get }

    func restoreSession() async -> Bool
    func signIn(email: String, password: String) async throws
    func signUp(email: String, password: String) async throws
    func signOut() async

    func myWorkspaces() async throws -> [Workspace]
    func acceptInvites(displayName: String) async throws -> Int
    func createWorkspace(name: String, displayName: String) async throws -> UUID
    func load(workspace: UUID) async throws -> LedgerSnapshot

    func post(expense: Expense, allocations: [Allocation]) async throws
    func post(bill: Bill, allocations: [Allocation]) async throws
    func insert(_ record: NewRecord) async throws
    func change(_ ref: EntryRef, _ change: StatusChange) async throws

    func save(project: Project) async throws
    func save(vendor: Vendor) async throws
    func save(budget: ProjectBudget) async throws
    func save(category: BudgetCategory) async throws
    func save(workspace: Workspace) async throws
    func save(member: Member) async throws
    /// Owner only: remove (revoked = true) or restore a partner's access. Their records and balances stay.
    func setAccess(member: Member, revoked: Bool) async throws
    func invite(email: String, role: String, workspace: UUID) async throws
    func cancelInvite(_ invite: Invite) async throws

    func upload(_ data: Data, path: String, mimeType: String) async throws
    func add(attachment: Attachment) async throws
    func fileURL(path: String) async throws -> URL

    /// Smarter "say it" reading on the server, if configured. nil = use on-device parsing.
    func readVoice(_ transcript: String, projects: [Project], categories: [BudgetCategory]) async -> Suggestion?

    /// Fires whenever shared data changes (other partners' edits).
    func changes(workspace: UUID) -> AsyncStream<Void>
}

enum BackendError: LocalizedError {
    case notSignedIn, notConfigured, offline(String), server(String)
    var errorDescription: String? {
        switch self {
        case .notSignedIn: "Please sign in again."
        case .notConfigured: "Live sync isn't set up yet. Add your Supabase URL and key in Settings, or try the demo."
        case .offline(let m): "No connection. It will sync when you're back online. (\(m))"
        case .server(let m): m
        }
    }
    static func isNetwork(_ error: Error) -> Bool {
        if case .offline = error as? BackendError { return true }
        let ns = error as NSError
        return ns.domain == NSURLErrorDomain
    }
}
