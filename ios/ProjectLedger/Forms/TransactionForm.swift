import SwiftUI
import LedgerCore

/// Every sheet the app can open, from the Add button or from a screen.
enum FormRoute: Identifiable {
    case scan
    case voice
    case transaction(TransactionDraft)
    case payment(billId: UUID?)
    case contribution(projectId: UUID?, partnerId: UUID? = nil)
    case reimbursement(partnerId: UUID?)
    case commitment(projectId: UUID?)
    case changeOrder(commitmentId: UUID)
    case proceeds(projectId: UUID)
    case project(Project?)
    case budget(UUID)
    case vendor(Vendor?)

    init(_ a: AddAction, projectId: UUID? = nil) {
        switch a {
        case .scan: self = .scan
        case .voice: self = .voice
        case .expense: var d = TransactionDraft(); d.projectId = projectId; self = .transaction(d)
        case .bill: var d = TransactionDraft(); d.kind = .bill; d.payer = .llc; d.projectId = projectId; self = .transaction(d)
        case .payment: self = .payment(billId: nil)
        case .contribution: self = .contribution(projectId: projectId)
        }
    }

    var id: String {
        switch self {
        case .scan: "scan"
        case .voice: "voice"
        case .transaction(let d): "tx-\(d.id)"
        case .payment(let b): "pay-\(b?.uuidString ?? "")"
        case .contribution(let p, let u): "contrib-\(p?.uuidString ?? "")-\(u?.uuidString ?? "")"
        case .reimbursement(let p): "reimb-\(p?.uuidString ?? "")"
        case .commitment(let p): "commit-\(p?.uuidString ?? "")"
        case .changeOrder(let c): "co-\(c)"
        case .proceeds(let p): "proceeds-\(p)"
        case .project(let p): "project-\(p?.id.uuidString ?? "new")"
        case .budget(let p): "budget-\(p)"
        case .vendor(let v): "vendor-\(v?.id.uuidString ?? "new")"
        }
    }
}

struct FormHost: View {
    @Environment(AppModel.self) private var app
    let route: FormRoute

    var body: some View {
        let ws = app.workspace?.id ?? UUID()
        switch route {
        case .scan: ScanFlow()
        case .voice: VoiceFlow()
        case .transaction(let d): NavigationStack { TransactionForm(draft: d) }
        case .payment(let b): PaymentForm(billId: b)
        case .contribution(let p, let u): ContributionForm(projectId: p, partnerId: u ?? app.me)
        case .reimbursement(let p): ReimbursementForm(partnerId: p)
        case .commitment(let p): CommitmentForm(projectId: p)
        case .changeOrder(let c): ChangeOrderForm(commitmentId: c)
        case .proceeds(let p): ProceedsForm(projectId: p)
        case .project(let p): ProjectForm(project: p, workspace: ws)
        case .budget(let p): BudgetEditor(projectId: p)
        case .vendor(let v): VendorForm(vendor: v, workspace: ws)
        }
    }
}

// MARK: - Receipt / bill

