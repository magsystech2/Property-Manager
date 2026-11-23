import SwiftUI
import CoreTransferable
import UniformTypeIdentifiers
import LedgerCore

// MARK: - Vendors

struct VendorsListView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""

    var body: some View {
        let l = app.ledger
        List {
            ForEach(l.s.vendors.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }.sorted { $0.name < $1.name }) { v in
                let owed = l.summary(vendor: v.id).outstandingCents
                NavigationLink(value: Route.vendor(v.id)) {
                    LabeledContent {
                        if owed > 0 { Text("owed \(Money.format(owed))").font(.callout.monospacedDigit()) }
                    } label: {
                        Text(v.name)
                        Text(v.kind.capitalized)
                    }
                    .frame(minHeight: 44)
                }
            }
        }
        .navigationTitle("Vendors")
        .searchable(text: $query)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { app.sheet = .vendor(nil) } label: { Label("New vendor", systemImage: "plus.circle") }
            }
        }
    }
}

struct VendorDetailView: View {
    @Environment(AppModel.self) private var app
    let vendorId: UUID

    var body: some View {
        let l = app.ledger
        if let v = l.vendor(vendorId) {
            let sum = l.summary(vendor: v.id)
            List {
                Section {
                    LabeledContent("Type", value: v.kind.capitalized)
                    if !v.contactName.isEmpty { LabeledContent("Contact", value: v.contactName) }
                    if !v.phone.isEmpty, let url = URL(string: "tel:\(v.phone.filter { $0.isNumber || $0 == "+" })") {
                        Link(destination: url) { LabeledContent("Phone", value: v.phone) }
                    }
                    if !v.email.isEmpty, let url = URL(string: "mailto:\(v.email)") { Link(destination: url) { LabeledContent("Email", value: v.email) } }
                    if !v.address.isEmpty { LabeledContent("Address", value: v.address) }
                    if !v.notes.isEmpty { Text(v.notes).font(.callout) }
                }
                Section {
                    LabeledMoney(label: "Billed (after credits)", cents: sum.billedCents)
                    LabeledMoney(label: "Paid (bills and receipts)", cents: sum.paidCents)
                    NavigationLink(value: Route.records(title: "Owed to \(v.name)",
                                                        refs: sum.entries.filter { $0.ref.kind == .bill && l.balance(bill: $0.id).outstandingCents > 0 }.map(\.ref),
                                                        explanation: "Bills from this vendor with a balance still owed.")) {
                        LabeledMoney(label: "Outstanding", cents: sum.outstandingCents, bold: true)
                    }
                } header: { Text("Balance") }
                Section("Projects") {
                    if sum.projects.isEmpty { Text("None yet").foregroundStyle(.secondary) }
                    ForEach(sum.projects) { p in NavigationLink(value: Route.project(p.id)) { Text(p.nickname).frame(minHeight: 44) } }
                }
                Section("Bills, payments and receipts") { EntryList(entries: sum.entries, empty: "No transactions yet.") }
                Section("Files") {
                    if sum.attachments.isEmpty { Text("No documents yet.").foregroundStyle(.secondary) }
                    ForEach(sum.attachments) { AttachmentRow(attachment: $0, showRecord: true) }
                }
                Section {
                    NavigationLink(value: Route.export(projectId: nil, partnerId: nil, vendorId: v.id)) { Label("Export CSV", systemImage: "square.and.arrow.up") }
                }
                Color.clear.frame(height: 60).listRowBackground(Color.clear)
            }
            .navigationTitle(v.name)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Edit") { app.sheet = .vendor(v) } }
            }
        } else {
            ContentUnavailableView("Vendor not found", systemImage: "questionmark.folder")
        }
    }
}

