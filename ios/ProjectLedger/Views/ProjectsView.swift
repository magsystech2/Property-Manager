import SwiftUI
import LedgerCore

struct ProjectsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let projects = app.ledger.s.projects.sorted { $0.nickname < $1.nickname }
        List {
            Section("Active") {
                ForEach(projects.filter(\.isActive)) { p in NavigationLink(value: Route.project(p.id)) { ProjectRow(project: p) } }
            }
            let sold = projects.filter { !$0.isActive }
            if !sold.isEmpty {
                Section("Sold") {
                    ForEach(sold) { p in NavigationLink(value: Route.project(p.id)) { ProjectRow(project: p) } }
                }
            }
            Section {
                NavigationLink(value: Route.vendors) { Label("Vendors and contractors", systemImage: "person.crop.rectangle.stack").frame(minHeight: 44) }
            }
        }
        .navigationTitle("Projects")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { app.sheet = .project(nil) } label: { Label("New project", systemImage: "plus.circle") }
            }
        }
    }
}

struct ProjectDetailView: View {
    @Environment(AppModel.self) private var app
    let projectId: UUID
    enum Section_: String, CaseIterable { case overview = "Overview", budget = "Budget", transactions = "Activity", vendors = "Vendors", documents = "Files" }
    @State private var section: Section_ = .overview
    @State private var addingDocument = false