/// Receipt (already paid) or bill (owed). Built for one hand: big amount at the top,
/// common choices as large buttons, Save draft and Post at the bottom within thumb reach.
struct TransactionForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var draft: TransactionDraft
    var readFromDocument = false
    var recognizedText: String? = nil
    @State private var busy = false
    @State private var addingFile = false
    @State private var confirmCancel = false
    @FocusState private var amountFocused: Bool

    var body: some View {
        let l = app.ledger
        let dupes = l.possibleDuplicates(vendorId: draft.vendorId, date: draft.date, amountCents: draft.totalCents ?? -1,
                                         invoiceNumber: draft.invoiceNumber, excluding: draft.id)
        Form {
            if readFromDocument {
                Section {
                    Label("Values below were read from the document. Check them before posting.", systemImage: "text.viewfinder")
                        .font(.callout)
                    if let t = recognizedText, !t.isEmpty {
                        DisclosureGroup("Text found on the document") { Text(t).font(.caption.monospaced()).textSelection(.enabled) }
                    }
                }
            }
            if draft.sync == .failed, let m = draft.errorMessage {
                Section { Label(m, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }

            Section {
                Picker("Type", selection: $draft.kind) {
                    Text("Receipt · already paid").tag(TransactionDraft.Kind.receipt)
                    Text("Bill · still owed").tag(TransactionDraft.Kind.bill)
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)
                AmountField(label: "Total", text: $draft.totalText, big: true)
                    .focused($amountFocused)
                ProjectPicker(projectId: $draft.projectId)
                VendorField(vendorId: $draft.vendorId, newName: $draft.newVendorName)
                DayPicker(label: draft.kind == .bill ? "Invoice date" : "Date", day: $draft.date)
            }

            if !dupes.isEmpty {
                Section {
                    ForEach(dupes) { e in EntryRow(entry: e) }
                } header: {
                    Label("Possible duplicate", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                } footer: {
                    Text("Same vendor with the same invoice number, or the same amount within 3 days. Post anyway only if this is a different purchase.")
                }
            }

            if draft.kind == .receipt {
                Section("Who paid") {
                    Picker("Who paid", selection: payerBinding) {
                        Text("Me").tag("me")
                        Text("LLC account").tag("llc")
                        ForEach(l.s.members.filter { $0.userId != app.me && ($0.hasAccess || payerBinding.wrappedValue == $0.userId.uuidString) }) { Text($0.displayName).tag($0.userId.uuidString) }
                    }
                    .pickerStyle(.segmented)
                    MethodPicker(method: $draft.paymentMethod)
                    TextField("Reference (last 4, check #, receipt #)", text: $draft.reference).frame(minHeight: 44)
                    Toggle("This is a refund from the vendor", isOn: $draft.isRefund).frame(minHeight: 44)
                }
            } else {
                Section("Bill details") {
                    TextField("Invoice number", text: $draft.invoiceNumber)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled().frame(minHeight: 44)
                    OptionalDayPicker(label: "Due date", day: $draft.dueDate)
                    let contracts = l.s.commitments.filter { !$0.isVoid && $0.projectId == draft.projectId && $0.vendorId == draft.vendorId }
                    if !contracts.isEmpty {
                        Picker("Against contract", selection: $draft.commitmentId) {
                            Text("None").tag(UUID?.none)
                            ForEach(contracts) { c in
                                Text("\(c.description) (\(Money.format(l.status(commitment: c).unbilledCents, showCents: false)) left)").tag(Optional(c.id))
                            }
                        }
                    }
                }
            }

            categorySection

            Section {
                AmountField(label: "Tax included", text: $draft.taxText)
                TextField("Description (what was it for?)", text: $draft.description, axis: .vertical).frame(minHeight: 44)
            }

            Section {
                ForEach(draft.files) { f in
                    HStack {
                        if let img = UIImage(contentsOfFile: localURL(f)?.path ?? "") {
                            Image(uiImage: img).resizable().scaledToFill().frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 6))
                        } else {
                            Image(systemName: "doc.richtext").frame(width: 44, height: 44)
                        }
                        Text(f.filename).lineLimit(1)
                    }
                    .swipeActions { Button(role: .destructive) { draft.files.removeAll { $0.id == f.id } } label: { Label("Remove", systemImage: "trash") } }
                }
                Button { addingFile = true } label: { Label("Add photo or PDF", systemImage: "paperclip").frame(minHeight: 44) }
            } header: { Text("Documents") }

            Color.clear.frame(height: 80).listRowBackground(Color.clear)
        }
        .navigationTitle(isEditingDraft ? (draft.kind == .bill ? "Bill draft" : "Receipt draft") : (draft.kind == .bill ? "Add Bill" : "Add Expense"))
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { bottomBar }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { cancel() } }
        }
        .confirmationDialog("Keep this for later?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Save draft") { saveDraft() }
            Button("Discard", role: .destructive) { discard() }
            Button("Keep editing", role: .cancel) {}
        }
        .sheet(isPresented: $addingFile) {
            NavigationStack {
                CaptureButtons(scanTitle: "Scan document") { files in
                    for f in files { if let lf = app.storeFile(f.data, filename: f.filename, mimeType: f.mimeType) { draft.files.append(lf) } }
                    addingFile = false
                }
                .padding()
                .navigationTitle("Add document")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { addingFile = false } } }
            }
            .presentationDetents([.medium])
        }
        .onAppear {
            if draft.projectId == nil, app.ledger.s.projects.filter(\.isActive).count == 1 { draft.projectId = app.ledger.s.projects.first(where: \.isActive)?.id }
            if draft.totalText.isEmpty && !readFromDocument { amountFocused = true }
        }
    }

    var categorySection: some View {
        Section {
            if draft.splits.count == 1 {
                Picker("Budget category", selection: $draft.splits[0].categoryId) {
                    Text("Choose…").tag(UUID?.none)
                    ForEach(app.ledger.activeCategories) { Text($0.name).tag(Optional($0.id)) }
                }
                .frame(minHeight: 44)
                Button {
                    draft.splits[0].amountText = draft.totalText
                    draft.splits.append(SplitLine())
                } label: { Label("Split across categories", systemImage: "square.split.2x1").frame(minHeight: 44) }
            } else {
                ForEach($draft.splits) { $line in
                    VStack {
                        Picker("Category", selection: $line.categoryId) {
                            Text("Choose…").tag(UUID?.none)
                            ForEach(app.ledger.activeCategories) { Text($0.name).tag(Optional($0.id)) }
                        }
                        AmountField(label: "Amount", text: $line.amountText)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            draft.splits.removeAll { $0.id == line.id }
                            if draft.splits.count == 1 { draft.splits[0].amountText = "" }
                        } label: { Label("Remove", systemImage: "trash") }
                    }
                }
                Button { draft.splits.append(SplitLine(amountText: draft.unallocatedCents > 0 ? Money.plain(draft.unallocatedCents) : "")) } label: {
                    Label("Add category", systemImage: "plus").frame(minHeight: 44)
                }
                let left = draft.unallocatedCents
                if left == 0 {
                    Label("Split matches the total", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                } else {
                    Label(left > 0 ? "\(Money.format(left)) still to assign" : "\(Money.format(-left)) more than the total",
                          systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
            }
        } header: {
            Text("Budget category")
        } footer: {
            if draft.splits.count > 1 { Text("Category amounts must add up to the total before posting. Swipe a line to remove it.") }
        }
    }

    var bottomBar: some View {
        HStack(spacing: 12) {
            Button { hideKeyboard() } label: {
                Image(systemName: "keyboard.chevron.compact.down").frame(minWidth: 44, minHeight: 54)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Hide keyboard")
            Button { saveDraft() } label: {
                Label("Save draft", systemImage: "tray.and.arrow.down").frame(maxWidth: .infinity, minHeight: 54)
            }
            .buttonStyle(.bordered)
            Button { post() } label: {
                HStack {
                    if busy { ProgressView() } else { Image(systemName: "checkmark.circle.fill") }
                    Text(draft.kind == .bill ? "Post bill" : "Post receipt")
                }
                .frame(maxWidth: .infinity, minHeight: 54)
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy)
        }
        .font(.headline)
        .lineLimit(1)
        .minimumScaleFactor(0.75)   // keep "Save draft" / "Post receipt" on one line
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    var payerBinding: Binding<String> {
        Binding(get: {
            switch draft.payer {
            case .me: "me"
            case .llc: "llc"
            case .partner(let id): id == app.me ? "me" : id.uuidString
            }
        }, set: { v in
            draft.payer = v == "me" ? .me : v == "llc" ? .llc : UUID(uuidString: v).map { .partner($0) } ?? .me
        })
    }

    var isEditingDraft: Bool { app.allDrafts.contains { $0.id == draft.id } }

    func localURL(_ f: LocalFile) -> URL? { app.drafts?.url(f) }

    func saveDraft() {
        var d = draft
        d.sync = .draft
        d.errorMessage = nil
        app.saveDraft(d)
        app.toast = "Draft saved on this phone"
        dismiss()
    }

    func post() {
        hideKeyboard()
        busy = true
        Task {
            if await app.submit(draft) { dismiss() }
            busy = false
        }
    }

    func cancel() {
        let isSaved = app.allDrafts.contains { $0.id == draft.id }
        let hasContent = !draft.totalText.isEmpty || !draft.files.isEmpty || draft.vendorId != nil || !draft.newVendorName.isEmpty
        if !isSaved && hasContent { confirmCancel = true } else { dismiss() }
    }

    func discard() {
        draft.files.forEach { app.drafts?.deleteFile($0) }
        dismiss()
    }

    func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}
