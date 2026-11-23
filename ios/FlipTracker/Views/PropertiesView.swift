import SwiftUI

struct PropertiesView: View {
    @Environment(DataStore.self) private var store
    @State private var adding = false

    var body: some View {
        NavigationStack {
            List {
                if store.properties.isEmpty {
                    ContentUnavailableView("No properties yet", systemImage: "house",
                                           description: Text("Add each flip or new build so spending can be tracked against it."))
                }
                ForEach(store.properties) { p in
                    NavigationLink(value: p) { PropertyRow(property: p) }
                }
            }
            .navigationTitle("Properties")
            .navigationDestination(for: Property.self) { PropertyDetailView(propertyId: $0.id) }
            .toolbar { Button { adding = true } label: { Image(systemName: "plus") } }
            .sheet(isPresented: $adding) { PropertyFormView(property: Property(name: "")) }
        }
    }
}

struct BudgetBar: View {
    let spent: Double
    let budget: Double
    var body: some View {
        let ratio = budget > 0 ? spent / budget : 0
        VStack(alignment: .leading, spacing: 4) {
            ProgressView(value: min(ratio, 1))
                .tint(ratio > 1 ? .red : ratio > 0.9 ? .orange : .green)
            Text(budget > 0 ? "\(spent.money0) of \(budget.money0) budget (\(Int(ratio * 100))%)" : "\(spent.money0) spent, no budget set")
                .font(.caption).foregroundStyle(ratio > 1 ? .red : .secondary)
        }
    }
}

struct PropertyRow: View {
    @Environment(DataStore.self) private var store
    let property: Property
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(property.name).font(.headline)
                Spacer()
                Text(property.status).font(.caption).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
            }
            BudgetBar(spent: store.renoSpent(on: property), budget: property.budget)
        }
        .padding(.vertical, 4)
    }
}

struct PropertyDetailView: View {
    @Environment(DataStore.self) private var store
    let propertyId: String?
    @State private var editing = false

    var body: some View {
        if let p = store.properties.first(where: { $0.id == propertyId }) {
            let reno = store.renoSpent(on: p)
            let total = store.spent(on: p)
            let sale = p.actualSalePrice ?? p.targetSalePrice
            List {
                Section("Budget vs actual") {
                    BudgetBar(spent: reno, budget: p.budget)
                    LabeledContent("Reno / build spent", value: reno.money0)
                    LabeledContent("Budget", value: p.budget.money0)
                    LabeledContent("Remaining", value: (p.budget - reno).money0)
                        .foregroundStyle(p.budget - reno < 0 ? .red : .primary)
                    let unpaid = store.unpaidTotal(p)
                    if unpaid > 0 { LabeledContent("Unpaid bills", value: unpaid.money0).foregroundStyle(.orange) }
                }
                Section("Deal") {
                    LabeledContent("Purchase price", value: p.purchasePrice.money0)
                    LabeledContent("All spending (incl. closing)", value: total.money0)
                    LabeledContent("Total cost", value: (p.purchasePrice + total).money0)
                    LabeledContent(p.actualSalePrice == nil ? "Target sale" : "Sold for", value: sale.money0)
                    LabeledContent(p.actualSalePrice == nil ? "Projected profit" : "Profit", value: (sale - p.purchasePrice - total).money0)
                        .bold()
                }
                Section("By category") {
                    ForEach(store.byCategory(p), id: \.category) { row in
                        LabeledContent { Text(row.amount.money0) } label: {
                            Label(row.category, systemImage: Categories.icon(row.category))
                        }
                    }
                }
                Section("Who paid (personal money)") {
                    ForEach(store.partnerBalances(property: p)) { b in
                        LabeledContent(b.member.name, value: b.paid.money0)
                    }
                    LabeledContent("LLC account", value: store.expenses(for: p).filter { $0.isPaid && $0.paidFromLLC }
                        .reduce(0) { $0 + $1.amount }.money0)
                }
                Section("Expenses") {
                    ForEach(store.expenses(for: p)) { e in
                        NavigationLink(value: e) { ExpenseRow(expense: e) }
                    }
                }
            }
            .navigationTitle(p.name)
            .navigationDestination(for: Expense.self) { ExpenseDetailView(expense: $0) }
            .toolbar { Button("Edit") { editing = true } }
            .sheet(isPresented: $editing) { PropertyFormView(property: p) }
        } else {
            ContentUnavailableView("Property not found", systemImage: "house")
        }
    }
}

struct PropertyFormView: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var property: Property
    @State private var sold = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Short name (e.g. Oak St)", text: $property.name)
                    TextField("Address", text: $property.address)
                    Picker("Type", selection: $property.type) { ForEach(Property.types, id: \.self) { Text($0) } }
                    Picker("Status", selection: $property.status) { ForEach(Property.statuses, id: \.self) { Text($0) } }
                }
                Section("Numbers") {
                    money("Purchase price", $property.purchasePrice)
                    money("Reno / build budget", $property.budget)
                    money("Target sale price", $property.targetSalePrice)
                    Toggle("Sold", isOn: $sold)
                    if sold {
                        money("Actual sale price", Binding(get: { property.actualSalePrice ?? 0 }, set: { property.actualSalePrice = $0 }))
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(property.id == nil ? "New property" : "Edit property")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { sold = property.actualSalePrice != nil }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !sold { property.actualSalePrice = nil }
                        do { try store.save(property); dismiss() } catch { self.error = error.localizedDescription }
                    }
                    .disabled(property.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func money(_ label: String, _ value: Binding<Double>) -> some View {
        HStack {
            Text(label)
            TextField("0", value: value, format: .number.precision(.fractionLength(0)))
                .keyboardType(.numberPad).multilineTextAlignment(.trailing)
        }
    }
}
