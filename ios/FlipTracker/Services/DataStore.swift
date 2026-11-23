import Foundation
import Observation
import FirebaseFirestore
import FirebaseStorage

/// Live, shared data for all partners, plus the totals the screens show.
@Observable
@MainActor
final class DataStore {
    var me: Member?
    var members: [Member] = []
    var properties: [Property] = []
    var expenses: [Expense] = []
    var invoices: [Invoice] = []
    var lastError: String?

    private let db = Firestore.firestore()
    private var listeners: [ListenerRegistration] = []

    func start(me: Member) {
        stop()
        self.me = me
        listeners.append(db.collection("members").addSnapshotListener { [weak self] snap, err in
            MainActor.assumeIsolated { self?.apply(err) { self?.members = snap?.documents.compactMap { try? $0.data(as: Member.self) }.sorted { $0.name < $1.name } ?? [] } }
        })
        listeners.append(db.collection("properties").order(by: "createdAt", descending: true).addSnapshotListener { [weak self] snap, err in
            MainActor.assumeIsolated { self?.apply(err) { self?.properties = snap?.documents.compactMap { try? $0.data(as: Property.self) } ?? [] } }
        })
        listeners.append(db.collection("expenses").order(by: "date", descending: true).addSnapshotListener { [weak self] snap, err in
            MainActor.assumeIsolated { self?.apply(err) { self?.expenses = snap?.documents.compactMap { try? $0.data(as: Expense.self) } ?? [] } }
        })
        listeners.append(db.collection("invoices").order(by: "invoiceDate", descending: true).addSnapshotListener { [weak self] snap, err in
            MainActor.assumeIsolated { self?.apply(err) { self?.invoices = snap?.documents.compactMap { try? $0.data(as: Invoice.self) } ?? [] } }
        })
    }

    func stop() {
        listeners.forEach { $0.remove() }
        listeners = []
        me = nil; members = []; properties = []; expenses = []; invoices = []
    }

    private func apply(_ error: Error?, _ update: () -> Void) {
        if let error { lastError = error.localizedDescription } else { update() }
    }

    // MARK: Writes

    func save(_ expense: Expense) throws {
        guard let me, let uid = me.id else { return }
        var e = expense
        e.createdByUid = uid          // always the signed-in partner
        e.createdByName = me.name
        e.propertyName = properties.first { $0.id == e.propertyId }?.name
        if let id = e.id { try db.collection("expenses").document(id).setData(from: e) }
        else { _ = try db.collection("expenses").addDocument(from: e) }
    }

    func delete(_ expense: Expense) {
        guard let id = expense.id else { return }
        db.collection("expenses").document(id).delete()
        if let path = expense.receiptPath { Storage.storage().reference(withPath: path).delete { _ in } }
    }

    func save(_ property: Property) throws {
        if let id = property.id { try db.collection("properties").document(id).setData(from: property) }
        else { _ = try db.collection("properties").addDocument(from: property) }
    }

    func save(_ invoice: Invoice) throws {
        var i = invoice
        i.propertyName = properties.first { $0.id == i.propertyId }?.name
        if let id = i.id { try db.collection("invoices").document(id).setData(from: i) }
        else { _ = try db.collection("invoices").addDocument(from: i) }
    }

    func delete(_ invoice: Invoice) {
        guard let id = invoice.id else { return }
        db.collection("invoices").document(id).delete()
    }

    func canEdit(_ e: Expense) -> Bool { e.createdByUid == me?.id }

    // MARK: Totals

    func expenses(for property: Property) -> [Expense] { expenses.filter { $0.propertyId == property.id } }

    func spent(on property: Property) -> Double { expenses(for: property).reduce(0) { $0 + $1.amount } }

    /// Renovation/build spending (purchase & closing costs are excluded from the budget).
    func renoSpent(on property: Property) -> Double {
        expenses(for: property).filter { $0.category != "Purchase / Closing" }.reduce(0) { $0 + $1.amount }
    }

    func byCategory(_ property: Property) -> [(category: String, amount: Double)] {
        let grouped = Dictionary(grouping: expenses(for: property), by: \.category)
        return grouped.map { ($0.key, $0.value.reduce(0) { $0 + $1.amount }) }.sorted { $0.amount > $1.amount }
    }

    func unpaidTotal(_ property: Property? = nil) -> Double {
        expenses.filter { !$0.isPaid && (property == nil || $0.propertyId == property?.id) }.reduce(0) { $0 + $1.amount }
    }

    struct PartnerBalance: Identifiable {
        let member: Member
        let paid: Double
        let fairShare: Double
        var id: String { member.id ?? member.email }
        var difference: Double { paid - fairShare }
    }

    /// What each partner paid personally (Paid items only) vs an equal share.
    func partnerBalances(property: Property? = nil) -> [PartnerBalance] {
        let personal = expenses.filter {
            $0.isPaid && !$0.paidFromLLC && (property == nil || $0.propertyId == property?.id)
        }
        let total = personal.reduce(0) { $0 + $1.amount }
        let share = members.isEmpty ? 0 : total / Double(members.count)
        return members.map { m in
            let paid = personal.filter { $0.createdByUid == m.id }.reduce(0) { $0 + $1.amount }
            return PartnerBalance(member: m, paid: paid, fairShare: share)
        }
    }

    var llcPaidTotal: Double { expenses.filter { $0.isPaid && $0.paidFromLLC }.reduce(0) { $0 + $1.amount } }

    /// Paid expenses whose invoice # matches this invoice.
    func paid(on invoice: Invoice) -> Double {
        let key = invoice.invoiceNumber.trimmingCharacters(in: .whitespaces).lowercased()
        guard !key.isEmpty else { return 0 }
        return expenses.filter { $0.isPaid && $0.invoiceNumber.trimmingCharacters(in: .whitespaces).lowercased() == key }
            .reduce(0) { $0 + $1.amount }
    }

    func receiptURL(_ path: String) async -> URL? {
        try? await Storage.storage().reference(withPath: path).downloadURL()
    }
}
