import SwiftUI
import LedgerCore

// Borrowed money (migration 09), Needs review flags (migration 10) and correcting a receipt or bill in place.
// Same behavior as the web app's LoanForm, BorrowedSection, NeedsReview page, ReviewAlert and correction flow.

// MARK: - Borrowed money

/// Personal loans partners took to fund their part, for one project or all. Reference only.
struct BorrowedSection: View {
    @Environment(AppModel.self) private var app
    let projectId: UUID?

    var body: some View {
        let l = app.ledger
        let rows = l.loans(project: projectId)
        Section {
            if rows.isEmpty {
                Text("No personal loans recorded\(projectId == nil ? "" : " for this project"). Add one when a partner borrows to fund their part.")
                    .foregroundStyle(.secondary)
            } else {
                LabeledMoney(label: "Owed now on \(rows.filter { !$0.loan.isClosed }.count) loan(s)", cents: rows.reduce(0) { $0 + $1.owedNowCents }, bold: true)
                LabeledMoney(label: "Interest per month now", cents: rows.reduce(0) { $0 + $1.monthlyInterestCents })
            }
            ForEach(rows) { r in
                Button { app.sheet = .loan(r.loan, projectId: projectId) } label: { LoanRow(status: r) }
                    .buttonStyle(.plain)
            }
            Button { app.sheet = .loan(nil, projectId: projectId) } label: { Label("Add loan", systemImage: "plus.circle").frame(minHeight: 44) }
        } header: {
            Text("Borrowed money")
        } footer: {
            Text("For reference only: this money is already counted as the partner's contribution or personal payment, so loans don't change anyone's balance or payout. Interest is simple yearly interest from the date borrowed. Tap a loan to edit it or record a payment.")
        }
    }
}

struct LoanRow: View {
    @Environment(AppModel.self) private var app
    let status: LoanStatus
    var body: some View {
        let l = app.ledger
        let loan = status.loan
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(l.payerName(loan.partnerUserId)) · \(loan.lender)").font(.headline)
                if loan.isClosed { Text("Paid off").font(.caption.weight(.semibold)).padding(.horizontal, 6).background(.quaternary, in: Capsule()) }
                Spacer()
                MoneyText(cents: status.owedNowCents, font: .subheadline.weight(.bold))
            }
            Text("\(Money.format(loan.principalCents)) at \(Money.splitPct(loan.rateBps)) since \(Days.display(loan.startDate)) · \(l.project(loan.projectId)?.nickname ?? "LLC")")
                .font(.caption).foregroundStyle(.secondary)
            Text("Interest so far \(Money.format(status.interestAccruedCents)) · paid \(Money.format(status.interestPaidCents)) · principal back \(Money.format(status.principalRepaidCents)) · \(Money.format(status.monthlyInterestCents))/mo")
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Add or edit a partner's personal loan, and record what's been paid on it. Reference only: balances don't change.
struct LoanForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let existing: PartnerLoan?
    @State private var partnerId: UUID?
    @State private var projectId: UUID?
    @State private var lender: String
    @State private var amount: String
    @State private var rate: String
    @State private var start: Day
    @State private var paidOff: Bool
    @State private var notes: String
    @State private var busy = false
    @State private var confirmRemove = false

    init(loan: PartnerLoan?, projectId: UUID?, me: UUID?) {
        existing = loan
        _partnerId = State(initialValue: loan?.partnerUserId ?? me)
        _projectId = State(initialValue: loan?.projectId ?? projectId)
        _lender = State(initialValue: loan?.lender ?? "")
        _amount = State(initialValue: loan.map { Money.plain($0.principalCents) } ?? "")
        _rate = State(initialValue: loan.map { $0.rateBps == 0 ? "" : Money.splitPct($0.rateBps).replacingOccurrences(of: "%", with: "") } ?? "")
        _start = State(initialValue: loan?.startDate ?? Days.today)
        _paidOff = State(initialValue: loan?.isClosed ?? false)
        _notes = State(initialValue: loan?.notes ?? "")
    }

