import SwiftUI

struct ExpenseDetailView: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let expense: Expense
    @State private var receiptURL: URL?
    @State private var editing = false
    @State private var draft = Expense()
    @State private var confirmDelete = false

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(expense.amount.money).font(.largeTitle.bold())
                    Text(expense.vendor.isEmpty ? expense.category : expense.vendor).font(.title3)
                    if !expense.isPaid { Text("Unpaid bill").foregroundStyle(.orange).bold() }
                }
            }
            Section {
                row("Property", expense.propertyName ?? "None")
                row("Category", expense.category)
                row("Date", expense.date.formatted(date: .abbreviated, time: .omitted))
                if !expense.description.isEmpty { row("For", expense.description) }
                if !expense.invoiceNumber.isEmpty { row("Invoice #", expense.invoiceNumber) }
            }
            Section("Payment") {
                row("Logged by", expense.createdByName)
                row("Paid from", expense.paidFromLLC ? "LLC account" : "\(expense.createdByName)'s own money")
                row("Method", expense.paymentMethod)
                row("Added", expense.createdAt.formatted(date: .abbreviated, time: .shortened) + " via \(expense.source)")
            }
            if !expense.notes.isEmpty { Section("Notes") { Text(expense.notes) } }
            if expense.receiptPath != nil {
                Section("Receipt") {
                    if let receiptURL {
                        Link(destination: receiptURL) {
                            AsyncImage(url: receiptURL) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                                .frame(maxHeight: 400)
                        }
                    } else { ProgressView() }
                }
            }
            if store.canEdit(expense) {
                Section {
                    Button("Delete expense", role: .destructive) { confirmDelete = true }
                }
            }
        }
        .navigationTitle("Expense")
        .toolbar {
            if store.canEdit(expense) {
                Button("Edit") { draft = expense; editing = true }
            }
        }
        .task { if let p = expense.receiptPath { receiptURL = await store.receiptURL(p) } }
        .sheet(isPresented: $editing) {
            NavigationStack {
                ExpenseForm(expense: $draft)
                    .navigationTitle("Edit expense").navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editing = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Save") { try? store.save(draft); editing = false; dismiss() }
                        }
                    }
            }
        }
        .confirmationDialog("Delete this expense?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { store.delete(expense); dismiss() }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        LabeledContent(label, value: value)
    }
}
