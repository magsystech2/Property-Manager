import SwiftUI

struct FeedView: View {
    @Environment(DataStore.self) private var store
    @Environment(SessionStore.self) private var session
    @Binding var addMode: AddMode?
    @State private var who = "Everyone"
    @State private var propertyId = "all"
    @State private var search = ""

    private var filtered: [Expense] {
        store.expenses.filter { e in
            (who == "Everyone" || e.createdByName == who)
            && (propertyId == "all" || e.propertyId == propertyId)
            && (search.isEmpty || [e.vendor, e.description, e.category, e.propertyName ?? "", e.invoiceNumber]
                .joined(separator: " ").localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    QuickAddBar(addMode: $addMode)
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                Section {
                    HStack {
                        VStack(alignment: .leading) {
                            Text("Total shown").font(.caption).foregroundStyle(.secondary)
                            Text(filtered.reduce(0) { $0 + $1.amount }.money).font(.title2.bold())
                        }
                        Spacer()
                        let unpaid = filtered.filter { !$0.isPaid }.reduce(0) { $0 + $1.amount }
                        if unpaid > 0 {
                            VStack(alignment: .trailing) {
                                Text("Unpaid").font(.caption).foregroundStyle(.secondary)
                                Text(unpaid.money).font(.headline).foregroundStyle(.orange)
                            }
                        }
                    }
                    Picker("Who", selection: $who) {
                        Text("Everyone").tag("Everyone")
                        ForEach(store.members) { Text($0.name).tag($0.name) }
                    }
                    Picker("Property", selection: $propertyId) {
                        Text("All properties").tag("all")
                        ForEach(store.properties) { Text($0.name).tag($0.id ?? "") }
                    }
                }
                if filtered.isEmpty {
                    ContentUnavailableView("No spending yet", systemImage: "tray",
                                           description: Text("Snap a receipt or say an expense to add the first one."))
                }
                ForEach(groupedByMonth, id: \.title) { group in
                    Section(group.title) {
                        ForEach(group.items) { e in
                            NavigationLink(value: e) { ExpenseRow(expense: e) }
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Vendor, item, invoice #")
            .navigationTitle("Spending")
            .navigationDestination(for: Expense.self) { ExpenseDetailView(expense: $0) }
            .toolbar {
                Menu {
                    if case .signedIn(let me) = session.state { Text("Signed in as \(me.name)") }
                    Button("Sign out", role: .destructive) { session.signOut() }
                } label: { Image(systemName: "person.crop.circle") }
            }
        }
    }

    private var groupedByMonth: [(title: String, items: [Expense])] {
        let f = DateFormatter(); f.dateFormat = "MMMM yyyy"
        var order: [String] = []
        var dict: [String: [Expense]] = [:]
        for e in filtered {
            let k = f.string(from: e.date)
            if dict[k] == nil { order.append(k) }
            dict[k, default: []].append(e)
        }
        return order.map { ($0, dict[$0]!) }
    }
}

struct ExpenseRow: View {
    let expense: Expense
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: Categories.icon(expense.category))
                .frame(width: 36, height: 36)
                .background(Color.accentColor.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(expense.vendor.isEmpty ? expense.category : expense.vendor).font(.body.weight(.medium)).lineLimit(1)
                Text([expense.propertyName ?? "No property", expense.payerLabel].joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(expense.amount.money).font(.body.monospacedDigit().weight(.semibold))
                HStack(spacing: 4) {
                    if expense.receiptPath != nil { Image(systemName: "paperclip") }
                    if !expense.isPaid { Text("Unpaid").foregroundStyle(.orange) }
                    else { Text(expense.date, format: .dateTime.month(.abbreviated).day()) }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
