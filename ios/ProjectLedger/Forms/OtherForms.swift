import SwiftUI
import LedgerCore

/// Shared shell: Cancel, a big Save button at the bottom, and a busy state that blocks double taps.
struct FormShell<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let saveTitle: String
    let canSave: Bool
    let busy: Bool
    let onSave: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack {
            Form {
                content
                Color.clear.frame(height: 70).listRowBackground(Color.clear)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Button(action: onSave) {
                    HStack { if busy { ProgressView() }; Text(saveTitle) }.frame(maxWidth: .infinity, minHeight: 54)
                }
                .buttonStyle(.borderedProminent)
                .font(.headline)
                .disabled(!canSave || busy)
                .padding(.horizontal).padding(.vertical, 8)
                .background(.bar)
            }
        }
    }
}

/// Optional supporting document picked inside a form, uploaded after the record is saved.
struct FormFiles: View {
    var title = "Payment confirmation"
    @Binding var files: [PickedFile]
    @State private var adding = false
    var body: some View {
        Section(title) {
            ForEach(files.indices, id: \.self) { i in Label(files[i].filename, systemImage: "paperclip") }
            Button { adding = true } label: { Label("Add photo or PDF", systemImage: "paperclip").frame(minHeight: 44) }
        }
        .sheet(isPresented: $adding) {
            CaptureButtons(scanTitle: "Scan document") { f in files += f; adding = false }
                .padding()
                .presentationDetents([.medium])
        }
    }
}

extension AppModel {
    func attach(_ files: [PickedFile], to ref: EntryRef) async {
        for f in files { await attach(f.data, filename: f.filename, mimeType: f.mimeType, to: ref) }
    }
}

// MARK: - Bill payment

