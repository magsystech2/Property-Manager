import SwiftUI
import LedgerCore

// MARK: - Money & status

struct MoneyText: View {
    let cents: Cents
    var font: Font = .body
    var body: some View {
        Text(Money.format(cents))
            .font(font.monospacedDigit())
            .accessibilityLabel(Money.format(cents))
    }
}

/// Status that reads without color: icon + words, color only as a hint.
struct StatusBadge: View {
    let status: StatusLabel
    var body: some View {
        // Tight icon + words on one line, so the badge never wraps letter by letter in a narrow row.
        HStack(spacing: 4) {
            Image(systemName: status.symbol)
            Text(status.text)
        }
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 8).padding(.vertical, 3)
            .foregroundStyle(status.tone.color)
            .background(status.tone.color.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
    }
}

extension StatusLabel.Tone {
    var color: Color {
        switch self {
        case .neutral: .secondary
        case .good: .green
        case .warning: .orange
        case .bad: .red
        }
    }
}

struct SyncBadge: View {
    let state: SyncState
    var body: some View {
        switch state {
        case .draft: Label("Draft, only on this phone", systemImage: "square.and.pencil").font(.caption).foregroundStyle(.secondary)
        case .waiting: Label("Waiting to sync", systemImage: "icloud.and.arrow.up").font(.caption.weight(.semibold)).foregroundStyle(.blue)
        case .failed: Label("Needs a fix", systemImage: "exclamationmark.triangle").font(.caption.weight(.semibold)).foregroundStyle(.red)
        }
    }
}

