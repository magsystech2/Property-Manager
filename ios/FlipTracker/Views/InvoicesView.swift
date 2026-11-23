import SwiftUI

struct InvoicesView: View {
    @Environment(DataStore.self) private var store
    @State private var editing: Invoice?

    var body: some View {
        NavigationStack {
            List {
                if store.invoices.isEmpty {
                    ContentUnavailableView("No contractor invoices", systemImage: "doc.plaintext",
                        description: Text("Log each invoice a contractor sends. Payments you add as expenses with the same invoice # are matched automatically."))
                } else {
                    Section {
                        let billed = store.invoices.reduce(0) { $0 + $1.amount }
                        let paid = store.invoices.reduce(0) { $0 + store.paid(on: $1) }
                        LabeledContent("Invoiced", value: billed.money0)
                        LabeledContent("Paid", value: paid.money0)
                        LabeledContent("Still owed", value: (billed - paid).money0).bold()
                    }
                }
                ForEach(store.invoices) { inv in
                    Button { editing = inv } label: { InvoiceRow(invoice: inv) }.buttonStyle(.plain)
                }
                .onDelete { idx in idx.map { store.invoices[$0] }.forEach(store.delete) }
            }
            .navigationTitle("Contractor invoices")
            .toolbar { Button { editing = Invoice(contractor: "", invoiceNumber: "") } label: { Image(systemName: "plus") } }
            .sheet(item: Binding(get: { editing.map(IdentifiedInvoice.init) }, set: { editing = $0?.invoice })) {
                InvoiceFormView(invoice: $0.invoice)
            }
        }
    }
}

private struct IdentifiedInvoice: Identifiable {
    let invoice: Invoice
    var id: String { invoice.id ?? "new" }
}

struct InvoiceRow: View {
    @Environment(DataStore.self) private var store
    let invoice: Invoice
    var body: some View {
        let paid = store.paid(on: invoice)
        let due = invoice.amount - paid
        let overdue = due > 0 && (invoice.dueDate ?? .distantFuture) < .now
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(invoice.contractor).font(.headline)
                Text("#\(invoice.invoiceNumber) · \(invoice.propertyName ?? "No property")").font(.caption).foregroundStyle(.secondary)
                if !invoice.work.isEmpty { Text(invoice.work).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(invoice.amount.money0).font(.body.monospacedDigit())
                Text(due <= 0 ? "Paid in full" : overdue ? "OVERDUE \(due.money0)" : "Owe \(due.money0)")
                    .font(.caption.bold())
                    .foregroundStyle(due <= 0 ? .green : overdue ? .red : .orange)
            }
        }
        .contentShape(Rectangle())
    }
}

struct InvoiceFormView: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State var invoice: Invoice
    @State private var hasDue = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Contractor", text: $invoice.contractor)
                    TextField("Invoice #", text: $invoice.invoiceNumber)
                    Picker("Property", selection: $invoice.propertyId) {
                        Text("Choose…").tag(String?.none)
                        ForEach(store.properties) { Text($0.name).tag($0.id) }
                    }
                    TextField("Work (e.g. rough-in plumbing)", text: $invoice.work)
                    HStack {
                        Text("Amount")
                        TextField("0.00", value: $invoice.amount, format: .number.precision(.fractionLength(2)))
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                    }
                    DatePicker("Invoice date", selection: $invoice.invoiceDate, displayedComponents: .date)
                    Toggle("Has due date", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Due", selection: Binding(get: { invoice.dueDate ?? .now }, set: { invoice.dueDate = $0 }),
                                   displayedComponents: .date)
                    }
                }
                if invoice.id != nil {
                    Section("Payments matched by invoice #") {
                        let payments = store.expenses.filter {
                            $0.isPaid && $0.invoiceNumber.lowercased() == invoice.invoiceNumber.lowercased() && !invoice.invoiceNumber.isEmpty
                        }
                        if payments.isEmpty { Text("None yet").foregroundStyle(.secondary) }
                        ForEach(payments) { ExpenseRow(expense: $0) }
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(invoice.id == nil ? "New invoice" : "Invoice")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { hasDue = invoice.dueDate != nil }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if !hasDue { invoice.dueDate = nil }
                        do { try store.save(invoice); dismiss() } catch { self.error = error.localizedDescription }
                    }
                    .disabled(invoice.contractor.isEmpty || invoice.invoiceNumber.isEmpty || invoice.amount <= 0)
                }
            }
        }
    }
}