    var rateValue: Double? { rate.isEmpty ? 0 : Double(rate.replacingOccurrences(of: ",", with: ".")) }
    var problem: String? {
        if partnerId == nil { return "Pick the partner who borrowed." }
        if lender.trimmingCharacters(in: .whitespaces).isEmpty { return "Who lent the money?" }
        if (Money.parse(amount) ?? 0) <= 0 { return "Enter the amount borrowed." }
        guard let r = rateValue, r >= 0, r <= 100 else { return "Enter a yearly rate between 0 and 100%." }
        return nil
    }
    var row: PartnerLoan? {
        guard let ws = app.workspace?.id, let partnerId else { return nil }
        var x = existing ?? PartnerLoan(workspaceId: ws, partnerUserId: partnerId)
        x.partnerUserId = partnerId; x.projectId = projectId; x.lender = lender.trimmingCharacters(in: .whitespaces)
        x.principalCents = Money.parse(amount) ?? 0; x.rateBps = Int(((rateValue ?? 0) * 100).rounded()); x.startDate = start
        x.status = paidOff ? "closed" : "open"; x.notes = notes
        return x
    }

    var body: some View {
        FormShell(title: existing == nil ? "Add borrowed money" : "Edit loan", saveTitle: "Save", canSave: problem == nil, busy: busy, onSave: save) {
            Section {
                PartnerPicker(label: "Partner who borrowed", partnerId: $partnerId)
                TextField("Lender (friends, family, bank…)", text: $lender).frame(minHeight: 44)
                AmountField(label: "Initial amount borrowed", text: $amount)
                HStack {
                    Text("Interest rate (% a year)")
                    Spacer()
                    TextField("10", text: $rate).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 90)
                }
                .frame(minHeight: 44)
                DayPicker(label: "Borrowed on", day: $start)
                Picker("Used for", selection: $projectId) {
                    Text("The LLC in general").tag(UUID?.none)
                    ForEach(app.ledger.s.projects.sorted { $0.nickname < $1.nickname }) { Text($0.nickname).tag(Optional($0.id)) }
                }
                .frame(minHeight: 44)
                Toggle("Paid off", isOn: $paidOff).frame(minHeight: 44)
                TextField("Notes (terms, check number…)", text: $notes, axis: .vertical).frame(minHeight: 44)
            } footer: {
                Text(problem ?? "For reference only. The money is already in the books as this partner's contribution or personal payment, so this doesn't change any balance.")
            }
            if let existing, let row {
                let st = Loans.status(row, payments: app.ledger.s.partnerLoanPayments, today: app.ledger.today)
                Section("So far") {
                    LabeledMoney(label: "Initial amount", cents: row.principalCents)
                    LabeledMoney(label: "Interest built up so far", cents: st.interestAccruedCents)
                    LabeledMoney(label: "Interest paid", cents: st.interestPaidCents)
                    LabeledMoney(label: "Principal paid back", cents: st.principalRepaidCents)
                    LabeledMoney(label: "Owed now", cents: st.owedNowCents, bold: true)
                }
                LoanPaymentsSection(loan: existing)
                Section {
                    Button("Remove this loan", role: .destructive) { confirmRemove = true }
                        .confirmationDialog("Remove this loan and its payments?", isPresented: $confirmRemove, titleVisibility: .visible) {
                            Button("Remove", role: .destructive) {
                                Task { if await app.perform(.deleteLoan(id: existing.id), success: "Loan removed") { dismiss() } }
                            }
                        }
                }
            }
        }
    }

    func save() {
        guard let row else { return }
        busy = true
        Task {
            if await app.perform(.saveLoan(row), success: "Loan saved") { dismiss() }
            busy = false
        }
    }
}

private struct LoanPaymentsSection: View {
    @Environment(AppModel.self) private var app
    let loan: PartnerLoan
    @State private var date = Days.today
    @State private var amount = ""
    @State private var principal = false
    @State private var note = ""

