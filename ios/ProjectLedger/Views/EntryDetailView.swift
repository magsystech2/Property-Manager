import SwiftUI
import LedgerCore

/// One record: its details, money effect, documents, approvals and history.
struct EntryDetailView: View {
    @Environment(AppModel.self) private var app
    let ref: EntryRef
    @State private var voiding = false
    @State private var attaching = false
    @State private var markingPaid = false

    var body: some View {
        let l = app.ledger
        if let entry = l.entry(ref) {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(ref.kind.label.uppercased()).font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        Text(entry.title).font(.title2.bold())
                        MoneyText(cents: entry.amountCents, font: .largeTitle.weight(.bold))
                        StatusBadge(status: entry.status)
                    }
                    .padding(.vertical, 6)
                    .accessibilityElement(children: .combine)
                }
                ReviewBanner(ref: ref)

                details(entry)
                actions(entry)

                Section {
                    let files = l.attachments(for: ref)
                    let pending = app.pending(for: ref)
                    if files.isEmpty && pending.isEmpty { Text("No documents yet.").foregroundStyle(.secondary) }
                    ForEach(files) { AttachmentRow(attachment: $0) }
                    ForEach(pending) { PendingFileRow(file: $0.file, message: $0.errorMessage) }
                    Button { attaching = true } label: {
                        Label("Attach receipt or confirmation", systemImage: "paperclip").frame(minHeight: 44)
                    }
                } header: {
                    Text("Documents")
                } footer: {
                    Text("Adding a document never changes amounts or balances.")
                }