struct PaymentForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var billId: UUID?
    @State private var id = UUID()          // fixed per form: a second tap can't create a second payment
    @State private var kind = "payment"
    @State private var amount = ""
    @State private var date = Days.today
    @State private var payer: UUID?
    @State private var method = "check"
    @State private var reference = ""
    @State private var files: [PickedFile] = []
    @State private var busy = false

    var body: some View {
        let l = app.ledger
        let open = l.s.bills.filter { $0.status == RecordStatus.posted && l.balance(bill: $0.id).outstandingCents > 0 }
            .sorted { ($0.dueDate ?? $0.billDate) < ($1.dueDate ?? $1.billDate) }
        let bal = billId.map { l.balance(bill: $0) }
        let cents = Money.parse(amount) ?? 0
        let amountProblem = problem(cents: cents, balance: bal)
        let similar = billId.map { bid in l.payments(bill: bid).filter { !$0.isVoid && $0.amountCents == cents && Swift.abs(Days.daysBetween($0.paymentDate, date)) <= 3 } } ?? []

        FormShell(title: "Record Payment", saveTitle: "Save payment", canSave: billId != nil && cents > 0 && amountProblem == nil, busy: busy, onSave: save) {
            Section {
                Picker("Bill", selection: $billId) {
                    Text("Choose a bill…").tag(UUID?.none)
                    if let b = billId.flatMap({ l.bill($0) }), !open.contains(b) { Text(label(b)).tag(Optional(b.id)) }
                    ForEach(open) { b in Text(label(b)).tag(Optional(b.id)) }
                }
                .pickerStyle(.navigationLink)
                if let bal {
                    LabeledMoney(label: "Still owed on this bill", cents: bal.outstandingCents, bold: true)
                }
            } footer: {
                if open.isEmpty && billId == nil { Text("No unpaid bills. Add the bill first, then record its payment.") }
            }
            Section {
                Picker("Type", selection: $kind) {
                    Text("Payment").tag("payment"); Text("Vendor credit").tag("credit"); Text("Vendor refund").tag("refund")
                }
                .pickerStyle(.segmented)
                AmountField(label: "Amount", text: $amount, big: true)
                if let amountProblem {
                    Label(amountProblem, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout.weight(.semibold)).foregroundStyle(.red)
                }
                if let bal, kind == "payment" {
                    Button("Pay full balance \(Money.format(bal.outstandingCents))") { amount = Money.plain(bal.outstandingCents) }
                        .frame(minHeight: 44)
                }
                DayPicker(label: "Date", day: $date)
            } footer: {
                Text(kind == "credit" ? "A credit memo lowers what you owe without any cash moving." :
                        kind == "refund" ? "Money the vendor gave back. Raises the bill's balance and lowers paid costs." :
                        "Partial payments are fine. The app won't let payments exceed what's owed.")
            }
            if kind != "credit" {
                Section {
                    PartnerPicker(label: kind == "refund" ? "Refund went to" : "Paid by", partnerId: $payer, allowLLC: true)
                    MethodPicker(method: $method)
                    TextField("Check #, confirmation #…", text: $reference).frame(minHeight: 44)
                } footer: {
                    if payer != nil && kind == "payment" { Text("Paid personally: the LLC will owe \(l.payerName(payer)) this amount until it's reimbursed.") }
                }
            }
            if !similar.isEmpty {
                Section {
                    Label("A \(Money.format(cents)) payment on this bill was already recorded on \(Days.display(similar[0].paymentDate)). Make sure this isn't the same payment.",
                          systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
            }
            FormFiles(files: $files)
        }
        .onAppear { if billId == nil, open.count == 1 { billId = open[0].id } }
    }

    /// Shown under the amount while it's invalid; disappears as soon as it's fixed.
    func problem(cents: Cents, balance: BillBalance?) -> String? {
        guard let balance, cents > 0 else { return nil }
        switch kind {
        case "refund":
            return cents > balance.paidCents ? "A refund can't be more than the \(Money.format(balance.paidCents)) paid on this bill." : nil
        default:
            return cents > balance.outstandingCents ? "Only \(Money.format(balance.outstandingCents)) is still owed on this bill." : nil
        }
    }

    func label(_ b: Bill) -> String {
        let l = app.ledger
        let inv = b.invoiceNumber.isEmpty ? "" : " #\(b.invoiceNumber)"
        return "\(l.vendor(b.vendorId)?.name ?? "Vendor")\(inv) · \(l.project(b.projectId)?.nickname ?? "") · owes \(Money.format(l.balance(bill: b.id).outstandingCents))"
    }

    func save() {
        guard let ws = app.workspace?.id, let billId, let cents = Money.parse(amount) else { return }
        let p = BillPayment(id: id, workspaceId: ws, billId: billId, kind: kind, paymentDate: date, amountCents: cents,
                            paidByUserId: kind == "credit" ? nil : payer, paymentMethod: method, reference: reference, clientId: id)
        do { try Rules.checkPayment(p, in: app.ledger) } catch { app.errorMessage = error.localizedDescription; return }
        busy = true
        Task {
            if await app.insert(.payment(p), success: "\(p.kindLabel) recorded") {
                await app.attach(files, to: EntryRef(.payment, id))
                dismiss()
            }
            busy = false
        }
    }
}

// MARK: - Contribution

struct ContributionForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var projectId: UUID?
    @State var partnerId: UUID?
    @State private var id = UUID()
    @State private var amount = ""
    @State private var date = Days.today
    @State private var method = "ach"
    @State private var reference = ""
    @State private var notes = ""
    @State private var files: [PickedFile] = []
    @State private var busy = false

    var body: some View {
        FormShell(title: "Add Contribution", saveTitle: "Save contribution", canSave: partnerId != nil && (Money.parse(amount) ?? 0) > 0, busy: busy, onSave: save) {
            Section {
                PartnerPicker(label: "Partner", partnerId: $partnerId)
                AmountField(label: "Amount", text: $amount, big: true)
                ProjectPicker(projectId: $projectId, allowNone: true)
                DayPicker(label: "Date", day: $date)
            } footer: {
                Text("Capital a partner put into the LLC. Kept separate from reimbursements and from sale proceeds.")
            }
            Section {
                MethodPicker(method: $method)
                TextField("Reference", text: $reference).frame(minHeight: 44)
                TextField("Notes", text: $notes, axis: .vertical)
            }
            FormFiles(title: "Deposit confirmation", files: $files)
        }
    }

    func save() {
        guard let ws = app.workspace?.id, let partnerId, let cents = Money.parse(amount) else { return }
        let c = Contribution(id: id, workspaceId: ws, partnerUserId: partnerId, projectId: projectId, amountCents: cents,
                             contributionDate: date, paymentMethod: method, reference: reference, notes: notes, clientId: id)
        busy = true
        Task {
            if await app.insert(.contribution(c), success: "Contribution saved") {
                await app.attach(files, to: EntryRef(.contribution, id))
                dismiss()
            }
            busy = false
        }
    }
}

// MARK: - Reimbursement