struct VendorForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var vendor: Vendor
    let isNew: Bool

    init(vendor: Vendor?, workspace: UUID) {
        _vendor = State(initialValue: vendor ?? Vendor(workspaceId: workspace, name: "", kind: "contractor"))
        isNew = vendor == nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $vendor.name).frame(minHeight: 44)
                    Picker("Type", selection: $vendor.kind) { ForEach(Vendor.kinds, id: \.self) { Text($0.capitalized).tag($0) } }
                }
                Section("Contact") {
                    TextField("Contact person", text: $vendor.contactName).frame(minHeight: 44)
                    TextField("Phone", text: $vendor.phone).keyboardType(.phonePad).frame(minHeight: 44)
                    TextField("Email", text: $vendor.email).keyboardType(.emailAddress).textInputAutocapitalization(.never).frame(minHeight: 44)
                    TextField("Address", text: $vendor.address, axis: .vertical).frame(minHeight: 44)
                }
                Section("Notes") { TextField("License #, insurance, terms…", text: $vendor.notes, axis: .vertical).lineLimit(2...6) }
            }
            .navigationTitle(isNew ? "New vendor" : "Edit vendor")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { if await app.save(vendor: vendor) { dismiss() } } }
                        .disabled(vendor.name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

// MARK: - CSV export

struct CSVFile: Transferable {
    let text: String
    let filename: String
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { file in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(file.filename)
            try file.text.data(using: .utf8)!.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }
}

struct ExportView: View {
    @Environment(AppModel.self) private var app
    @State var filter: CSVExport.Filter

    var body: some View {
        let l = app.ledger
        let rows = CSVExport.rows(l, filter)
        let sum: (KeyPath<CSVExport.Row, Cents>) -> Cents = { k in rows.reduce(0) { $0 + $1[keyPath: k] } }
        Form {
            Section {
                ProjectPicker(projectId: $filter.projectId, allowNone: true)
                Picker("Partner", selection: $filter.partnerId) {
                    Text("All").tag(UUID?.none)
                    ForEach(l.s.members) { Text($0.displayName).tag(Optional($0.userId)) }
                }
                Picker("Vendor", selection: $filter.vendorId) {
                    Text("All").tag(UUID?.none)
                    ForEach(l.s.vendors.sorted { $0.name < $1.name }) { Text($0.name).tag(Optional($0.id)) }
                }
                OptionalDayPicker(label: "From date", day: $filter.from)
                OptionalDayPicker(label: "To date", day: $filter.to)
            } header: { Text("What to include") } footer: {
                if filter.projectId == nil && filter.partnerId == nil && filter.vendorId == nil { Text("“None / LLC-wide” exports every project.") }
            }
            Section {
                LabeledContent("Rows", value: "\(rows.count)")
                LabeledMoney(label: "Project paid cost", cents: sum(\.paidCost))
                LabeledMoney(label: "Unpaid billed", cents: sum(\.unpaidBilled))
                LabeledMoney(label: "Committed, not billed", cents: sum(\.unbilledCommitted))
                LabeledMoney(label: "Partner paid personally", cents: sum(\.outOfPocket))
                LabeledMoney(label: "Partner reimbursed", cents: sum(\.reimbursed))
                LabeledMoney(label: "Contributions", cents: sum(\.contribution))
                LabeledMoney(label: "Sale proceeds", cents: sum(\.proceeds))
            } header: { Text("Totals in this file") } footer: {
                Text("These columns add up to the same totals the app shows (for example, a project's paid costs). Each row has the transaction ID and attachment file names so you can match documents.")
            }
            Section {
                ShareLink(item: CSVFile(text: CSVExport.csv(l, filter), filename: CSVExport.filename(l, filter)),
                          preview: SharePreview(CSVExport.filename(l, filter))) {
                    Label("Share or save CSV", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .navigationTitle("Export CSV")
    }
}

// MARK: - Drafts

struct DraftsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let drafts = app.allDrafts
        let pending = app.pendingAttachments
        List {
            Section {
                if drafts.isEmpty { Text("No drafts. Use “Save draft” on a receipt or bill to finish it later.").foregroundStyle(.secondary) }
                ForEach(drafts) { d in
                    Button { if d.sync != .waiting { app.sheet = .transaction(d) } } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(d.title).font(.headline).foregroundStyle(.primary)
                            Text([app.ledger.vendor(d.vendorId)?.name ?? (d.newVendorName.isEmpty ? nil : d.newVendorName),
                                  app.ledger.project(d.projectId)?.nickname, Days.display(d.date)].compactMap { $0 }.joined(separator: " · "))
                                .font(.subheadline).foregroundStyle(.secondary)
                            SyncBadge(state: d.sync)
                            if let m = d.errorMessage { Text(m).font(.caption).foregroundStyle(d.sync == .failed ? .red : .secondary) }
                            if !d.files.isEmpty { Label("\(d.files.count) file\(d.files.count == 1 ? "" : "s") on this phone", systemImage: "paperclip").font(.caption) }
                        }
                        .frame(minHeight: 44, alignment: .leading)
                    }
                    .swipeActions {
                        if d.sync != .waiting {
                            Button(role: .destructive) { app.deleteDraft(d) } label: { Label("Delete", systemImage: "trash") }
                        }
                    }
                }
            } header: { Text("Receipts and bills") } footer: {
                Text("Drafts can be edited or deleted. “Waiting to sync” items are already posted from this phone and upload automatically when there's a connection.")
            }
            if !pending.isEmpty {
                Section("Documents waiting to upload") {
                    ForEach(pending) { p in PendingFileRow(file: p.file, message: p.errorMessage) }
                }
            }
            Section {
                Button { Task { await app.syncPending() } } label: { Label("Try syncing now", systemImage: "arrow.clockwise").frame(minHeight: 44) }
            }
        }
        .navigationTitle("On this phone")
    }
}