                history(entry)
            }
            .navigationTitle(ref.kind.label)
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $attaching) { AttachSheet(ref: ref) }
            .sheet(isPresented: $voiding) {
                VoidSheet { reason in Task { await app.change(ref, .void(reason: reason), success: "Voided") } }
            }
            .sheet(isPresented: $markingPaid) { MarkPaidSheet(ref: ref) }
        } else {
            ContentUnavailableView("Record not found", systemImage: "questionmark.folder")
        }
    }

    // MARK: Details per kind

    @ViewBuilder func details(_ entry: Entry) -> some View {
        let l = app.ledger
        switch ref.kind {
        case .expense:
            if let e = l.s.expenses.first(where: { $0.id == ref.id }) {
                Section {
                    projectRow(e.projectId)
                    vendorRow(e.vendorId)
                    LabeledContent("Date", value: Days.display(e.expenseDate))
                    if !e.description.isEmpty { LabeledContent("Description", value: e.description) }
                    if e.isRefund { Label("Refund from the vendor: reduces project cost", systemImage: "arrow.uturn.backward") }
                    LabeledContent("Paid by", value: l.payerName(e.paidByUserId))
                    LabeledContent("Method", value: PaymentMethod(rawValue: e.paymentMethod)?.label ?? e.paymentMethod)
                    if !e.reference.isEmpty { LabeledContent("Reference", value: e.reference) }
                    if e.taxCents > 0 { LabeledMoney(label: "Tax (included)", cents: e.taxCents) }
                } footer: {
                    if e.paidByUserId != nil && !e.isVoid {
                        Text("Paid personally: counted once as a project cost, and added to what the LLC owes \(l.payerName(e.paidByUserId)).")
                    }
                }
                NotesSection(ref: ref, notes: e.notes ?? "", locked: e.isVoid)
                splits(l.allocations(expense: e.id))
            }
        case .bill:
            if let b = l.bill(ref.id) {
                let bal = l.balance(bill: b.id)
                Section {
                    projectRow(b.projectId)
                    vendorRow(b.vendorId)
                    if !b.invoiceNumber.isEmpty { LabeledContent("Invoice #", value: b.invoiceNumber) }
                    LabeledContent("Bill date", value: Days.display(b.billDate))
                    LabeledContent("Due", value: Days.display(b.dueDate))
                    if !b.description.isEmpty { LabeledContent("Description", value: b.description) }
                    if let cid = b.commitmentId, let c = l.s.commitments.first(where: { $0.id == cid }) {
                        NavigationLink(value: EntryRef(.commitment, c.id)) { LabeledContent("Against contract", value: c.description) }
                    }
                }
                NotesSection(ref: ref, notes: b.notes ?? "", locked: b.isVoid)
                Section("Balance") {
                    LabeledMoney(label: "Invoice total", cents: bal.totalCents)
                    if bal.creditsCents > 0 { LabeledMoney(label: "Vendor credits", cents: -bal.creditsCents) }
                    LabeledMoney(label: "Paid", cents: bal.paidCents)
                    LabeledMoney(label: "Still owed", cents: bal.outstandingCents, bold: true)
                }
                splits(l.allocations(bill: b.id))
                Section("Payments, credits and refunds") {
                    let ps = l.payments(bill: b.id)
                    if ps.isEmpty { Text("No payments yet.").foregroundStyle(.secondary) }
                    ForEach(ps) { p in
                        if let e = l.entry(EntryRef(.payment, p.id)) { NavigationLink(value: e.ref) { EntryRow(entry: e) } }
                    }
                }
            }
        case .payment:
            if let p = l.s.payments.first(where: { $0.id == ref.id }) {
                Section {
                    LabeledContent("Type", value: p.kindLabel)
                    if let b = l.bill(p.billId) {
                        NavigationLink(value: EntryRef(.bill, b.id)) {
                            LabeledContent("Bill", value: [l.vendor(b.vendorId)?.name, b.invoiceNumber.isEmpty ? nil : "#\(b.invoiceNumber)"].compactMap { $0 }.joined(separator: " "))
                        }
                        projectRow(b.projectId)
                    }
                    LabeledContent("Date", value: Days.display(p.paymentDate))
                    if p.kind != "credit" { LabeledContent("Paid by", value: l.payerName(p.paidByUserId)) }
                    LabeledContent("Method", value: PaymentMethod(rawValue: p.paymentMethod)?.label ?? p.paymentMethod)
                    if !p.reference.isEmpty { LabeledContent("Reference", value: p.reference) }
                }
            }
        case .reimbursement:
            if let r = l.s.reimbursements.first(where: { $0.id == ref.id }) {
                Section {
                    NavigationLink(value: Route.partner(r.partnerUserId)) { LabeledContent("Partner", value: l.payerName(r.partnerUserId)) }
                    LabeledContent("Requested", value: Days.display(r.requestDate))
                    if let d = r.paidDate { LabeledContent("Paid", value: Days.display(d)) }
                    if r.isPaid { LabeledContent("Method", value: PaymentMethod(rawValue: r.paymentMethod)?.label ?? r.paymentMethod) }
                    if !r.reference.isEmpty { LabeledContent("Reference", value: r.reference) }
                    if !r.notes.isEmpty { LabeledContent("Notes", value: r.notes) }
                } footer: {
                    Text("Reimbursements reduce what the LLC owes the partner. They are not project costs.")
                }
                let items = l.s.reimbursementItems.filter { $0.reimbursementId == r.id }
                if !items.isEmpty {
                    Section("Covers") {
                        ForEach(items) { i in
                            let itemRef = i.expenseId.map { EntryRef(.expense, $0) } ?? i.billPaymentId.map { EntryRef(.payment, $0) }
                            if let itemRef, let e = l.entry(itemRef) {
                                NavigationLink(value: itemRef) {
                                    LabeledContent { MoneyText(cents: i.amountCents) } label: { Text(e.title); Text(Days.display(e.date)) }
                                }
                            }
                        }
                    }
                }
            }
        case .contribution:
            if let c = l.s.contributions.first(where: { $0.id == ref.id }) {
                Section {
                    LabeledContent("Partner", value: l.payerName(c.partnerUserId))
                    if let pid = c.projectId { projectRow(pid) } else { LabeledContent("Project", value: "LLC-wide") }
                    LabeledContent("Date", value: Days.display(c.contributionDate))
                    LabeledContent("Method", value: PaymentMethod(rawValue: c.paymentMethod)?.label ?? c.paymentMethod)
                    if !c.reference.isEmpty { LabeledContent("Reference", value: c.reference) }
                    if !c.notes.isEmpty { LabeledContent("Notes", value: c.notes) }
                } footer: {
                    Text("Capital put into the LLC. Recorded separately from reimbursements and doesn't change what the LLC owes for expenses.")
                }
            }
        case .proceeds:
            if let p = l.s.proceeds.first(where: { $0.id == ref.id }) {
                Section {
                    projectRow(p.projectId)
                    LabeledContent("Sale date", value: Days.display(p.saleDate))
                    if let g = p.grossPriceCents { LabeledMoney(label: "Sale price", cents: g) }
                    if let c = p.sellingCostsCents { LabeledMoney(label: "Selling costs", cents: -c) }
                    LabeledMoney(label: "Net proceeds", cents: p.amountCents, bold: true)
                    if let lp = p.loanPayoffCents, lp > 0 { LabeledMoney(label: "Loan paid off at closing", cents: lp) }
                    if !p.notes.isEmpty { LabeledContent("Notes", value: p.notes) }
                }
            }
        case .distribution:
            if let d = l.s.distributions.first(where: { $0.id == ref.id }) {
                Section {
                    LabeledContent("Partner", value: l.payerName(d.partnerUserId))
                    if let pid = d.projectId { projectRow(pid) } else { LabeledContent("Project", value: "LLC-wide") }
                    LabeledContent("Date", value: Days.display(d.distributionDate))
                    LabeledContent("Method", value: PaymentMethod(rawValue: d.paymentMethod)?.label ?? d.paymentMethod)
                    if !d.reference.isEmpty { LabeledContent("Reference", value: d.reference) }
                    if !d.notes.isEmpty { LabeledContent("Notes", value: d.notes) }
                } footer: {
                    Text("Paid out to a partner from a sale: capital back and profit share. Separate from reimbursements for receipts.")
                }
            }
        case .commitment:
            if let c = l.s.commitments.first(where: { $0.id == ref.id }) {
                let st = l.status(commitment: c)
                Section {
                    projectRow(c.projectId)
                    vendorRow(c.vendorId)
                    LabeledContent("Category", value: l.category(c.categoryId)?.name ?? "-")
                    if !c.description.isEmpty { LabeledContent("Scope", value: c.description) }
                }
                Section {
                    LabeledMoney(label: "Original amount", cents: st.originalCents)
                    LabeledMoney(label: "Approved change orders", cents: st.approvedChangeOrdersCents)
                    if st.pendingChangeOrdersCents != 0 { LabeledMoney(label: "Change orders awaiting approval", cents: st.pendingChangeOrdersCents) }
                    LabeledMoney(label: "Revised amount", cents: st.revisedCents, bold: true)
                    LabeledMoney(label: "Billed so far", cents: st.billedCents)
                    LabeledMoney(label: "Not billed yet", cents: st.unbilledCents, bold: true)
                } header: { Text("Contract") } footer: {
                    Text("When the contractor invoices against this contract, the amount moves from “not billed” to the bill, so projected spend isn't counted twice.")
                }
                Section("Change orders") {
                    let cos = l.s.changeOrders.filter { $0.commitmentId == c.id }
                    if cos.isEmpty { Text("None").foregroundStyle(.secondary) }
                    ForEach(cos) { co in
                        if let e = l.entry(EntryRef(.changeOrder, co.id)) { NavigationLink(value: e.ref) { EntryRow(entry: e) } }
                    }
                    if !c.isVoid {
                        Button { app.sheet = .changeOrder(commitmentId: c.id) } label: { Label("Add change order", systemImage: "plus").frame(minHeight: 44) }
                    }
                }
                Section("Bills against this contract") {
                    let bills = l.entries().filter { $0.ref.kind == .bill && l.bill($0.id)?.commitmentId == c.id }
                    EntryList(entries: bills, empty: "No bills yet.")
                    if !c.isVoid {
                        Button {
                            var d = TransactionDraft()
                            d.kind = .bill; d.projectId = c.projectId; d.vendorId = c.vendorId; d.commitmentId = c.id
                            d.splits = [SplitLine(categoryId: c.categoryId)]
                            app.sheet = .transaction(d)
                        } label: { Label("Add bill for this contract", systemImage: "doc.badge.plus").frame(minHeight: 44) }
                    }
                }
            }
        case .changeOrder:
            if let co = l.s.changeOrders.first(where: { $0.id == ref.id }) {
                Section {
                    NavigationLink(value: EntryRef(.commitment, co.commitmentId)) { LabeledContent("Contract", value: entry.title) }
                    if !co.description.isEmpty { LabeledContent("Description", value: co.description) }
                }
            }
        }
    }

    @ViewBuilder func splits(_ allocations: [Allocation]) -> some View {
        if !allocations.isEmpty {
            Section("Budget categories") {
                ForEach(allocations) { a in LabeledMoney(label: app.ledger.category(a.categoryId)?.name ?? "Category", cents: a.amountCents) }
            }
        }
    }

    func projectRow(_ id: UUID) -> some View {
        NavigationLink(value: Route.project(id)) { LabeledContent("Project", value: app.ledger.project(id)?.nickname ?? "-") }
    }
    func vendorRow(_ id: UUID) -> some View {
        NavigationLink(value: Route.vendor(id)) { LabeledContent("Vendor", value: app.ledger.vendor(id)?.name ?? "-") }
    }

    // MARK: Actions

    @ViewBuilder func actions(_ entry: Entry) -> some View {
        let l = app.ledger
        let me = app.me
        let status = recordStatus
        let isVoid = status == RecordStatus.void
        let needsApproval = status == RecordStatus.pendingReview || status == RecordStatus.requested
        Section {
            if needsApproval {
                let creator = entry.createdBy
                let partner = ref.kind == .reimbursement ? entry.partnerId : nil
                if creator == me || partner == me {
                    Label("Waiting for another partner to approve", systemImage: "hourglass").frame(minHeight: 44)
                } else {
                    Button { Task { await app.change(ref, .approve, success: "Approved") } } label: {
                        Label("Approve", systemImage: "checkmark.seal.fill").frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            if ref.kind == .reimbursement, status == RecordStatus.approved || (status == RecordStatus.requested && app.workspace?.requireReview == false) {
                Button { markingPaid = true } label: { Label("Mark as paid to partner", systemImage: "banknote").frame(minHeight: 44) }
            }
            if ref.kind == .bill, status == RecordStatus.posted, l.balance(bill: ref.id).outstandingCents > 0 {
                Button { app.sheet = .payment(billId: ref.id) } label: {
                    Label("Record payment", systemImage: "banknote").frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
            }
            if ref.kind == .expense || ref.kind == .bill, let t = templateFrom(ref) {
                Button { app.sheet = .template(t) } label: { Label("Save as template (recurring cost)", systemImage: "repeat").frame(minHeight: 44) }
            }
            if ref.kind == .commitment, !isVoid {
                Button { app.sheet = .draw(commitmentId: ref.id, draw: nil) } label: { Label("Schedule a draw (cash plan)", systemImage: "calendar.badge.plus").frame(minHeight: 44) }
            }
            if (ref.kind == .expense || ref.kind == .bill) && !isVoid {
                if let why = app.correctionBlocker(ref) {
                    Label("Correct: \(why)", systemImage: "pencil.slash").font(.footnote).foregroundStyle(.secondary)
                } else {
                    Button { app.sheet = .correct(ref) } label: {
                        Label("Correct amount, date, vendor or category…", systemImage: "pencil").frame(minHeight: 44)
                    }
                }
            }
            if app.ledger.reviewFlags(for: ref).isEmpty {
                Button { app.sheet = .reviewFlag(ref) } label: {
                    Label("Mark as needs review", systemImage: "exclamationmark.triangle").frame(minHeight: 44)
                }
            }
            Button { app.sheet = .report(ref: ref, error: nil, page: "\(ref.kind.label) detail") } label: {
                Label("Report an issue", systemImage: "exclamationmark.bubble").frame(minHeight: 44)
            }
            if !isVoid {
                Button(role: .destructive) { voiding = true } label: { Label("Void…", systemImage: "xmark.circle").frame(minHeight: 44) }
            }
        } footer: {
            if !isVoid { Text("Posted records can't be edited or deleted. Void with a reason and enter a corrected record instead.") }
        }
    }

    /// A new template copying a receipt or bill: vendor, project, amount, category, payer.
    func templateFrom(_ ref: EntryRef) -> EntryTemplate? {
        let s = app.ledger.s
        if let e = s.expenses.first(where: { $0.id == ref.id }) {
            return EntryTemplate(workspaceId: e.workspaceId, name: "\(app.ledger.vendor(e.vendorId)?.name ?? "Receipt"), \(app.ledger.project(e.projectId)?.nickname ?? "")",
                                 kind: "receipt", projectId: e.projectId, vendorId: e.vendorId,
                                 categoryId: s.allocations.first { $0.expenseId == e.id }?.categoryId, amountCents: e.totalCents,
                                 paidByUserId: e.paidByUserId, paymentMethod: e.paymentMethod, description: e.description)
        }
        if let b = s.bills.first(where: { $0.id == ref.id }) {
            return EntryTemplate(workspaceId: b.workspaceId, name: "\(app.ledger.vendor(b.vendorId)?.name ?? "Bill"), \(app.ledger.project(b.projectId)?.nickname ?? "")",
                                 kind: "bill", projectId: b.projectId, vendorId: b.vendorId,
                                 categoryId: s.allocations.first { $0.billId == b.id }?.categoryId, amountCents: b.totalCents, description: b.description)
        }
        return nil
    }

    var recordStatus: String {
        let s = app.ledger.s
        switch ref.kind {
        case .expense: return s.expenses.first { $0.id == ref.id }?.status ?? ""
        case .bill: return s.bills.first { $0.id == ref.id }?.status ?? ""
        case .payment: return s.payments.first { $0.id == ref.id }?.status ?? ""
        case .reimbursement: return s.reimbursements.first { $0.id == ref.id }?.status ?? ""
        case .contribution: return s.contributions.first { $0.id == ref.id }?.status ?? ""
        case .proceeds: return s.proceeds.first { $0.id == ref.id }?.status ?? ""
        case .distribution: return s.distributions.first { $0.id == ref.id }?.status ?? ""
        case .commitment: return s.commitments.first { $0.id == ref.id }?.status ?? ""
        case .changeOrder: return s.changeOrders.first { $0.id == ref.id }?.status ?? ""
        }
    }

    // MARK: History

    @ViewBuilder func history(_ entry: Entry) -> some View {
        let l = app.ledger
        let events = l.s.audit.filter { $0.recordId == ref.id }.sorted { $0.at < $1.at }
        Section("History") {
            if events.isEmpty, let by = entry.createdBy {
                LabeledContent("Entered by", value: l.payerName(by))
            }
            ForEach(events) { a in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(actionLabel(a.action)) by \(a.actor.map { l.payerName($0) } ?? "system")").font(.subheadline.weight(.semibold))
                    Text(timestamp(a.at)).font(.caption).foregroundStyle(.secondary)
                    if let r = a.reason, !r.isEmpty { Text("Reason: \(r)").font(.caption) }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    func actionLabel(_ a: String) -> String {
        switch a {
        case "insert": "Entered"
        case "update": "Updated"
        case "approve": "Approved"
        case "void": "Voided"
        case "paid": "Marked paid"
        default: a.capitalized
        }
    }

    func timestamp(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        return d?.formatted(date: .abbreviated, time: .shortened) ?? iso
    }
}

struct MarkPaidSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let ref: EntryRef
    @State private var date = Days.today
    @State private var method = "ach"
    @State private var reference = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DayPicker(label: "Paid on", day: $date)
                    MethodPicker(method: $method)
                    TextField("Reference (check #, Zelle ID…)", text: $reference).frame(minHeight: 44)
                } footer: {
                    Text("Records a reimbursement the LLC already paid outside the app. No money is moved.")
                }
            }
            .navigationTitle("Mark paid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        busy = true
                        Task {
                            if await app.change(ref, .markPaid(date: date, method: method, reference: reference), success: "Reimbursement paid") { dismiss() }
                            busy = false
                        }
                    }
                    .disabled(busy)
                }
            }
        }
        .presentationDetents([.medium])
    }
}