struct ReimbursementForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var partnerId: UUID?
    @State private var id = UUID()
    @State private var selected: [EntryRef: String] = [:]
    @State private var manualAmount = ""
    @State private var payNow = true
    @State private var date = Days.today
    @State private var method = "ach"
    @State private var reference = ""
    @State private var notes = ""
    @State private var files: [PickedFile] = []
    @State private var busy = false

    var body: some View {
        let l = app.ledger
        let review = app.workspace?.requireReview ?? false
        let owed = partnerId.map { l.partnerBalance($0).owedCents } ?? 0
        let items = partnerId.map { l.reimbursableItems($0) } ?? []
        let total = totalCents
        FormShell(title: "Reimbursement", saveTitle: review || !payNow ? "Request reimbursement" : "Save reimbursement",
                  canSave: partnerId != nil && total > 0, busy: busy, onSave: save) {
            Section {
                PartnerPicker(label: "Partner", partnerId: $partnerId)
                if partnerId != nil { LabeledMoney(label: "LLC owes them", cents: owed, bold: true) }
            }
            if !items.isEmpty {
                Section {
                    ForEach(items, id: \.ref) { item in
                        let on = selected[item.ref] != nil
                        VStack(alignment: .leading) {
                            Toggle(isOn: Binding(get: { on }, set: { v in selected[item.ref] = v ? Money.plain(item.remainingCents) : nil })) {
                                VStack(alignment: .leading) {
                                    Text(item.entry.title)
                                    Text("\(Days.display(item.entry.date)) · \(l.project(item.entry.projectId)?.nickname ?? "") · \(Money.format(item.remainingCents)) open")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            if on {
                                AmountField(label: "Reimburse", text: Binding(get: { selected[item.ref] ?? "" }, set: { selected[item.ref] = $0 }))
                            }
                        }
                        .frame(minHeight: 44)
                    }
                    Button("Select all") { for i in items { selected[i.ref] = Money.plain(i.remainingCents) } }
                } header: { Text("What it covers") } footer: {
                    Text("Pick one or several expenses. Lower an amount for a partial reimbursement.")
                }
            }
            if selected.isEmpty {
                Section {
                    AmountField(label: "Amount", text: $manualAmount, big: true)
                } footer: { Text("Or enter an amount without picking items.") }
            } else {
                Section { LabeledMoney(label: "Total", cents: total, bold: true) }
            }
            if total > owed && partnerId != nil {
                Section { Label("That's more than the \(Money.format(owed)) the LLC owes.", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            }
            Section {
                if review {
                    Label("Review is on: another partner approves this, then it's marked paid.", systemImage: "hourglass")
                } else {
                    Picker("Status", selection: $payNow) {
                        Text("Already paid").tag(true); Text("Request").tag(false)
                    }
                    .pickerStyle(.segmented)
                }
                if payNow && !review {
                    DayPicker(label: "Paid on", day: $date)
                    MethodPicker(method: $method)
                    TextField("Reference", text: $reference).frame(minHeight: 44)
                }
                TextField("Notes", text: $notes, axis: .vertical)
            } footer: {
                Text("Records money the LLC paid the partner outside the app. It lowers what's owed and never changes project costs.")
            }
            FormFiles(files: $files)
        }
    }

    var totalCents: Cents {
        selected.isEmpty ? (Money.parse(manualAmount) ?? 0) : selected.values.reduce(0) { $0 + (Money.parse($1) ?? 0) }
    }

    func save() {
        guard let ws = app.workspace?.id, let partnerId else { return }
        let review = app.workspace?.requireReview ?? false
        let paid = payNow && !review
        let r = Reimbursement(id: id, workspaceId: ws, partnerUserId: partnerId, amountCents: totalCents, requestDate: Days.today,
                              paidDate: paid ? date : nil, status: paid ? RecordStatus.paid : RecordStatus.requested,
                              paymentMethod: method, reference: reference, notes: notes, clientId: id)
        if paid {
            do { try Rules.checkReimbursementPaid(r, in: app.ledger) } catch { app.errorMessage = error.localizedDescription; return }
        }
        let items = selected.compactMap { pair -> ReimbursementItem? in
            let ref = pair.key
            guard let c = Money.parse(pair.value), c > 0 else { return nil }
            return ReimbursementItem(workspaceId: ws, reimbursementId: id, expenseId: ref.kind == .expense ? ref.id : nil,
                                     billPaymentId: ref.kind == .payment ? ref.id : nil, amountCents: c)
        }
        busy = true
        Task {
            if await app.insert(.reimbursement(r, items), success: paid ? "Reimbursement saved" : "Reimbursement requested") {
                await app.attach(files, to: EntryRef(.reimbursement, id))
                dismiss()
            }
            busy = false
        }
    }
}

// MARK: - Commitment, change order, sale proceeds

struct CommitmentForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var projectId: UUID?
    @State private var id = UUID()
    @State private var vendorId: UUID?
    @State private var newVendor = ""
    @State private var newVendorId = UUID()
    @State private var categoryId: UUID?
    @State private var description = ""
    @State private var amount = ""
    @State private var files: [PickedFile] = []
    @State private var busy = false

    var body: some View {
        let ok = projectId != nil && (vendorId != nil || !newVendor.isEmpty) && categoryId != nil && (Money.parse(amount) ?? 0) > 0
        FormShell(title: "Commitment", saveTitle: "Save commitment", canSave: ok, busy: busy, onSave: save) {
            Section {
                ProjectPicker(projectId: $projectId)
                VendorField(vendorId: $vendorId, newName: $newVendor)
                Picker("Budget category", selection: $categoryId) {
                    Text("Choose…").tag(UUID?.none)
                    ForEach(app.ledger.activeCategories) { Text($0.name).tag(Optional($0.id)) }
                }
                TextField("Scope (e.g. Full rough-in plumbing)", text: $description, axis: .vertical).frame(minHeight: 44)
                AmountField(label: "Agreed amount", text: $amount, big: true)
            } footer: {
                Text("A contract or quote you've agreed to. It counts toward projected spend as “committed, not billed” until invoices arrive.")
            }
            FormFiles(title: "Contract or quote", files: $files)
        }
    }

    func save() {
        guard let ws = app.workspace?.id, let projectId, let categoryId, let cents = Money.parse(amount) else { return }
        busy = true
        Task {
            var vid = vendorId
            if vid == nil {
                if let existing = app.ledger.s.vendors.first(where: { $0.name.lowercased() == newVendor.lowercased() }) { vid = existing.id }
                else if await app.save(vendor: Vendor(id: newVendorId, workspaceId: ws, name: newVendor, kind: "contractor")) { vid = newVendorId }
            }
            guard let vid else { busy = false; return }
            vendorId = vid
            let c = Commitment(id: id, workspaceId: ws, projectId: projectId, vendorId: vid, categoryId: categoryId,
                               description: description, amountCents: cents, clientId: id)
            if await app.insert(.commitment(c), success: "Commitment saved") {
                await app.attach(files, to: EntryRef(.commitment, id))
                dismiss()
            }
            busy = false
        }
    }
}

struct ChangeOrderForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let commitmentId: UUID
    @State private var id = UUID()
    @State private var description = ""
    @State private var amount = ""
    @State private var reduces = false
    @State private var busy = false

    var body: some View {
        FormShell(title: "Change order", saveTitle: "Save change order", canSave: (Money.parse(amount) ?? 0) > 0, busy: busy, onSave: save) {
            Section {
                if let c = app.ledger.s.commitments.first(where: { $0.id == commitmentId }) {
                    LabeledContent("Contract", value: "\(app.ledger.vendor(c.vendorId)?.name ?? "") · \(c.description)")
                }
                TextField("What changed?", text: $description, axis: .vertical).frame(minHeight: 44)
                AmountField(label: "Amount", text: $amount, big: true)
                Toggle("This reduces the contract", isOn: $reduces).frame(minHeight: 44)
            } footer: {
                Text(app.workspace?.requireReview == true ? "Another partner must approve this before it counts." : "Approved change orders adjust the contract's unbilled amount.")
            }
        }
    }

    func save() {
        guard let ws = app.workspace?.id, let cents = Money.parse(amount) else { return }
        let co = ChangeOrder(id: id, workspaceId: ws, commitmentId: commitmentId, description: description,
                             amountCents: reduces ? -cents : cents, clientId: id)
        busy = true
        Task {
            if await app.insert(.changeOrder(co), success: "Change order saved") { dismiss() }
            busy = false
        }
    }
}

struct ProceedsForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let projectId: UUID
    @State private var id = UUID()
    @State private var amount = ""
    @State private var date = Days.today
    @State private var notes = ""
    @State private var markSold = true
    @State private var busy = false

    var body: some View {
        FormShell(title: "Sale proceeds", saveTitle: "Save sale proceeds", canSave: (Money.parse(amount) ?? 0) > 0, busy: busy, onSave: save) {
            Section {
                LabeledContent("Project", value: app.ledger.project(projectId)?.nickname ?? "")
                AmountField(label: "Net proceeds", text: $amount, big: true)
                DayPicker(label: "Sale date", day: $date)
                TextField("Notes (closing statement details)", text: $notes, axis: .vertical)
                if app.ledger.project(projectId)?.status != "sold" { Toggle("Mark the project as sold", isOn: $markSold).frame(minHeight: 44) }
            } footer: {
                Text("Stored separately from partner contributions. Used for the project's profit estimate.")
            }
        }
    }

    func save() {
        guard let ws = app.workspace?.id, let cents = Money.parse(amount) else { return }
        let p = SaleProceed(id: id, workspaceId: ws, projectId: projectId, amountCents: cents, saleDate: date, notes: notes, clientId: id)
        busy = true
        Task {
            if await app.insert(.proceeds(p), success: "Sale proceeds saved") {
                if markSold, var project = app.ledger.project(projectId), project.status != "sold" {
                    project.status = "sold"
                    _ = await app.save(project: project)
                }
                dismiss()
            }
            busy = false
        }
    }
}