struct EntryRow: View {
    @Environment(AppModel.self) private var app
    let entry: Entry
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .frame(width: 40, height: 40)
                .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.title).font(.body.weight(.semibold)).lineLimit(2)
                Text(entry.subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                HStack(spacing: 6) {
                    StatusBadge(status: entry.status)
                    if entry.attachmentCount > 0 {
                        HStack(spacing: 2) { Image(systemName: "paperclip"); Text("\(entry.attachmentCount)") }
                            .font(.caption).foregroundStyle(.secondary).fixedSize()
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(entry.attachmentCount) documents")
                    }
                    if !app.pending(for: entry.ref).isEmpty {
                        Label("Uploading", systemImage: "icloud.and.arrow.up").font(.caption).foregroundStyle(.blue)
                    }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if let bal = openBillBalance {
                    // Unpaid or partly paid bill: what's still due leads; total and paid sit underneath.
                    MoneyText(cents: bal.outstandingCents, font: .body.weight(.semibold))
                    Text("due").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    if bal.outstandingCents != bal.totalCents {
                        // Two short lines keep this column narrow enough for the status badge beside it.
                        Text("of \(Money.format(bal.totalCents)) ·\n\(Money.format(bal.paidCents)) paid")
                            .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                } else {
                    MoneyText(cents: entry.amountCents, font: .body.weight(.semibold))
                }
                Text(Days.display(entry.date)).font(.caption).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: true, vertical: false)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// Balance of a posted bill that still has money owed; nil for anything else.
    var openBillBalance: BillBalance? {
        guard entry.ref.kind == .bill, entry.status.text != "Void" else { return nil }
        let bal = app.ledger.balance(bill: entry.id)
        return bal.outstandingCents > 0 ? bal : nil
    }

    var icon: String {
        switch entry.ref.kind {
        case .expense: "receipt"
        case .bill: "doc.text"
        case .payment: "banknote"
        case .reimbursement: "arrow.uturn.backward.circle"
        case .contribution: "building.columns"
        case .proceeds: "house.and.flag"
        case .distribution: "arrow.up.forward.circle"
        case .commitment: "signature"
        case .changeOrder: "plus.forwardslash.minus"
        }
    }
}

struct EntryList: View {
    let entries: [Entry]
    var empty = "Nothing here yet."
    var body: some View {
        if entries.isEmpty {
            Text(empty).foregroundStyle(.secondary)
        }
        ForEach(entries) { e in
            NavigationLink(value: e.ref) { EntryRow(entry: e) }
        }
    }
}

/// Screen listing the records behind a number.
struct RecordsView: View {
    @Environment(AppModel.self) private var app
    let title: String
    let refs: [EntryRef]?
    var entries: [Entry]? = nil
    var explanation: String? = nil

    var body: some View {
        let list: [Entry] = entries ?? {
            let all = app.ledger.entries()
            let set = Set(refs ?? [])
            return all.filter { set.contains($0.ref) }
        }()
        List {
            if let explanation { Section { Text(explanation).font(.callout).foregroundStyle(.secondary) } }
            Section("\(list.count) records") { EntryList(entries: list) }
        }
        .navigationTitle(title)
    }
}

// MARK: - Input

/// Large currency field for one-handed entry.
struct AmountField: View {
    let label: String
    @Binding var text: String
    var big = false
    var body: some View {
        HStack {
            Text(label).font(big ? .headline : .body)
            Spacer()
            Text("$").foregroundStyle(.secondary)
            TextField("0.00", text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .font(big ? .system(.largeTitle, design: .rounded).weight(.bold).monospacedDigit() : .body.monospacedDigit())
                .frame(minWidth: 120)
                .accessibilityLabel(label)
        }
        .frame(minHeight: big ? 64 : 44)
    }
}

struct DayPicker: View {
    let label: String
    @Binding var day: Day
    var body: some View {
        DatePicker(label, selection: Binding(get: { Days.date(day) ?? Date() }, set: { day = Days.string($0) }), displayedComponents: .date)
            .frame(minHeight: 44)
    }
}

struct OptionalDayPicker: View {
    let label: String
    @Binding var day: Day?
    var body: some View {
        Toggle(label, isOn: Binding(get: { day != nil }, set: { day = $0 ? (day ?? Days.adding(30, to: Days.today)) : nil }))
            .frame(minHeight: 44)
        if day != nil {
            DayPicker(label: "Date", day: Binding(get: { day ?? Days.today }, set: { day = $0 }))
        }
    }
}

struct ProjectPicker: View {
    @Environment(AppModel.self) private var app
    @Binding var projectId: UUID?
    var allowNone = false
    var body: some View {
        Picker("Project", selection: $projectId) {
            Text(allowNone ? "None / LLC-wide" : "Choose…").tag(UUID?.none)
            ForEach(app.ledger.s.projects.sorted { $0.nickname < $1.nickname }) { Text($0.nickname).tag(Optional($0.id)) }
        }
        .frame(minHeight: 44)
    }
}

struct PartnerPicker: View {
    @Environment(AppModel.self) private var app
    let label: String
    @Binding var partnerId: UUID?
    var allowLLC = false
    var body: some View {
        Picker(label, selection: $partnerId) {
            if allowLLC { Text("LLC account").tag(UUID?.none) } else { Text("Choose…").tag(UUID?.none) }
            // Partners whose access was removed aren't offered for new entries (unless already chosen).
            ForEach(app.ledger.s.members.filter { $0.hasAccess || $0.userId == partnerId }) { m in
                Text(m.userId == app.me ? "\(m.displayName) (me)" : m.displayName).tag(Optional(m.userId))
            }
        }
        .frame(minHeight: 44)
    }
}

struct MethodPicker: View {
    @Binding var method: String
    var body: some View {
        Picker("Method", selection: $method) {
            ForEach(PaymentMethod.allCases, id: \.rawValue) { Text($0.label).tag($0.rawValue) }
        }
        .frame(minHeight: 44)
    }
}

/// Vendor chosen from the list, or a new one typed by name.
struct VendorField: View {
    @Environment(AppModel.self) private var app
    @Binding var vendorId: UUID?
    @Binding var newName: String
    @State private var picking = false
    var body: some View {
        Button { picking = true } label: {
            HStack {
                Text("Vendor").foregroundStyle(.primary)
                Spacer()
                Text(app.ledger.vendor(vendorId)?.name ?? (newName.isEmpty ? "Choose or type…" : "\(newName) (new)"))
                    .foregroundStyle(vendorId == nil && newName.isEmpty ? .secondary : .primary)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .frame(minHeight: 44)
        }
        .sheet(isPresented: $picking) {
            VendorChooser(vendorId: $vendorId, newName: $newName)
        }
    }
}

struct VendorChooser: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Binding var vendorId: UUID?
    @Binding var newName: String
    @State private var query = ""
    var body: some View {
        NavigationStack {
            List {
                let q = query.trimmingCharacters(in: .whitespaces)
                if !q.isEmpty && !app.ledger.s.vendors.contains(where: { $0.name.lowercased() == q.lowercased() }) {
                    Button { vendorId = nil; newName = q; dismiss() } label: { Label("Add “\(q)” as a new vendor", systemImage: "plus.circle.fill") }
                        .frame(minHeight: 44)
                }
                ForEach(app.ledger.s.vendors.filter { q.isEmpty || $0.name.localizedCaseInsensitiveContains(q) }.sorted { $0.name < $1.name }) { v in
                    Button { vendorId = v.id; newName = ""; dismiss() } label: {
                        HStack {
                            VStack(alignment: .leading) { Text(v.name); Text(v.kind.capitalized).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            if v.id == vendorId { Image(systemName: "checkmark") }
                        }
                    }
                    .frame(minHeight: 44)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search or type a new vendor")
            .navigationTitle("Vendor")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

// MARK: - Chrome

struct DemoBanner: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        if app.isDemo {
            HStack(spacing: 8) {
                Image(systemName: "theatermasks.fill")
                Text("DEMO MODE · sample data on this phone only").font(.footnote.weight(.bold))
                Spacer()
                Menu {
                    ForEach(app.ledger.s.members.filter(\.hasAccess)) { m in
                        Button { Task { await app.actAs(m.userId) } } label: {
                            Label("Act as \(m.displayName)", systemImage: m.userId == app.me ? "checkmark" : "person")
                        }
                    }
                    Button("Reset sample data", role: .destructive) { Task { await app.resetDemo() } }
                } label: {
                    Text(app.myMember?.displayName ?? "").font(.footnote.weight(.semibold)).underline()
                }
                .accessibilityLabel("Switch demo partner")
            }
            .padding(.horizontal).padding(.vertical, 6)
            .foregroundStyle(.white)
            .background(Color.purple)
        }
    }
}

enum AddAction: String, Identifiable, CaseIterable {
    case scan, voice, expense, bill, payment, contribution
    var id: String { rawValue }
    var title: String {
        switch self {
        case .scan: "Scan Receipt"
        case .voice: "Say It"
        case .expense: "Add Expense"
        case .bill: "Add Bill"
        case .payment: "Record Payment"
        case .contribution: "Add Contribution"
        }
    }
    var icon: String {
        switch self {
        case .scan: "doc.viewfinder"
        case .voice: "mic.fill"
        case .expense: "receipt"
        case .bill: "doc.text"
        case .payment: "banknote"
        case .contribution: "building.columns"
        }
    }
}

/// Big floating Add button with the Add menu, bottom-right where a thumb reaches it.
struct AddButton: View {
    @Binding var action: AddAction?
    var body: some View {
        Menu {
            ForEach(AddAction.allCases.reversed()) { a in
                Button { action = a } label: { Label(a.title, systemImage: a.icon) }
            }
        } label: {
            Image(systemName: "plus")
                .font(.title.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(Color.accentColor, in: Circle())
                .shadow(radius: 4, y: 2)
        }
        .accessibilityLabel("Add")
        .accessibilityHint("Opens Scan Receipt, Add Expense, Add Bill, Record Payment and Add Contribution.")
        .padding(.horizontal, 20).padding(.vertical, 8)
    }
}

struct VoidSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onVoid: (String) -> Void
    @State private var reason = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Why is this being voided?", text: $reason, axis: .vertical).lineLimit(2...4)
                } footer: {
                    Text("Posted records are never deleted. Voiding keeps the record and its history, removes it from totals, and records who voided it and why. Enter a corrected record afterwards if needed.")
                }
            }
            .navigationTitle("Void record")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .destructiveAction) {
                    Button("Void", role: .destructive) { onVoid(reason); dismiss() }
                        .disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

struct LabeledMoney: View {
    let label: String
    let cents: Cents
    var bold = false
    var body: some View {
        LabeledContent {
            MoneyText(cents: cents, font: bold ? .body.weight(.bold) : .body)
        } label: {
            Text(label).fontWeight(bold ? .bold : .regular)
        }
        .frame(minHeight: 36)
    }
}

extension Array where Element: Hashable {
    /// Removes repeats, keeping the first occurrence's order.
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