/// Notes on a receipt or bill (migration 07). A note never changes money, so it can be edited after posting.
/// Hidden on a void record that has no note.
struct NotesSection: View {
    @Environment(AppModel.self) private var app
    let ref: EntryRef
    let notes: String
    let locked: Bool
    @State private var editing = false
    @State private var text = ""
    @State private var saving = false

    var body: some View {
        if !(locked && notes.isEmpty) {
            Section {
                if editing {
                    TextField("Add a note", text: $text, axis: .vertical).frame(minHeight: 60)
                    HStack {
                        Button("Cancel") { editing = false }.buttonStyle(.borderless)
                        Spacer()
                        Button("Save") {
                            saving = true
                            Task {
                                let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
                                if await app.change(ref, .notes(t), success: "Notes saved") { editing = false }
                                saving = false
                            }
                        }
                        .buttonStyle(.borderless).bold()
                        .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines) == notes)
                    }
                } else if notes.isEmpty {
                    Button { text = ""; editing = true } label: { Label("Add a note", systemImage: "square.and.pencil") }
                } else {
                    Text(notes).textSelection(.enabled)
                    if !locked {
                        Button { text = notes; editing = true } label: { Label("Edit note", systemImage: "square.and.pencil") }
                    }
                }
            } header: {
                Text("Notes")
            } footer: {
                if editing { Text("Every change to a note is recorded in the history.") }
            }
        }
    }
}
