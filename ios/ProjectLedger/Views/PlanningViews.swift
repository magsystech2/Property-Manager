import SwiftUI
import UniformTypeIdentifiers
import LedgerCore

// Receipt inbox, statement matching, weekly review, cash plan, templates and reports. Same rules as the web app.

// MARK: - Receipt inbox

struct InboxView: View {
    @Environment(AppModel.self) private var app
    @State private var adding = false
    @State private var dismissing: InboxItem?
    @State private var showHandled = false

    var body: some View {
        let l = app.ledger
        let items = l.s.inboxItems.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        let new = items.filter { $0.status == "new" }
        let handled = items.filter { $0.status != "new" }
        List {
            Section {
                Button { adding = true } label: { Label("Add photos or PDFs", systemImage: "tray.and.arrow.down").frame(minHeight: 44) }
            } footer: {
                Text("Drop a receipt or invoice here now and file it later. You can also share a PDF or photo to Project Ledger from Mail, Files or Photos.")
            }
            Section("To file (\(new.count))") {
                if new.isEmpty { Text("Nothing waiting. Nice.").foregroundStyle(.secondary) }
                ForEach(new) { i in
                    VStack(alignment: .leading, spacing: 8) {
                        InboxRow(item: i)
                        HStack {
                            Button { app.sheet = .transaction(app.inboxDraft(i)) } label: {
                                Text(i.suggestedKind == "bill" ? "File as bill" : "File as receipt").frame(minHeight: 36)
                            }
                            .buttonStyle(.borderedProminent)
                            Menu {
                                Button("File as receipt") { var d = app.inboxDraft(i); d.kind = .receipt; app.sheet = .transaction(d) }
                                Button("File as bill") { var d = app.inboxDraft(i); d.kind = .bill; d.payer = .llc; app.sheet = .transaction(d) }
                                Button("Dismiss…", role: .destructive) { dismissing = i }
                                claimButtons(.inboxItem, i.id)
                            } label: { Label("More", systemImage: "ellipsis.circle").frame(minHeight: 36) }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            if !handled.isEmpty {
                Section {
                    DisclosureGroup("Filed and dismissed (\(handled.count))", isExpanded: $showHandled) {
                        ForEach(handled) { i in
                            VStack(alignment: .leading, spacing: 6) {
                                InboxRow(item: i)
                                if i.status == "filed", let ref = i.filedExpenseId.map({ EntryRef(.expense, $0) }) ?? i.filedBillId.map({ EntryRef(.bill, $0) }) {
                                    NavigationLink(value: ref) { Text("Open the \(ref.kind.label.lowercased())").font(.callout) }
                                } else if i.status == "dismissed" {
                                    HStack {
                                        Text("Dismissed: \(i.dismissReason ?? "")").font(.caption).foregroundStyle(.secondary)
                                        Spacer()
                                        Button("Put back") { Task { await app.perform(.reopenInbox(id: i.id), success: "Back in the inbox") } }.font(.caption)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Receipt inbox")
        .sheet(isPresented: $adding) { AddToInboxSheet() }
        .sheet(item: $dismissing) { i in
            ReasonSheet(title: "Dismiss", prompt: "Why? (duplicate, personal, not ours…)", action: "Dismiss") { reason in
                Task { await app.perform(.dismissInbox(id: i.id, reason: reason), success: "Dismissed") }
            }
        }
    }

    @ViewBuilder func claimButtons(_ kind: ClaimKind, _ id: UUID) -> some View {
        if let c = app.ledger.claim(kind, id) {
            Button("Release claim (\(app.ledger.payerName(c.claimedBy)))") { Task { await app.perform(.releaseClaim(id: c.id), success: "Released") } }
        } else {
            Button("I’ll handle this") { Task { await app.claim(kind, id) } }
        }
    }
}

struct InboxRow: View {
    @Environment(AppModel.self) private var app
    let item: InboxItem
    var body: some View {
        let i = item
        let l = app.ledger
        VStack(alignment: .leading, spacing: 4) {
            AttachmentRow(attachment: Attachment(workspaceId: i.workspaceId, storagePath: i.storagePath, filename: i.filename, mimeType: i.mimeType,
                                                 sizeBytes: i.sizeBytes, clientId: nil, uploadedBy: i.createdBy, createdAt: i.createdAt))
            if !i.note.isEmpty { Text(i.note).font(.callout) }
            let guess = [i.suggestedVendor, i.suggestedTotalCents.map { Money.format($0) }, i.suggestedDate.map { Days.display($0) },
                         l.project(i.suggestedProjectId)?.nickname].compactMap { $0 }
            if !guess.isEmpty { Text("Looks like: \(guess.joined(separator: " · "))").font(.caption).foregroundStyle(.secondary) }
            if let c = l.claim(.inboxItem, i.id) { Label("\(l.payerName(c.claimedBy)) is on it", systemImage: "hand.raised").font(.caption).foregroundStyle(.blue) }
        }
    }
}

struct AddToInboxSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Note (optional): which house, what it was", text: $note, axis: .vertical)
                } footer: { Text("The vendor, amount, date and property are guessed from the note and file name. Whoever files it checks them.") }
                Section {
                    CaptureButtons(scanTitle: "Scan receipt") { files in
                        busy = true
                        Task { if await app.addToInbox(files, note: note) { dismiss() }; busy = false }
                    }
                    .listRowBackground(Color.clear)
                    if busy { ProgressView("Uploading…") }
                }
            }
            .navigationTitle("Add to inbox")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

/// Small sheet asking for a reason (dismiss, ignore).
struct ReasonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let prompt: String
    let action: String
    let onDone: (String) -> Void
    @State private var reason = ""
    var body: some View {
        NavigationStack {
            Form { TextField(prompt, text: $reason, axis: .vertical).lineLimit(2...4) }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action) { onDone(reason.trimmingCharacters(in: .whitespaces)); dismiss() }
                            .disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Statements

struct StatementsView: View {
    @Environment(AppModel.self) private var app
    enum Filter: String, CaseIterable { case unmatched = "To match", matched = "Matched", ignored = "Ignored" }
    @State private var filter: Filter = .unmatched
    @State private var account = "All accounts"

    var body: some View {
        let l = app.ledger
        let accounts = ["All accounts"] + Array(Set(l.s.statementLines.map(\.account))).sorted()
        let status = filter == .unmatched ? "unmatched" : filter == .matched ? "matched" : "ignored"
        let lines = l.s.statementLines.filter { $0.status == status && (account == "All accounts" || $0.account == account) }
            .sorted { $0.postedDate != $1.postedDate ? $0.postedDate > $1.postedDate : $0.description < $1.description }
        List {
            Section {
                Picker("Show", selection: $filter) { ForEach(Filter.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented)
                if accounts.count > 2 {
                    Picker("Account", selection: $account) { ForEach(accounts, id: \.self) { Text($0).tag($0) } }
                }
                Button { app.sheet = .importStatement } label: { Label("Import a statement (CSV)", systemImage: "square.and.arrow.down").frame(minHeight: 44) }
            } footer: {
                Text("Import the CSV your bank or card site exports. Each charge gets matched to a receipt or bill payment, so nothing is missed or entered twice.")
            }
            Section("\(lines.count) lines") {
                if lines.isEmpty { Text(filter == .unmatched ? "Everything is matched." : "None.").foregroundStyle(.secondary) }
                ForEach(lines) { line in
                    NavigationLink(value: Route.statementLine(line.id)) { StatementLineRow(line: line) }
                }
            }
        }
        .navigationTitle("Statements")
    }
}

struct StatementLineRow: View {
    @Environment(AppModel.self) private var app
    let line: StatementLine
    var body: some View {
        let l = app.ledger
        let matched = l.matchedCents(line: line.id)
        let hint = line.status == "unmatched" ? l.suggestMatches(line).first : nil
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(line.description.isEmpty ? "Statement line" : line.description).font(.body.weight(.semibold)).lineLimit(2)
                Text("\(line.account) · \(Days.display(line.postedDate))").font(.caption).foregroundStyle(.secondary)
                if line.status == "unmatched" && matched != 0 {
                    Text("\(Money.format(matched)) matched, \(Money.format(line.amountCents - matched)) to go").font(.caption).foregroundStyle(.orange)
                }
                if let hint { Label("Likely: \(hint.entry.title)", systemImage: "sparkles").font(.caption).foregroundStyle(.blue) }
                if let c = l.claim(.statementLine, line.id) { Label("\(l.payerName(c.claimedBy)) is on it", systemImage: "hand.raised").font(.caption).foregroundStyle(.blue) }
            }
            Spacer()
            VStack(alignment: .trailing) {
                MoneyText(cents: line.amountCents, font: .body.weight(.semibold))
                if line.amountCents < 0 { Text("money in").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 2)
    }
}

struct StatementLineView: View {
    @Environment(AppModel.self) private var app
    let lineId: UUID
    @State private var ignoring = false
    @State private var projectId: UUID?

    var body: some View {
        let l = app.ledger
        if let line = l.s.statementLines.first(where: { $0.id == lineId }) {
            let matches = l.s.statementMatches.filter { $0.statementLineId == line.id }
            let matched = l.matchedCents(line: line.id)
            let left = line.amountCents - matched
            List {
                Section {
                    Text(line.description.isEmpty ? "Statement line" : line.description).font(.headline)
                    LabeledMoney(label: line.amountCents < 0 ? "Money in" : "Charge", cents: line.amountCents, bold: true)
                    LabeledContent("Date", value: Days.display(line.postedDate))
                    LabeledContent("Account", value: line.account)
                    Picker("Whose card", selection: Binding(get: { line.accountOwner }, set: { v in Task { await app.perform(.setLineOwner(id: line.id, owner: v)) } })) {
                        Text("LLC account").tag(UUID?.none)
                        ForEach(l.s.members) { Text($0.displayName).tag(Optional($0.userId)) }
                    }
                    LabeledContent("Status", value: line.status == "ignored" ? "Ignored: \(line.ignoreReason ?? "")" : line.status.capitalized)
                }
                if !matches.isEmpty {
                    Section {
                        ForEach(matches) { m in
                            let ref = m.expenseId.map { EntryRef(.expense, $0) } ?? m.billPaymentId.map { EntryRef(.payment, $0) }
                            if let ref, let e = l.entry(ref) { NavigationLink(value: ref) { EntryRow(entry: e) } }
                        }
                        if left != 0 { LabeledMoney(label: "Still to match", cents: left) }
                        Button("Undo match", role: .destructive) { Task { await app.unmatchLine(line) } }
                    } header: { Text("Matched to") }
                }
                if line.status == "unmatched" {
                    let suggestions = l.suggestMatches(line)
                    Section {
                        if suggestions.isEmpty { Text("No receipt or bill payment of \(Money.format(left)) within a few days of this charge.").foregroundStyle(.secondary) }
                        ForEach(suggestions) { c in
                            VStack(alignment: .leading, spacing: 6) {
                                NavigationLink(value: c.ref) { EntryRow(entry: c.entry) }
                                HStack {
                                    Text(c.why).font(.caption).foregroundStyle(.secondary)
                                    Spacer()
                                    Button("Match") { Task { await app.matchLine(line, refs: [c.ref]) } }.buttonStyle(.borderedProminent)
                                }
                            }
                        }
                    } header: { Text("Suggested matches") } footer: {
                        Text("Same amount as what's left to match, dated from \(Statements.matchDaysBefore) days before to \(Statements.matchDaysAfter) days after the charge, not matched to anything else.")
                    }
                    Section {
                        ProjectPicker(projectId: $projectId)
                        Button { app.sheet = .transaction(app.lineDraft(line, projectId: projectId)) } label: {
                            Label(matched == 0 ? "Add the receipt for this charge" : "Add a receipt for the \(Money.format(left)) left", systemImage: "receipt").frame(minHeight: 44)
                        }
                    } header: { Text("No receipt entered yet?") } footer: {
                        Text("Fills in the amount, date, vendor and who paid. One store trip for two houses: enter one receipt per property for part of the amount; each gets matched, and the line is done when they add up.")
                    }
                    Section {
                        claimButton(line)
                        Button("Ignore (transfer, payment, personal)…") { ignoring = true }
                    }
                } else if line.status == "ignored" {
                    Section { Button("Put back to match") { Task { await app.perform(.setLineStatus(id: line.id, status: "unmatched", reason: nil), success: "Back to unmatched") } } }
                }
            }
            .navigationTitle("Statement line")
            .onAppear { if projectId == nil { projectId = app.currentProjectId } }
            .sheet(isPresented: $ignoring) {
                ReasonSheet(title: "Ignore line", prompt: "Why? (card payment, transfer, personal…)", action: "Ignore") { reason in
                    Task { await app.perform(.setLineStatus(id: line.id, status: "ignored", reason: reason), success: "Ignored") }
                }
            }
        } else {
            ContentUnavailableView("Line not found", systemImage: "questionmark.folder")
        }
    }

    @ViewBuilder func claimButton(_ line: StatementLine) -> some View {
        if let c = app.ledger.claim(.statementLine, line.id) {
            Button("Release \(app.ledger.payerName(c.claimedBy))’s claim") { Task { await app.perform(.releaseClaim(id: c.id), success: "Released") } }
        } else {
            Button("I’ll find this receipt") { Task { await app.claim(.statementLine, line.id) } }
        }
    }
}

struct ImportStatementForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var filename = ""
    @State private var text = ""
    @State private var account = ""
    @State private var owner: UUID?
    @State private var flip = false
    @State private var busy = false

    var body: some View {
        let parsed = text.isEmpty ? nil : Statements.parse(text)
        let lines: [ParsedStatement.Line] = parsed.map { p in flip ? p.lines.map { var x = $0; x.amountCents = -x.amountCents; return x } : p.lines } ?? []
        FormShell(title: "Import statement", saveTitle: "Import \(lines.count) lines", canSave: !lines.isEmpty && !account.trimmingCharacters(in: .whitespaces).isEmpty,
                  busy: busy, onSave: { save(lines) }) {
            Section {
                Button { importing = true } label: { Label(filename.isEmpty ? "Choose the CSV file" : filename, systemImage: "doc.text").frame(minHeight: 44) }
            } footer: { Text("On your bank or card website, download transactions as CSV (sometimes called “spreadsheet” or “Excel”).") }
            Section {
                TextField("Account name (e.g. Chase Ink 4421)", text: $account).frame(minHeight: 44)
                PartnerPicker(label: "Whose card", partnerId: $owner, allowLLC: true)
            } footer: { Text("A partner's personal card means charges they paid; LLC account means the LLC paid.") }
            if let p = parsed {
                Section {
                    if let e = p.error { Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                    else {
                        let out = lines.filter { $0.amountCents > 0 }
                        LabeledContent("Charges (money out)", value: "\(out.count) · \(Money.format(out.reduce(0) { $0 + $1.amountCents }))")
                        LabeledContent("Credits (money in)", value: "\(lines.count - out.count)")
                        if !p.skipped.isEmpty {
                            DisclosureGroup("\(p.skipped.count) rows skipped") {
                                ForEach(p.skipped.indices, id: \.self) { i in Text("Row \(p.skipped[i].row): \(p.skipped[i].reason)").font(.caption) }
                            }
                        }
                        Toggle("Charges look backwards, flip signs", isOn: $flip)
                        ForEach(lines.prefix(5), id: \.self) { x in
                            LabeledContent { MoneyText(cents: x.amountCents, font: .callout) } label: {
                                VStack(alignment: .leading) { Text(x.description).font(.callout).lineLimit(1); Text(Days.display(x.postedDate)).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                } header: { Text("Preview") } footer: { Text("Rows already imported before are skipped, so importing an overlapping date range is safe.") }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .tabSeparatedText, .plainText, .text]) { result in
            guard case .success(let url) = result else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
            filename = url.lastPathComponent
            if account.isEmpty { account = url.deletingPathExtension().lastPathComponent }
        }
    }

    func save(_ lines: [ParsedStatement.Line]) {
        guard let ws = app.workspace?.id else { return }
        let name = account.trimmingCharacters(in: .whitespaces)
        let prints = Statements.fingerprints(account: name, lines: lines)
        let batch = UUID()
        let rows = zip(lines, prints).map { l, f in
            StatementLine(workspaceId: ws, account: name, accountOwner: owner, postedDate: l.postedDate, description: l.description,
                          amountCents: l.amountCents, fingerprint: f, importBatch: batch)
        }
        busy = true
        Task {
            if await app.importStatement(rows) != nil { dismiss() }
            busy = false
        }
    }
}

// MARK: - Weekly review

struct WeeklyReviewView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let l = app.ledger
        let r = l.weeklyReview()
        List {
            Section {
                Text("Go through this together once a week. Tap “I’ll handle this” so everyone knows who's on what.").font(.callout).foregroundStyle(.secondary)
            }
            group("Bills due this week", "calendar.badge.exclamationmark", r.billsDue, empty: "No bills due in the next 7 days.")
            group("Waiting for approval", "hourglass", r.approvals, empty: "Nothing to approve.")
            group("Reimbursements to pay", "arrow.uturn.backward.circle", r.reimbursementsToPay, empty: "No partner is waiting to be paid back.")
            group("Receipt inbox", "tray", r.inbox, empty: "The inbox is empty.")
            group("Statement lines to match", "creditcard", r.unmatched, empty: "Every statement line is matched or ignored.")
            Section {
                if r.missing.isEmpty { Text("Every receipt has a document and every charge has a receipt.").foregroundStyle(.secondary) }
                ForEach(r.missing.prefix(30)) { m in
                    NavigationLink(value: m.ref.map { AnyRoute.entry($0) } ?? m.lineId.map { AnyRoute.route(.statementLine($0)) } ?? AnyRoute.route(.statements)) {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack { Text(m.title).font(.body.weight(.semibold)).lineLimit(1); Spacer(); MoneyText(cents: m.amountCents, font: .callout) }
                            Text(m.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            Text("\(Days.display(m.date))\(m.owner.map { " · \(l.payerName($0))" } ?? "")").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            } header: { Label("Missing receipts (\(r.missing.count))", systemImage: "doc.questionmark") } footer: {
                Text("Receipts with no photo or PDF, and card charges with no receipt entered. Listed under who paid or whose card it is.")
            }
        }
        .navigationTitle("Weekly review")
        .refreshable { await app.reload() }
    }

    @ViewBuilder func group(_ title: String, _ icon: String, _ items: [ReviewItem], empty: String) -> some View {
        Section {
            if items.isEmpty { Text(empty).foregroundStyle(.secondary) }
            ForEach(items) { i in ReviewRow(item: i) }
        } header: { Label("\(title) (\(items.count))", systemImage: icon) }
    }
}

/// Navigation value that is either a record or a screen.
enum AnyRoute: Hashable { case entry(EntryRef), route(Route) }

struct ReviewRow: View {
    @Environment(AppModel.self) private var app
    let item: ReviewItem
    var body: some View {
        let l = app.ledger
        VStack(alignment: .leading, spacing: 6) {
            NavigationLink(value: destination) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title).font(.body.weight(.semibold)).lineLimit(2)
                        Text(item.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer()
                    if item.amountCents != 0 { MoneyText(cents: item.amountCents, font: .callout.weight(.semibold)) }
                }
            }
            if let c = item.claim {
                HStack {
                    Label(c.claimedBy == app.me ? "You’re on it" : "\(l.payerName(c.claimedBy)) is on it", systemImage: "hand.raised.fill").font(.caption).foregroundStyle(.blue)
                    Spacer()
                    Button("Release") { Task { await app.perform(.releaseClaim(id: c.id), success: "Released") } }.font(.caption)
                }
            } else {
                Button { Task { await app.claim(item.claimKind, item.itemId) } } label: { Label("I’ll handle this", systemImage: "hand.raised").font(.caption) }
                    .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 2)
    }

    var destination: AnyRoute {
        if let ref = item.ref { return .entry(ref) }
        switch item.claimKind {
        case .inboxItem: return .route(.inbox)
        case .statementLine: return .route(.statementLine(item.itemId))
        default: return .route(.review)
        }
    }
}

// MARK: - Cash plan

struct CashPlanView: View {
    @Environment(AppModel.self) private var app
    @State private var days = 30

    var body: some View {
        let l = app.ledger
        let plan = l.cashPlan(days: days)
        List {
            Section {
                Picker("Look ahead", selection: $days) { Text("14 days").tag(14); Text("30 days").tag(30); Text("60 days").tag(60) }
                    .pickerStyle(.segmented)
                LabeledContent("Cash on hand") {
                    if let c = plan.cashOnHandCents { MoneyText(cents: c, font: .body.weight(.semibold)) } else { Text("Not set").foregroundStyle(.secondary) }
                }
                if let a = plan.asOf { Text("As of \(Days.display(a))").font(.caption).foregroundStyle(.secondary) }
                Button { app.sheet = .cashBalance } label: { Label("Update cash on hand", systemImage: "banknote").frame(minHeight: 44) }
                LabeledMoney(label: "Expected to go out", cents: plan.totalCents, bold: true)
                if let c = plan.cashOnHandCents {
                    LabeledMoney(label: "Left after that", cents: c - plan.totalCents).foregroundStyle(c - plan.totalCents < 0 ? .red : .primary)
                }
                if let s = plan.shortfall {
                    Label("Short by \(Money.format(s.shortByCents)) on \(Days.display(s.date)). Plan a contribution or move a payment.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red).font(.callout)
                }
            } footer: {
                Text("Unpaid bills by due date (overdue and undated ones count today), reimbursements ready to pay, and scheduled contractor draws, capped at what's not billed yet.")
            }
            Section("By day") {
                if plan.days.isEmpty { Text("Nothing expected to go out.").foregroundStyle(.secondary) }
                ForEach(plan.days) { d in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(d.date == l.today ? "Today" : Days.display(d.date)).font(.headline)
                            Spacer()
                            MoneyText(cents: d.outCents, font: .body.weight(.semibold))
                        }
                        ForEach(d.events) { e in
                            HStack(alignment: .top) {
                                Image(systemName: e.kind == .bill ? "doc.text" : e.kind == .draw ? "hammer" : "arrow.uturn.backward.circle").foregroundStyle(.secondary)
                                VStack(alignment: .leading) {
                                    Text(e.title).font(.callout)
                                    Text([e.subtitle, l.project(e.projectId)?.nickname].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                MoneyText(cents: e.amountCents, font: .callout)
                            }
                        }
                        if let b = d.balanceCents {
                            Text("Balance after: \(Money.format(b))").font(.caption.monospacedDigit()).foregroundStyle(b < 0 ? .red : .secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            if !plan.byProject.isEmpty {
                Section("By project") {
                    ForEach(plan.byProject.indices, id: \.self) { i in
                        LabeledMoney(label: l.project(plan.byProject[i].projectId)?.nickname ?? "LLC-wide", cents: plan.byProject[i].totalCents)
                    }
                }
            }
            Section {
                let draws = l.s.scheduledDraws.sorted { $0.dueDate < $1.dueDate }
                if draws.isEmpty { Text("No draws scheduled. Add the payment schedule from a contractor agreement.").foregroundStyle(.secondary) }
                ForEach(draws) { d in
                    let c = l.s.commitments.first { $0.id == d.commitmentId }
                    Button { app.sheet = .draw(commitmentId: d.commitmentId, draw: d) } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(l.vendor(c?.vendorId)?.name ?? "Draw")
                                Text([Days.display(d.dueDate), d.description.isEmpty ? nil : d.description, l.project(c?.projectId)?.nickname].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            MoneyText(cents: d.amountCents)
                        }
                    }
                    .foregroundStyle(.primary)
                }
                Button { app.sheet = .draw(commitmentId: nil, draw: nil) } label: { Label("Schedule a draw", systemImage: "plus").frame(minHeight: 44) }
            } header: { Text("Scheduled draws") }
        }
        .navigationTitle("Cash plan")
    }
}

struct CashBalanceForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var asOf = Days.today
    @State private var note = ""
    @State private var busy = false
    var body: some View {
        FormShell(title: "Cash on hand", saveTitle: "Save", canSave: Money.parse(amount) != nil, busy: busy, onSave: save) {
            Section {
                AmountField(label: "Balance", text: $amount, big: true)
                DayPicker(label: "As of", day: $asOf)
                TextField("Note (which account)", text: $note).frame(minHeight: 44)
            } footer: { Text("The LLC's bank balance, for the cash plan. Each update is kept; the latest one is used.") }
        }
    }
    func save() {
        guard let ws = app.workspace?.id, let cents = Money.parse(amount) else { return }
        busy = true
        Task {
            if await app.perform(.addCashBalance(CashBalance(workspaceId: ws, asOf: asOf, amountCents: cents, note: note)), success: "Cash on hand updated") { dismiss() }
            busy = false
        }
    }
}

struct DrawForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var commitmentId: UUID?
    @State private var draw: ScheduledDraw?
    @State private var amount: String
    @State private var due: Day
    @State private var description: String
    @State private var busy = false

    init(commitmentId: UUID?, draw: ScheduledDraw?) {
        _commitmentId = State(initialValue: commitmentId)
        _draw = State(initialValue: draw)
        _amount = State(initialValue: draw.map { Money.plain($0.amountCents) } ?? "")
        _due = State(initialValue: draw?.dueDate ?? Days.adding(14, to: Days.today))
        _description = State(initialValue: draw?.description ?? "")
    }

    var body: some View {
        let l = app.ledger
        let open = l.s.commitments.filter { !$0.isVoid }
        FormShell(title: draw == nil ? "Schedule a draw" : "Scheduled draw", saveTitle: "Save", canSave: (Money.parse(amount) ?? 0) > 0 && commitmentId != nil, busy: busy, onSave: save) {
            Section {
                Picker("Contract", selection: $commitmentId) {
                    Text("Choose…").tag(UUID?.none)
                    ForEach(open) { c in Text("\(l.vendor(c.vendorId)?.name ?? "") · \(l.project(c.projectId)?.nickname ?? "")").tag(Optional(c.id)) }
                }
                if let c = open.first(where: { $0.id == commitmentId }) {
                    LabeledMoney(label: "Not billed yet", cents: l.status(commitment: c).unbilledCents)
                }
                AmountField(label: "Amount", text: $amount, big: true)
                DayPicker(label: "Expected", day: $due)
                TextField("What (e.g. Draw 3: roof framing)", text: $description).frame(minHeight: 44)
            } footer: { Text("For the cash plan only. It doesn't post anything; enter the bill when the contractor invoices.") }
            if let d = draw {
                Section {
                    Button("Remove draw", role: .destructive) {
                        Task { if await app.perform(.deleteDraw(id: d.id), success: "Draw removed") { dismiss() } }
                    }
                }
            }
        }
    }

    func save() {
        guard let ws = app.workspace?.id, let cid = commitmentId, let cents = Money.parse(amount) else { return }
        var d = draw ?? ScheduledDraw(workspaceId: ws, commitmentId: cid, dueDate: due, amountCents: cents)
        d.commitmentId = cid; d.dueDate = due; d.amountCents = cents; d.description = description
        busy = true
        Task {
            if await app.perform(.saveDraw(d), success: "Draw scheduled") { dismiss() }
            busy = false
        }
    }
}

// MARK: - Templates and recurring costs

extension Ledger {
    func dueTemplates(within days: Int = 7) -> [EntryTemplate] {
        let limit = Days.adding(days, to: today)
        return s.entryTemplates.filter { $0.active && $0.repeat != "none" && ($0.nextDue.map { $0 <= limit } ?? false) }
            .sorted { ($0.nextDue ?? "") < ($1.nextDue ?? "") }
    }
}

struct TemplatesView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let l = app.ledger
        let all = l.s.entryTemplates.sorted { $0.name < $1.name }
        let due = l.dueTemplates()
        let dueIds = Set(due.map(\.id))
        let repeating = all.filter { $0.repeat != "none" && !dueIds.contains($0.id) }
        let plain = all.filter { $0.repeat == "none" }
        List {
            Section {
                Button { app.sheet = .template(nil) } label: { Label("New template", systemImage: "plus").frame(minHeight: 44) }
            } footer: {
                Text("Costs you enter again and again: insurance, utilities, dumpster swaps, a supplier you use every week. Nothing posts by itself; a partner adds it and checks the amount.")
            }
            Section("Due this week (\(due.count))") {
                if due.isEmpty { Text("Nothing due in the next 7 days.").foregroundStyle(.secondary) }
                ForEach(due) { t in TemplateRow(template: t, canSkip: true) }
            }
            Section("Repeating") {
                if repeating.isEmpty { Text("No other repeating costs.").foregroundStyle(.secondary) }
                ForEach(repeating) { t in TemplateRow(template: t, canSkip: false) }
            }
            if !plain.isEmpty {
                Section("Templates") { ForEach(plain) { t in TemplateRow(template: t, canSkip: false) } }
            }
        }
        .navigationTitle("Recurring and templates")
    }
}

struct TemplateRow: View {
    @Environment(AppModel.self) private var app
    let template: EntryTemplate
    let canSkip: Bool
    var body: some View {
        let t = template
        let l = app.ledger
        VStack(alignment: .leading, spacing: 6) {
            Button { app.sheet = .template(t) } label: {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(t.name + (!t.active && t.repeat != "none" ? " (paused)" : "")).font(.body.weight(.semibold))
                        Text([t.kind == "bill" ? "Bill" : "Receipt", t.repeat == "none" ? nil : t.repeatLabel, l.project(t.projectId)?.nickname, l.vendor(t.vendorId)?.name,
                              t.repeat != "none" ? t.nextDue.map { ($0 < l.today ? "was due " : "next ") + Days.display($0) } : nil]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let a = t.amountCents { MoneyText(cents: a, font: .callout) } else { Text("amount varies").font(.caption).foregroundStyle(.secondary) }
                }
            }
            .foregroundStyle(.primary)
            HStack {
                Button("Add now") { app.sheet = .transaction(app.templateDraft(t)) }.buttonStyle(.borderedProminent)
                if canSkip, let due = t.nextDue {
                    Button("Skip this one") {
                        var x = t; x.nextDue = Settlements.advance(due, repeat: t.repeat)
                        Task { await app.perform(.saveTemplate(x), success: "Skipped to \(Days.display(x.nextDue))") }
                    }
                    .buttonStyle(.bordered)
                }
            }
            .font(.callout)
        }
        .padding(.vertical, 2)
    }
}

struct TemplateForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var t: EntryTemplate
    @State private var amount: String
    @State private var payer: UUID?
    @State private var newVendor = ""
    @State private var confirmDelete = false
    @State private var busy = false

    init(template: EntryTemplate?, workspace: UUID) {
        let x = template ?? EntryTemplate(workspaceId: workspace, name: "")
        _t = State(initialValue: x)
        _amount = State(initialValue: x.amountCents.map { Money.plain($0) } ?? "")
        _payer = State(initialValue: x.paidByUserId)
    }

    var body: some View {
        let l = app.ledger
        let isNew = !l.s.entryTemplates.contains { $0.id == t.id }
        FormShell(title: isNew ? "New template" : "Template", saveTitle: "Save template",
                  canSave: !t.name.trimmingCharacters(in: .whitespaces).isEmpty && (t.repeat == "none" || t.nextDue != nil), busy: busy, onSave: save) {
            Section {
                TextField("Name (e.g. Oak St water)", text: $t.name).frame(minHeight: 44)
                Picker("Type", selection: $t.kind) { Text("Receipt").tag("receipt"); Text("Bill").tag("bill") }.pickerStyle(.segmented)
                ProjectPicker(projectId: $t.projectId, allowNone: true)
                VendorField(vendorId: $t.vendorId, newName: $newVendor)
                Picker("Category", selection: $t.categoryId) {
                    Text("Choose…").tag(UUID?.none)
                    ForEach(l.activeCategories) { Text($0.name).tag(Optional($0.id)) }
                }
                AmountField(label: "Amount (blank if it varies)", text: $amount)
                TextField("Description", text: $t.description).frame(minHeight: 44)
                if t.kind == "receipt" {
                    PartnerPicker(label: "Usually paid by", partnerId: $payer, allowLLC: true)
                    MethodPicker(method: $t.paymentMethod)
                }
            }
            Section {
                Picker("Repeats", selection: $t.repeat) { ForEach(EntryTemplate.repeats, id: \.0) { Text($0.1).tag($0.0) } }
                if t.repeat != "none" {
                    DayPicker(label: "Next due", day: Binding(get: { t.nextDue ?? Days.today }, set: { t.nextDue = $0 }))
                    Toggle("Active", isOn: $t.active)
                }
            } footer: { Text("Repeating templates show under Due this week. Adding one moves it to the next due date, keeping the day of the month.") }
            if !isNew {
                Section { Button("Remove template", role: .destructive) { confirmDelete = true } }
            }
        }
        .onChange(of: t.repeat) { _, r in if r != "none" && t.nextDue == nil { t.nextDue = Days.today } }
        .confirmationDialog("Remove \(t.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { Task { if await app.perform(.deleteTemplate(id: t.id), success: "Template removed") { dismiss() } } }
        }
    }

    func save() {
        var x = t
        x.amountCents = Money.parse(amount).flatMap { $0 > 0 ? $0 : nil }
        x.paidByUserId = x.kind == "receipt" ? payer : nil
        if x.repeat == "none" { x.nextDue = nil }
        busy = true
        Task {
            if x.vendorId == nil, !newVendor.trimmingCharacters(in: .whitespaces).isEmpty, let ws = app.workspace?.id {
                let name = newVendor.trimmingCharacters(in: .whitespaces)
                if let v = app.ledger.s.vendors.first(where: { $0.name.lowercased() == name.lowercased() }) { x.vendorId = v.id }
                else {
                    let v = Vendor(workspaceId: ws, name: name, kind: x.kind == "bill" ? "contractor" : "supplier")
                    if await app.save(vendor: v) { x.vendorId = v.id }
                }
            }
            if await app.perform(.saveTemplate(x), success: "Template saved") { dismiss() }
            busy = false
        }
    }
}

// MARK: - Reports

struct ReportsView: View {
    @Environment(AppModel.self) private var app
    enum Tab: String, CaseIterable { case pl = "Profit", partners = "Partners", budget = "Budget" }
    @State private var tab: Tab = .pl
    @State private var budgetProject: UUID?

    var body: some View {
        let l = app.ledger
        List {
            Picker("Report", selection: $tab) { ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            switch tab {
            case .pl: profit(l)
            case .partners: partners(l)
            case .budget: budget(l)
            }
        }
        .navigationTitle("Reports")
    }

    @ViewBuilder func profit(_ l: Ledger) -> some View {
        let ps = l.s.projects.sorted { $0.isActive != $1.isActive ? $0.isActive : $0.nickname < $1.nickname }
        ForEach(ps) { p in
            let s = l.summary(project: p)
            Section {
                NavigationLink(value: Route.project(p.id)) {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(p.nickname).font(.headline)
                            Text(s.profitIsActual ? "Sold" : p.isActive ? "Projected" : "Sold, no sale recorded").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let pr = s.profitCents { MoneyText(cents: pr, font: .body.weight(.bold)).foregroundStyle(pr < 0 ? .red : .green) }
                    }
                }
                LabeledMoney(label: "Purchase + closing", cents: (s.basis.spent[.purchase] ?? 0) + (s.basis.spent[.closing] ?? 0))
                LabeledMoney(label: "Rehab", cents: s.basis.spent[.rehab] ?? 0)
                LabeledMoney(label: "Holding", cents: s.basis.spent[.holding] ?? 0)
                LabeledMoney(label: "Cost basis", cents: s.basis.spentTotal, bold: true)
                if let n = s.soldNetCents { LabeledMoney(label: "Sale (net)", cents: n) } else if let a = s.arvCents { LabeledMoney(label: "ARV", cents: a) }
                if let r = s.roiBps { LabeledContent("Return", value: String(format: "%.1f%%", Double(r) / 100)) }
            }
        }
        Section {} footer: {
            Text("Cost basis = paid + billed. Sold projects show actual profit from net proceeds; others show the forecast from the expected sale price and target sale date.")
        }
    }

    @ViewBuilder func partners(_ l: Ledger) -> some View {
        let ps = l.s.projects.sorted { $0.nickname < $1.nickname }
        ForEach(l.s.members) { m in
            let b = l.partnerBalance(m.userId)
            Section(m.displayName) {
                LabeledMoney(label: "Paid personally", cents: b.outOfPocketCents)
                LabeledMoney(label: "Reimbursed", cents: b.reimbursedCents)
                LabeledMoney(label: "LLC owes them", cents: b.owedCents, bold: true)
                LabeledMoney(label: "Contributed", cents: b.contributionsCents)
                LabeledMoney(label: "Distributed", cents: b.distributionsCents)
                DisclosureGroup("Paid personally, by project") {
                    ForEach(ps) { p in LabeledMoney(label: p.nickname, cents: l.partnerBalance(m.userId, project: p.id).outOfPocketCents) }
                }
            }
        }
        Section {} footer: {
            Text("LLC owes them = paid personally − reimbursed. Contributions and distributions are capital in and out, tracked separately.")
        }
    }

    @ViewBuilder func budget(_ l: Ledger) -> some View {
        let pid = budgetProject ?? l.s.projects.sorted { $0.nickname < $1.nickname }.first?.id
        Section {
            Picker("Project", selection: Binding(get: { pid }, set: { budgetProject = $0 })) {
                ForEach(l.s.projects.sorted { $0.nickname < $1.nickname }) { Text($0.nickname).tag(Optional($0.id)) }
            }
        }
        if let pid {
            let lines = l.categorySummary(project: pid).filter { $0.budgetCents != 0 || $0.projectedCents != 0 }
            Section {
                ForEach(lines) { x in
                    let spent = x.paidCents + x.unpaidBilledCents
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(x.name).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(Money.format(x.projectedCents, showCents: false)) of \(Money.format(x.budgetCents, showCents: false))")
                                .font(.caption.monospacedDigit()).foregroundStyle(x.remainingCents < 0 ? .red : .secondary)
                        }
                        ProgressView(value: Double(min(max(spent, 0), max(x.budgetCents, spent, 1))), total: Double(max(x.budgetCents, x.projectedCents, 1)))
                            .tint(x.remainingCents < 0 ? .red : .accentColor)
                        if x.unbilledCommittedCents > 0 {
                            Text("Spent \(Money.format(spent, showCents: false)) · committed \(Money.format(x.unbilledCommittedCents, showCents: false))").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            } footer: { Text("Bar = spent (paid + billed). Projected adds committed but not billed. Red = over budget.") }
        }
    }
}