    var body: some View {
        let list = app.ledger.s.partnerLoanPayments.filter { $0.loanId == loan.id }.sorted { $0.paidOn > $1.paidOn }
        Section {
            if list.isEmpty { Text("No payments recorded yet.").foregroundStyle(.secondary) }
            ForEach(list) { p in
                HStack {
                    VStack(alignment: .leading) {
                        Text("\(Days.display(p.paidOn)) · \(p.kind == "principal" ? "Principal" : "Interest")")
                        if !p.note.isEmpty { Text(p.note).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    MoneyText(cents: p.amountCents, font: .body.weight(.semibold))
                }
                .swipeActions {
                    Button(role: .destructive) { Task { await app.perform(.deleteLoanPayment(id: p.id), success: "Payment removed") } } label: { Label("Remove", systemImage: "trash") }
                }
            }
            DayPicker(label: "Paid on", day: $date)
            AmountField(label: "Amount", text: $amount)
            Picker("Type", selection: $principal) {
                Text("Interest").tag(false)
                Text("Principal").tag(true)
            }
            .pickerStyle(.segmented)
            TextField("Note (optional)", text: $note).frame(minHeight: 44)
            Button("Add payment") {
                let row = PartnerLoanPayment(workspaceId: loan.workspaceId, loanId: loan.id, paidOn: date, amountCents: Money.parse(amount) ?? 0,
                                             kind: principal ? "principal" : "interest", note: note.trimmingCharacters(in: .whitespaces))
                Task { if await app.perform(.saveLoanPayment(row), success: "Payment saved") { amount = ""; note = "" } }
            }
            .disabled((Money.parse(amount) ?? 0) <= 0)
        } header: {
            Text("Payments to the lender")
        } footer: {
            Text("Swipe left on a payment to remove it.")
        }
    }
}

// MARK: - Needs review

/// A bright banner while entries are flagged "needs review" (all of them, or one project's). Hidden when there are none.
struct ReviewAlert: View {
    @Environment(AppModel.self) private var app
    var projectId: UUID?

    var body: some View {
        let l = app.ledger
        var seen = Set<UUID>()
        let items: [Entry] = l.reviewFlags.compactMap { r in
            guard let ref = r.ref, !seen.contains(ref.id), let e = l.entry(ref) else { return nil }
            seen.insert(ref.id)
            return projectId == nil || e.projectId == projectId ? e : nil
        }
        if !items.isEmpty {
            let names = Array(NSOrderedSet(array: items.map { projectId == nil ? (l.project($0.projectId)?.nickname ?? $0.title) : $0.title })) as? [String] ?? []
            Section {
                NavigationLink(value: Route.needsReview) {
                    HStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.title2).foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(items.count) \(items.count == 1 ? "entry needs" : "entries need") review").font(.headline)
                            Text("\(Money.format(items.reduce(0) { $0 + $1.amountCents })) · \(names.prefix(3).joined(separator: ", "))\(names.count > 3 ? " and \(names.count - 3) more" : "")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("Review now").font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(Color.orange.opacity(0.14))
            }
        }
    }
}

/// Mark a record as needs review, with a note. It shows on the Needs review screen until a partner marks it reviewed.
struct ReviewFlagForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let ref: EntryRef
    @State private var note = ""
    @State private var busy = false

    var body: some View {
        let entry = app.ledger.entry(ref)
        FormShell(title: "Mark as needs review", saveTitle: "Mark needs review", canSave: !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  busy: busy, onSave: save) {
            if let entry {
                Section(entry.ref.kind.label) { LabeledContent(entry.title) { MoneyText(cents: entry.amountCents) } }
            }
            Section {
                TextField("What should be checked? e.g. Confirm the date with the bank statement", text: $note, axis: .vertical)
                    .frame(minHeight: 80, alignment: .top)
            } footer: {
                Text("It goes on the Needs review list for all partners. Nothing about the amounts changes.")
            }
        }
    }

    func save() {
        busy = true
        Task {
            if await app.reportIssue(category: .needsReview, note: note, ref: ref, error: nil, page: "\(ref.kind.label) detail", screenshot: nil) { dismiss() }
            busy = false
        }
    }
}

/// Open "needs review" flags on one record, with a button to mark it reviewed. Shown at the top of the record.
struct ReviewBanner: View {
    @Environment(AppModel.self) private var app
    let ref: EntryRef
    @State private var marking = false
    @State private var note = ""

    var body: some View {
        let l = app.ledger
        let flags = l.reviewFlags(for: ref)
        if !flags.isEmpty {
            Section {
                ForEach(flags) { r in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.note)
                        Text("\(r.createdBy == nil ? "Import" : l.payerName(r.createdBy)) · \(r.createdAt.map { Days.display(String($0.prefix(10))) } ?? "")")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if marking {
                    TextField("Optional: what you found", text: $note, axis: .vertical)
                    Button("Done") { Task { if await app.markReviewed(flags, note: note) { marking = false; note = "" } } }.bold()
                } else {
                    Button { marking = true } label: { Label("Mark reviewed", systemImage: "checkmark.circle").frame(minHeight: 44) }
                }
            } header: {
                Label("Needs review", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }
            .listRowBackground(Color.orange.opacity(0.1))
        }
    }
}

/// Records a partner marked "needs review", in one place. Open one to check or correct it, then mark it reviewed.
struct NeedsReviewView: View {
    @Environment(AppModel.self) private var app
    @State private var tab = 0
    @State private var projectId: UUID?

    var body: some View {
        let l = app.ledger
        let inProject: (IssueReport) -> Bool = { r in projectId == nil || (r.ref.flatMap { l.entry($0) }?.projectId == projectId) }
        let open = l.reviewFlags.filter(inProject)
        let done = l.s.issueReports.filter { $0.isReviewFlag && !$0.isOpen && inProject($0) }.sorted { ($0.resolvedAt ?? "") > ($1.resolvedAt ?? "") }
        let groups: [(key: String, ref: EntryRef?, items: [IssueReport])] = open.reduce(into: []) { acc, r in
            let key = r.ref.map { "\($0.kind.rawValue):\($0.id)" } ?? r.id.uuidString
            if let i = acc.firstIndex(where: { $0.key == key }) { acc[i].items.append(r) } else { acc.append((key, r.ref, [r])) }
        }
        let total = groups.reduce(0) { $0 + ($1.ref.flatMap { l.entry($0) }?.amountCents ?? 0) }
        List {
            Section {
                ProjectPicker(projectId: $projectId, allowNone: true)
                Picker("Show", selection: $tab) {
                    Text("To review (\(groups.count))").tag(0)
                    Text("Reviewed (\(done.count))").tag(1)
                }
                .pickerStyle(.segmented)
            } footer: {
                if tab == 0 && !groups.isEmpty {
                    Text("\(groups.count) \(groups.count == 1 ? "entry" : "entries") to review · \(Money.format(total)). To flag another one, open it and tap Needs review.")
                }
            }
            if tab == 0 {
                if groups.isEmpty { Section { Text("Nothing waiting for review.").foregroundStyle(.secondary) } }
                ForEach(groups, id: \.key) { g in ReviewGroupSection(ref: g.ref, items: g.items) }
            } else {
                Section {
                    if done.isEmpty { Text("Nothing reviewed yet.").foregroundStyle(.secondary) }
                    ForEach(done) { r in
                        VStack(alignment: .leading, spacing: 4) {
                            if let ref = r.ref, let e = l.entry(ref) {
                                NavigationLink(value: ref) { Text("\(e.title) · \(Money.format(e.amountCents))").font(.headline) }
                            }
                            Text(r.note).font(.subheadline)
                            Text("Reviewed by \(l.payerName(r.resolvedBy)) · \(r.resolvedAt.map { Days.display(String($0.prefix(10))) } ?? "")\(r.resolution.map { $0 == "Reviewed" ? "" : ": \($0)" } ?? "")")
                                .font(.caption).foregroundStyle(.green)
                            Button("Reopen") { Task { await app.setIssue(r, resolved: false) } }.buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
        .navigationTitle("Needs review")
        .refreshable { await app.reload() }
    }
}

private struct ReviewGroupSection: View {
    @Environment(AppModel.self) private var app
    let ref: EntryRef?
    let items: [IssueReport]
    @State private var marking = false
    @State private var note = ""

    var body: some View {
        let l = app.ledger
        let entry = ref.flatMap { l.entry($0) }
        Section {
            if let entry {
                NavigationLink(value: entry.ref) { EntryRow(entry: entry) }
            } else {
                Text("\(ref?.kind.label ?? "Record") (not found)").foregroundStyle(.secondary)
            }
            ForEach(items) { r in
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.note).font(.subheadline.weight(.semibold))
                    Text("\(r.createdBy == nil ? "Import" : l.payerName(r.createdBy)) · \(r.createdAt.map { Days.display(String($0.prefix(10))) } ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if marking {
                TextField("Optional: what you found, e.g. Matches the bank statement", text: $note, axis: .vertical)
                Button("Done") { Task { if await app.markReviewed(items, note: note) { marking = false } } }.bold()
            } else {
                Button { marking = true } label: { Label("Mark reviewed", systemImage: "checkmark.circle").frame(minHeight: 44) }
            }
        }
    }
}

// MARK: - Correct a receipt or bill

/// Change a posted receipt or bill. The original is voided with a note saying what changed, and a fixed copy is posted
/// with the same documents. Nothing is ever silently overwritten.
struct CorrectForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let ref: EntryRef
    @State private var amount = ""
    @State private var date = Days.today
    @State private var dueDate: Day?
    @State private var description = ""
    @State private var invoice = ""
    @State private var vendorId: UUID?
    @State private var projectId: UUID?
    @State private var paidBy: UUID?
    @State private var categoryId: UUID?
    @State private var split = false
    @State private var loaded = false
    @State private var busy = false

    var isBill: Bool { ref.kind == .bill }

    var body: some View {
        let l = app.ledger
        FormShell(title: isBill ? "Correct bill" : "Correct receipt", saveTitle: "Save correction", canSave: (Money.parse(amount) ?? 0) > 0 && vendorId != nil && projectId != nil,
                  busy: busy, onSave: save) {
            Section {
                AmountField(label: "Amount", text: $amount, big: true)
                ProjectPicker(projectId: $projectId)
                Picker("Vendor", selection: $vendorId) {
                    ForEach(l.s.vendors.sorted { $0.name < $1.name }) { Text($0.name).tag(Optional($0.id)) }
                }
                .frame(minHeight: 44)
                if split {
                    LabeledContent("Category", value: "Split (change with Void and enter again)")
                } else {
                    Picker("Category", selection: $categoryId) {
                        ForEach(l.activeCategories) { Text($0.name).tag(Optional($0.id)) }
                        if let c = categoryId, !l.activeCategories.contains(where: { $0.id == c }) { Text(l.category(c)?.name ?? "Category").tag(Optional(c)) }
                    }
                    .frame(minHeight: 44)
                }
                DayPicker(label: isBill ? "Bill date" : "Date", day: $date)
                if isBill {
                    OptionalDayPicker(label: "Due date", day: $dueDate)
                    TextField("Invoice #", text: $invoice).frame(minHeight: 44)
                } else {
                    PartnerPicker(label: "Paid by", partnerId: $paidBy, allowLLC: true)
                }
                TextField("Description", text: $description, axis: .vertical).frame(minHeight: 44)
            } footer: {
                Text("The original is voided with a note saying what changed, and a corrected copy is posted with the same documents and bank match. The history keeps both.")
            }
        }
        .onAppear(perform: load)
    }

    func load() {
        guard !loaded else { return }
        loaded = true
        let s = app.ledger.s
        if let e = s.expenses.first(where: { $0.id == ref.id }) {
            amount = Money.plain(e.totalCents); date = e.expenseDate; description = e.description
            vendorId = e.vendorId; projectId = e.projectId; paidBy = e.paidByUserId
            let a = s.allocations.filter { $0.expenseId == e.id }
            split = a.count > 1; categoryId = a.first?.categoryId
        } else if let b = s.bills.first(where: { $0.id == ref.id }) {
            amount = Money.plain(b.totalCents); date = b.billDate; dueDate = b.dueDate; description = b.description; invoice = b.invoiceNumber
            vendorId = b.vendorId; projectId = b.projectId
            let a = s.allocations.filter { $0.billId == b.id }
            split = a.count > 1; categoryId = a.first?.categoryId
        }
    }

    func save() {
        let patch = CorrectionPatch(totalCents: Money.parse(amount), date: date, dueDate: isBill ? .some(dueDate) : nil,
                                    description: description, invoiceNumber: isBill ? invoice.trimmingCharacters(in: .whitespaces) : nil,
                                    vendorId: vendorId, projectId: projectId, paidByUserId: isBill ? nil : .some(paidBy),
                                    categoryId: split ? nil : categoryId)
        busy = true
        Task {
            let before = app.toast
            let r = await app.correct(ref, patch)
            busy = false
            if r != nil { dismiss() } else if app.errorMessage == nil && app.toast == before { app.toast = "Nothing changed" ; dismiss() }
        }
    }
}