    var body: some View {
        if let p = app.ledger.project(projectId) {
            List {
                Picker("Section", selection: $section) {
                    ForEach(Section_.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                switch section {
                case .overview: overview(p)
                case .budget: budget(p)
                case .transactions: transactions(p)
                case .vendors: vendors(p)
                case .documents: documents(p)
                }
            }
            .navigationTitle(p.nickname)
            .sheet(isPresented: $addingDocument) { AttachSheet(target: .project(p.id)) }
            .onAppear { app.currentProjectId = projectId }
            .onDisappear { if app.currentProjectId == projectId { app.currentProjectId = nil } }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { app.sheet = .project(p) } label: { Label("Edit project", systemImage: "pencil") }
                        Button { app.sheet = .budget(p.id) } label: { Label("Edit budget", systemImage: "chart.bar.doc.horizontal") }
                        Button { app.sheet = .commitment(projectId: p.id) } label: { Label("Add commitment", systemImage: "signature") }
                        Button { app.sheet = .proceeds(projectId: p.id) } label: { Label("Record sale proceeds", systemImage: "house.and.flag") }
                        NavigationLink(value: Route.export(projectId: p.id, partnerId: nil, vendorId: nil)) { Label("Export CSV", systemImage: "square.and.arrow.up") }
                    } label: { Label("More", systemImage: "ellipsis.circle") }
                }
            }
        } else {
            ContentUnavailableView("Project not found", systemImage: "questionmark.folder")
        }
    }

    // MARK: Overview

    @ViewBuilder func overview(_ p: Project) -> some View {
        let l = app.ledger
        let t = l.totals(project: p.id)
        let lines = l.categorySummary(project: p.id)
        Section {
            if !p.address.isEmpty { LabeledContent("Address", value: p.address) }
            LabeledContent("Type", value: p.typeLabel)
            LabeledContent("Status", value: p.statusLabel)
            if let d = p.startDate { LabeledContent("Start", value: Days.display(d)) }
            if let d = p.targetCompleteDate { LabeledContent("Target completion", value: Days.display(d)) }
            if let d = p.targetSaleDate { LabeledContent("Target sale", value: Days.display(d)) }
        }
        Section {
            LabeledMoney(label: "Approved budget", cents: t.budgetCents)
            link("Paid costs", t.paidCents, lines.flatMap(\.sources).filter { $0.kind == .expense || $0.kind == .payment },
                 "Receipts and bill payments, net of refunds.")
            link("Unpaid billed", t.unpaidBilledCents, lines.flatMap(\.sources).filter { $0.kind == .bill },
                 "Balances still owed on bills, after payments and vendor credits.")
            link("Committed, not billed", t.unbilledCommittedCents, lines.flatMap(\.sources).filter { $0.kind == .commitment },
                 "Contract amounts plus approved change orders, minus what has been invoiced.")
            LabeledMoney(label: "Projected spend", cents: t.projectedCents, bold: true)
            LabeledContent {
                MoneyText(cents: t.remainingCents, font: .body.weight(.bold))
                    .foregroundStyle(t.remainingCents < 0 ? .red : .primary)
            } label: {
                Label(t.remainingCents < 0 ? "Over budget" : "Remaining budget",
                      systemImage: t.remainingCents < 0 ? "exclamationmark.triangle.fill" : "checkmark.circle")
            }
        } header: {
            Text("Spending")
        } footer: {
            Text("Projected spend = paid + unpaid billed + committed not billed. Remaining = budget − projected spend.")
        }
        if t.proceedsCents > 0 || p.status == "sold" {
            Section {
                link("Sale proceeds", t.proceedsCents, l.s.proceeds.filter { $0.projectId == p.id }.map { EntryRef(.proceeds, $0.id) },
                     "Recorded sale proceeds. Kept separate from partner contributions.")
                LabeledMoney(label: "Projected costs", cents: t.projectedCents)
                LabeledMoney(label: "Profit estimate", cents: t.profitEstimateCents, bold: true)
                Button { app.sheet = .proceeds(projectId: p.id) } label: { Label("Record sale proceeds", systemImage: "plus") }
            } header: { Text("Sale") } footer: {
                Text("Estimate only: recorded proceeds minus recorded and committed costs. Profit splits and taxes are not handled here.")
            }
        }
        Section {
            let cs = l.s.commitments.filter { $0.projectId == p.id && !$0.isVoid }
            if cs.isEmpty { Text("No contracts recorded.").foregroundStyle(.secondary) }
            ForEach(cs) { c in
                let st = l.status(commitment: c)
                NavigationLink(value: EntryRef(.commitment, c.id)) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(l.vendor(c.vendorId)?.name ?? "Vendor").font(.headline)
                        Text(c.description).font(.subheadline).foregroundStyle(.secondary)
                        Text("\(Money.format(st.revisedCents)) agreed · \(Money.format(st.billedCents)) billed · \(Money.format(st.unbilledCents)) not billed")
                            .font(.caption.monospacedDigit())
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            Button { app.sheet = .commitment(projectId: p.id) } label: { Label("Add commitment", systemImage: "plus").frame(minHeight: 44) }
        } header: { Text("Contracts and commitments") }
        let partners = l.s.members.map { l.partnerBalance($0.userId, project: p.id) }.filter { $0.outOfPocketCents != 0 || $0.contributionsCents != 0 }
        if !partners.isEmpty {
            Section("Partner money on this project") {
                ForEach(partners) { b in
                    NavigationLink(value: Route.partner(b.member.userId)) {
                        VStack(alignment: .leading) {
                            Text(b.member.displayName).font(.headline)
                            Text("Paid personally \(Money.format(b.outOfPocketCents)) · Contributed \(Money.format(b.contributionsCents))")
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    func link(_ label: String, _ cents: Cents, _ refs: [EntryRef], _ why: String) -> some View {
        NavigationLink(value: Route.records(title: label, refs: refs.uniqued(), explanation: why)) {
            LabeledMoney(label: label, cents: cents)
        }
    }

    // MARK: Budget

    @ViewBuilder func budget(_ p: Project) -> some View {
        let lines = app.ledger.categorySummary(project: p.id)
        Section {
            Button { app.sheet = .budget(p.id) } label: { Label("Edit budget by category", systemImage: "pencil").frame(minHeight: 44) }
        } footer: {
            Text("Projected = paid + unpaid billed + committed not billed. Tap an amount to see the records behind it.")
        }
        ForEach(lines) { line in
            Section {
                LabeledMoney(label: "Approved budget", cents: line.budgetCents)
                link("Paid", line.paidCents, line.sources.filter { $0.kind == .expense || $0.kind == .payment }, "\(line.name): paid costs.")
                link("Unpaid billed", line.unpaidBilledCents, line.sources.filter { $0.kind == .bill }, "\(line.name): billed but not paid yet.")
                link("Committed, not billed", line.unbilledCommittedCents, line.sources.filter { $0.kind == .commitment }, "\(line.name): agreed but not invoiced yet.")
                LabeledMoney(label: "Projected", cents: line.projectedCents, bold: true)
                LabeledContent {
                    MoneyText(cents: line.remainingCents, font: .body.weight(.semibold)).foregroundStyle(line.remainingCents < 0 ? .red : .primary)
                } label: {
                    Label(line.remainingCents < 0 ? "Over budget" : "Remaining", systemImage: line.remainingCents < 0 ? "exclamationmark.triangle.fill" : "minus.forwardslash.plus")
                }
            } header: {
                Text(line.name)
            }
        }
    }

    // MARK: Lists

    @ViewBuilder func transactions(_ p: Project) -> some View {
        Section {
            EntryList(entries: app.ledger.entries().filter { $0.projectId == p.id }, empty: "No transactions yet.")
        }
    }

    @ViewBuilder func vendors(_ p: Project) -> some View {
        Section {
            let vs = app.ledger.vendors(project: p.id)
            if vs.isEmpty { Text("No vendors yet.").foregroundStyle(.secondary) }
            ForEach(vs) { v in
                let bal = app.ledger.s.bills.filter { $0.projectId == p.id && $0.vendorId == v.id && !$0.isVoid }
                    .reduce(0) { $0 + app.ledger.balance(bill: $1.id).outstandingCents }
                NavigationLink(value: Route.vendor(v.id)) {
                    LabeledContent {
                        if bal > 0 { Text("owes \(Money.format(bal))").font(.callout.monospacedDigit()) }
                    } label: {
                        VStack(alignment: .leading) { Text(v.name); Text(v.kind.capitalized).font(.caption).foregroundStyle(.secondary) }
                    }
                    .frame(minHeight: 44)
                }
            }
        }
    }

    @ViewBuilder func documents(_ p: Project) -> some View {
        let l = app.ledger
        let refs = l.entries().filter { $0.projectId == p.id }.map(\.ref)
        let files = l.s.attachments.filter { a in a.projectId == p.id || refs.contains { l.attachments(for: $0).contains(a) } }
        Section {
            Button { addingDocument = true } label: { Label("Add project document", systemImage: "doc.badge.plus").frame(minHeight: 44) }
            ForEach(app.pending(for: .project(p.id))) { f in PendingFileRow(file: f.file, message: f.errorMessage) }
            if files.isEmpty { Text("No documents yet. Add one here, or attach it to a transaction.").foregroundStyle(.secondary) }
            ForEach(files) { a in AttachmentRow(attachment: a, showRecord: true) }
        } footer: {
            Text("Receipts and invoices attached to this project's transactions show here too.")
        }
    }
}

// MARK: - Forms

struct ProjectForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var project: Project
    let isNew: Bool

    init(project: Project?, workspace: UUID) {
        _project = State(initialValue: project ?? Project(workspaceId: workspace, nickname: ""))
        isNew = project == nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nickname (e.g. Oak St Flip)", text: $project.nickname).frame(minHeight: 44)
                    TextField("Address", text: $project.address, axis: .vertical).frame(minHeight: 44)
                    Picker("Type", selection: $project.projectType) { ForEach(Project.types, id: \.0) { Text($0.1).tag($0.0) } }
                    Picker("Status", selection: $project.status) { ForEach(Project.statuses, id: \.0) { Text($0.1).tag($0.0) } }
                }
                Section("Target dates") {
                    OptionalDayPicker(label: "Start date", day: $project.startDate)
                    OptionalDayPicker(label: "Target completion", day: $project.targetCompleteDate)
                    OptionalDayPicker(label: "Target sale", day: $project.targetSaleDate)
                }
                Section("Notes") { TextField("Notes", text: $project.notes, axis: .vertical).lineLimit(2...6) }
            }
            .navigationTitle(isNew ? "New project" : "Edit project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { if await app.save(project: project) { dismiss() } } }
                        .disabled(project.nickname.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

struct BudgetEditor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let projectId: UUID
    @State private var amounts: [UUID: String] = [:]
    @State private var loaded = false

    var body: some View {
        let cats = app.ledger.activeCategories
        let total = cats.reduce(0) { $0 + (Money.parse(amounts[$1.id] ?? "") ?? 0) }
        NavigationStack {
            Form {
                Section {
                    LabeledMoney(label: "Total budget", cents: total, bold: true)
                } footer: {
                    Text("Categories are shared by all projects. Rename, add or hide them under Partners → Settings.")
                }
                Section("By category") {
                    ForEach(cats) { c in
                        AmountField(label: c.name, text: Binding(get: { amounts[c.id] ?? "" }, set: { amounts[c.id] = $0 }))
                    }
                }
            }
            .navigationTitle("Budget")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                guard !loaded else { return }
                loaded = true
                for b in app.ledger.s.budgets where b.projectId == projectId { amounts[b.categoryId] = Money.plain(b.amountCents) }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let ws = app.workspace?.id else { return }
                        let existing = Dictionary(app.ledger.s.budgets.filter { $0.projectId == projectId }.map { ($0.categoryId, $0.amountCents) }, uniquingKeysWith: { a, _ in a })
                        let changed = cats.compactMap { c -> ProjectBudget? in
                            let v = Money.parse(amounts[c.id] ?? "") ?? 0
                            guard v != (existing[c.id] ?? 0) else { return nil }
                            return ProjectBudget(workspaceId: ws, projectId: projectId, categoryId: c.id, amountCents: max(v, 0))
                        }
                        Task { if await app.save(budgets: changed) { dismiss() } }
                    }
                }
            }
        }
    }
}
