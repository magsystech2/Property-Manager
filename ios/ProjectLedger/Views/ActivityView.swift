import SwiftUI
import LedgerCore

struct ActivityView: View {
    @Environment(AppModel.self) private var app
    @State private var filter = Ledger.Filter()
    @State private var showFilters = false
    @State private var attachTo: EntryRef?

    var body: some View {
        let l = app.ledger
        let results = l.search(filter)
        let words = filter.text.trimmingCharacters(in: .whitespaces).lowercased()
        let projectHits = words.isEmpty ? [] : Array(l.s.projects.filter { "\($0.nickname) \($0.address)".lowercased().contains(words) }.prefix(6))
        let vendorHits = words.isEmpty ? [] : Array(l.s.vendors.filter { $0.name.lowercased().contains(words) }.prefix(6))
        let total = results.filter { $0.status.text != "Void" }.reduce(0) { $0 + $1.amountCents }
        List {
            if !projectHits.isEmpty || !vendorHits.isEmpty {
                Section("Properties and vendors") {
                    ForEach(projectHits) { p in NavigationLink(value: Route.project(p.id)) { Label(p.nickname, systemImage: "building.2") } }
                    ForEach(vendorHits) { v in NavigationLink(value: Route.vendor(v.id)) { Label(v.name, systemImage: "storefront") } }
                }
            }
            if activeFilterCount > 0 {
                Section {
                    HStack {
                        Label("\(activeFilterCount) filter\(activeFilterCount == 1 ? "" : "s") on", systemImage: "line.3.horizontal.decrease.circle.fill")
                        Spacer()
                        Button("Clear") { let t = filter.text; filter = Ledger.Filter(); filter.text = t }
                    }
                    .frame(minHeight: 44)
                }
            }
            Section {
                if results.isEmpty { Text("No matching records.").foregroundStyle(.secondary) }
                ForEach(results) { e in
                    NavigationLink(value: e.ref) { EntryRow(entry: e) }
                        .swipeActions(edge: .trailing) {
                            Button { attachTo = e.ref } label: { Label("Attach", systemImage: "paperclip") }.tint(.blue)
                        }
                        .contextMenu {
                            Button { attachTo = e.ref } label: { Label("Attach receipt or confirmation", systemImage: "paperclip") }
                            if e.ref.kind == .bill, app.ledger.balance(bill: e.id).outstandingCents > 0 {
                                Button { app.sheet = .payment(billId: e.id) } label: { Label("Record payment", systemImage: "banknote") }
                            }
                        }
                }
            } header: {
                Text("\(results.count) records")
            } footer: {
                if !words.isEmpty && !results.isEmpty {
                    Text("Matching records add up to \(Money.format(total)) (void ones left out). Several words find records that have all of them; “412” finds $412.00 to $412.99.")
                } else {
                    Text("Swipe left on a record, or touch and hold, to attach a receipt or payment confirmation.")
                }
            }
        }
        .navigationTitle("Activity")
        .searchable(text: $filter.text, prompt: "Description, vendor, amount, invoice #, notes…")
        .refreshable { await app.reload() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { showFilters = true } label: {
                    Label("Filters", systemImage: activeFilterCount > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    NavigationLink(value: Route.vendors) { Label("Vendors", systemImage: "person.crop.rectangle.stack") }
                    NavigationLink(value: Route.export(projectId: filter.projectId, partnerId: filter.partnerId, vendorId: filter.vendorId)) {
                        Label("Export CSV", systemImage: "square.and.arrow.up")
                    }
                    NavigationLink(value: Route.drafts) { Label("Drafts on this phone", systemImage: "tray.full") }
                } label: { Label("More", systemImage: "ellipsis.circle") }
            }
        }
        .sheet(isPresented: $showFilters) { FilterSheet(filter: $filter) }
        .sheet(item: $attachTo) { ref in AttachSheet(ref: ref) }
    }

    var activeFilterCount: Int {
        [filter.projectId != nil, filter.vendorId != nil, filter.partnerId != nil, filter.categoryId != nil,
         filter.statusText != nil, filter.from != nil, filter.to != nil, !filter.kinds.isEmpty].filter { $0 }.count
    }
}

struct FilterSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Binding var filter: Ledger.Filter

    static let statuses = ["Paid", "Unpaid", "Partly paid", "Overdue", "Needs approval", "Requested", "Approved, not paid",
                           "Recorded", "Committed", "Approved", "Void"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Type") {
                    ForEach(EntryKind.allCases, id: \.self) { k in
                        Toggle(k.label, isOn: Binding(get: { filter.kinds.contains(k) }, set: { on in
                            if on { filter.kinds.insert(k) } else { filter.kinds.remove(k) }
                        }))
                    }
                }
                Section {
                    ProjectPicker(projectId: $filter.projectId, allowNone: true)
                    Picker("Vendor", selection: $filter.vendorId) {
                        Text("Any").tag(UUID?.none)
                        ForEach(app.ledger.s.vendors.sorted { $0.name < $1.name }) { Text($0.name).tag(Optional($0.id)) }
                    }
                    Picker("Partner", selection: $filter.partnerId) {
                        Text("Any").tag(UUID?.none)
                        ForEach(app.ledger.s.members) { Text($0.displayName).tag(Optional($0.userId)) }
                    }
                    Picker("Category", selection: $filter.categoryId) {
                        Text("Any").tag(UUID?.none)
                        ForEach(app.ledger.activeCategories) { Text($0.name).tag(Optional($0.id)) }
                    }
                    Picker("Status", selection: $filter.statusText) {
                        Text("Any").tag(String?.none)
                        ForEach(Self.statuses, id: \.self) { Text($0).tag(Optional($0)) }
                    }
                } footer: {
                    Text("Partner shows records where that partner's own money moved: personal payments, reimbursements and contributions.")
                }
                Section("Dates") {
                    OptionalDayPicker(label: "From", day: $filter.from)
                    OptionalDayPicker(label: "To", day: $filter.to)
                }
                Section { Button("Clear all filters", role: .destructive) { let t = filter.text; filter = Ledger.Filter(); filter.text = t } }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
