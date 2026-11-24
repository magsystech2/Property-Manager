import SwiftUI
import LedgerCore

// Cost basis, forecast, sale and profit split, distributions and materials. Same numbers as the web app's Sale tab.

func pct(_ bps: Int) -> String { bps % 100 == 0 ? "\(bps / 100)%" : String(format: "%.2f%%", Double(bps) / 100) }

private extension View {
    func tone(_ cents: Cents?) -> some View { foregroundStyle(cents.map { $0 < 0 ? Color.red : Color.green } ?? Color.primary) }
}

// MARK: - Project overview: cost basis and profit

struct CostBasisSection: View {
    @Environment(AppModel.self) private var app
    let project: Project

    var body: some View {
        let s = app.ledger.summary(project: project)
        let committed = s.basis.projectedTotal - s.basis.spentTotal
        Section {
            ForEach(BasisGroup.allCases, id: \.self) { g in LabeledMoney(label: g.label, cents: s.basis.spent[g] ?? 0) }
            LabeledMoney(label: "Total cost basis so far", cents: s.basis.spentTotal, bold: true)
            if committed > 0 { LabeledMoney(label: "Plus committed, not billed yet", cents: committed) }
            if let net = s.soldNetCents {
                LabeledMoney(label: "Sale, net proceeds", cents: net)
            } else {
                LabeledContent("ARV / expected sale price") {
                    if let a = s.arvCents { MoneyText(cents: a) } else { Text("Not set").foregroundStyle(.secondary) }
                }
            }
            if let p = s.profitCents {
                LabeledContent {
                    MoneyText(cents: p, font: .title3.weight(.bold)).tone(p)
                } label: { Text(s.profitIsActual ? "Profit" : "Projected profit").bold() }
            }
            if !s.profitIsActual, s.profitCents != nil {
                Text("Projected profit = expected sale price − selling costs − all projected costs (or the budget, if higher) − holding and loan interest until the target sale date. Open the forecast for the breakdown.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let r = s.roiBps { LabeledContent("Return on cost", value: String(format: "%.1f%%", Double(r) / 100)) }
            NavigationLink(value: Route.sale(project.id)) {
                Label(s.profitIsActual ? "Sale and who gets what" : "Forecast, sale and profit split", systemImage: "chart.line.uptrend.xyaxis")
                    .frame(minHeight: 44)
            }
        } header: {
            Text("Cost basis and profit")
        } footer: {
            Text("Purchase and closing come from the Acquisition and Closing Costs categories; holding covers Financing, Insurance, Utilities, taxes and interest; everything else is rehab. Spent = paid + billed.")
        }
    }
}

// MARK: - Sale screen

struct SaleView: View {
    @Environment(AppModel.self) private var app
    let projectId: UUID

    var body: some View {
        let l = app.ledger
        if let p = l.project(projectId) {
            let st = l.settlement(project: projectId)
            List {
                if !st.sold { ForecastSection(project: p) }
                saleSection(p, st)
                if st.sold { cashSection(st) }
                partnersSection(st)
                distributionsSection()
            }
            .navigationTitle("Sale · \(p.nickname)")
            .onAppear { app.currentProjectId = projectId }
        } else {
            ContentUnavailableView("Project not found", systemImage: "questionmark.folder")
        }
    }

    @ViewBuilder func saleSection(_ p: Project, _ st: Settlement) -> some View {
        let sales = app.ledger.s.proceeds.filter { $0.projectId == projectId && !$0.isVoid }
        Section {
            if !st.sold {
                Text("Not sold yet. When it closes, record the sale price, selling costs and loan payoff from the closing statement.\(p.expectedSaleCents.map { " Expected: \(Money.format($0))." } ?? "")")
                    .foregroundStyle(.secondary)
            } else {
                if let g = st.grossCents { LabeledMoney(label: "Sale price", cents: g) }
                if let c = st.sellingCostsCents { LabeledMoney(label: "Selling costs", cents: -c) }
                LabeledMoney(label: "Net proceeds", cents: st.netProceedsCents, bold: true)
                LabeledMoney(label: "Project costs (paid, billed, committed)", cents: -st.costsCents)
                LabeledContent { MoneyText(cents: st.profitCents, font: .title3.weight(.bold)).tone(st.profitCents) } label: { Text("Profit").bold() }
                ForEach(sales) { x in
                    NavigationLink(value: EntryRef(.proceeds, x.id)) {
                        Text("Sold \(Days.display(x.saleDate))\(x.notes.isEmpty ? "" : " · \(x.notes)")").font(.callout).foregroundStyle(.secondary)
                    }
                }
            }
            Button { app.sheet = .proceeds(projectId: projectId) } label: {
                Label(sales.isEmpty ? "Record the sale" : "Add another sale record", systemImage: "house.and.flag").frame(minHeight: 44)
            }
        } header: { Text("Sale") }
    }

    @ViewBuilder func cashSection(_ st: Settlement) -> some View {
        Section {
            LabeledMoney(label: "Net proceeds", cents: st.netProceedsCents)
            if st.loanPayoffCents > 0 { LabeledMoney(label: "Loan paid off at closing", cents: -st.loanPayoffCents) }
            if st.stillToPayCents > 0 { LabeledMoney(label: "Bills and contracts still to pay", cents: -st.stillToPayCents) }
            LabeledMoney(label: "Already distributed", cents: -st.partners.reduce(0) { $0 + $1.distributedCents })
            LabeledContent { MoneyText(cents: st.cashLeftCents, font: .body.weight(.bold)).foregroundStyle(st.cashLeftCents < 0 ? .red : .primary) } label: {
                Text("Cash left to distribute").bold()
            }
            if st.remainingTotalCents > st.cashLeftCents + 100 {
                Label("Partners are owed \(Money.format(st.remainingTotalCents)) but only \(Money.format(max(st.cashLeftCents, 0))) is left from this sale. The rest can come from the next sale or the LLC account.",
                      systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange)
            }
        } header: { Text("Cash from the sale") } footer: {
            Text("What the LLC can pay out now: net proceeds, minus the loan payoff, bills and contracts still to pay, and distributions already made.")
        }
    }

    @ViewBuilder func partnersSection(_ st: Settlement) -> some View {
        Section {
            if st.partners.isEmpty { Text("No partners yet.").foregroundStyle(.secondary) }
            ForEach(st.partners) { x in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(x.member.displayName) · \(pct(x.shareBps))").font(.headline)
                        Spacer()
                        if st.sold { MoneyText(cents: x.remainingCents, font: .body.weight(.bold)) }
                    }
                    if st.sold {
                        Text("Capital back \(Money.format(x.capitalCents)) · \(x.profitShareCents < 0 ? "share of loss" : "profit share") \(Money.format(x.profitShareCents)) · paid out \(Money.format(x.distributedCents))")
                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        if x.owedForReceiptsCents > 0 {
                            Text("Also owed \(Money.format(x.owedForReceiptsCents)) for receipts they paid (reimbursed separately).").font(.caption).foregroundStyle(.orange)
                        }
                        if x.remainingCents > 0 {
                            Button { app.sheet = .distribution(projectId: projectId, partnerId: x.member.userId, amountCents: x.remainingCents) } label: {
                                Text("Pay \(Money.format(x.remainingCents))").frame(minHeight: 36)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    } else {
                        Text("Capital so far \(Money.format(x.capitalCents))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            Button { app.sheet = .profitSplit(projectId: projectId) } label: { Label("Change split", systemImage: "chart.pie").frame(minHeight: 44) }
        } header: {
            Text(st.sold ? "Who gets what" : "Profit split")
        } footer: {
            let note = st.shareSource == .project ? "This project has its own split." : st.shareSource == .default ? "Using the LLC default split." : "No split set, so profit is shared equally."
            Text("\(note) Capital each partner put in is returned first\(st.returnsLLCCapital ? ", including LLC-wide contributions (they come back at the LLC’s first sale)" : ""); the profit or loss is shared by the split. Receipts a partner paid personally are reimbursed separately.")
        }
    }

    @ViewBuilder func distributionsSection() -> some View {
        let l = app.ledger
        let ds = l.s.distributions.filter { $0.projectId == projectId }.sorted { $0.distributionDate > $1.distributionDate }
        Section("Distributions") {
            if ds.isEmpty { Text("Nothing paid out yet.").foregroundStyle(.secondary) }
            ForEach(ds) { d in
                if let e = l.entry(EntryRef(.distribution, d.id)) { NavigationLink(value: e.ref) { EntryRow(entry: e) } }
            }
            Button { app.sheet = .distribution(projectId: projectId, partnerId: nil, amountCents: nil) } label: {
                Label("Record a distribution", systemImage: "plus").frame(minHeight: 44)
            }
        }
    }
}

// MARK: - Forecast

struct ForecastSection: View {
    @Environment(AppModel.self) private var app
    let project: Project
    @State private var delay = 0.0
    @State private var salePct = 100.0

    var body: some View {
        let l = app.ledger
        let f = l.forecast(project, delayMonths: delay, salePct: salePct)
        let base = l.forecast(project)
        Section {
            if !f.missing.isEmpty {
                Label("Add the \(f.missing.joined(separator: " and ")) to see a forecast.", systemImage: "info.circle").foregroundStyle(.secondary)
            }
            LabeledMoney(label: salePct == 100 ? "Expected sale price" : "Sale at \(Int(salePct))%", cents: f.saleCents)
            LabeledMoney(label: "Selling costs (\(pct(project.sellingCostBps ?? 0)))", cents: -f.sellingCostsCents)
            LabeledMoney(label: "Projected project costs", cents: -f.projectedCostsCents)
            if f.budgetGapCents > 0 { LabeledMoney(label: "Budget not yet committed", cents: -f.budgetGapCents) }
            LabeledMoney(label: String(format: "Holding, %.1f months", f.monthsLeft), cents: -f.holdingCents)
            if f.interestCents > 0 { LabeledMoney(label: "Loan interest", cents: -f.interestCents) }
            LabeledContent { MoneyText(cents: f.profitCents, font: .title3.weight(.bold)).tone(f.profitCents) } label: {
                VStack(alignment: .leading) {
                    Text("Projected profit").bold()
                    if let m = f.marginBps { Text(String(format: "%.1f%% on cost", Double(m) / 100)).font(.caption).foregroundStyle(.secondary) }
                }
            }
            if delay > 0 || salePct != 100 {
                Text("\(Money.format(f.profitCents - base.profitCents)) vs. the plan").font(.callout.monospacedDigit())
                    .foregroundStyle(f.profitCents < base.profitCents ? .red : .green)
            }
            VStack(alignment: .leading) {
                Text("If it sells \(delay == 0 ? "on time" : "\(Int(delay)) month\(delay == 1 ? "" : "s") late")").font(.subheadline)
                Slider(value: $delay, in: 0...12, step: 1).accessibilityLabel("Months late")
            }
            VStack(alignment: .leading) {
                Text("At \(Int(salePct))% of the expected price").font(.subheadline)
                Slider(value: $salePct, in: 80...110, step: 1).accessibilityLabel("Sale price percent")
            }
            Button { app.sheet = .project(project) } label: { Label("Edit forecast inputs", systemImage: "slider.horizontal.3").frame(minHeight: 44) }
        } header: {
            Text("Forecast")
        } footer: {
            Text("Sale price minus selling costs, projected spend (paid + billed + committed, or the budget if higher), monthly holding costs and loan interest until the target sale date.")
        }
    }
}

// MARK: - Materials

struct MaterialsView: View {
    @Environment(AppModel.self) private var app
    let projectId: UUID

    var body: some View {
        let l = app.ledger
        let ms = l.s.materials.filter { $0.projectId == projectId }.sorted { $0.name < $1.name }
        let leftValue = ms.reduce(0) { $0 + max($1.leftValueCents, 0) }
        let elsewhere = l.s.materials.filter { $0.projectId != projectId && $0.qtyLeft > 0 }
        List {
            Section {
                if ms.isEmpty { Text("Nothing tracked yet. Add big-ticket items like flooring, tile, cabinets or lumber.").foregroundStyle(.secondary) }
                ForEach(ms) { m in
                    Button { app.sheet = .material(m, projectId: projectId) } label: { MaterialRow(material: m) }
                        .foregroundStyle(.primary)
                }
                if !ms.isEmpty { LabeledMoney(label: "Leftover value on this project", cents: leftValue, bold: true) }
                Button { app.sheet = .material(nil, projectId: projectId) } label: { Label("Add material", systemImage: "plus").frame(minHeight: 44) }
            } header: { Text("Materials (\(ms.count))") } footer: {
                Text("Not an inventory system: just enough to catch returns before the deadline and reuse leftovers. Receipts stay the money record.")
            }
            if !elsewhere.isEmpty {
                Section("Leftovers on other projects") {
                    ForEach(elsewhere) { m in
                        NavigationLink(value: Route.materials(m.projectId)) {
                            VStack(alignment: .leading) {
                                Text("\(m.name) · \(qty(m.qtyLeft)) \(m.unit)")
                                Text([l.project(m.projectId)?.nickname, m.location.isEmpty ? nil : m.location].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Materials · \(l.project(projectId)?.nickname ?? "")")
    }
}

func qty(_ d: Double) -> String { d == d.rounded() ? String(Int(d)) : String(format: "%.2f", d) }

struct MaterialRow: View {
    let material: LedgerCore.Material
    var body: some View {
        let m = material
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(m.name).font(.headline)
                Spacer()
                if m.unitCostCents > 0 { MoneyText(cents: m.leftValueCents, font: .callout) }
            }
            Text("Bought \(qty(m.qtyBought)) · used \(qty(m.qtyUsed)) · returned \(qty(m.qtyReturned))\(m.unit.isEmpty ? "" : " \(m.unit)")")
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                if m.qtyLeft > 0 {
                    Label("\(qty(m.qtyLeft)) left", systemImage: "shippingbox").font(.caption.weight(.semibold)).foregroundStyle(.orange)
                } else {
                    Label("All used or returned", systemImage: "checkmark.circle").font(.caption).foregroundStyle(.secondary)
                }
                if !m.location.isEmpty { Text("· \(m.location)").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Forms

struct DistributionForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var projectId: UUID?
    @State var partnerId: UUID?
    @State private var amount: String
    @State private var id = UUID()
    @State private var date = Days.today
    @State private var method = "ach"
    @State private var reference = ""
    @State private var notes = ""
    @State private var busy = false

    init(projectId: UUID?, partnerId: UUID?, amountCents: Cents?) {
        _projectId = State(initialValue: projectId)
        _partnerId = State(initialValue: partnerId)
        _amount = State(initialValue: amountCents.map { Money.plain($0) } ?? "")
    }

    var body: some View {
        FormShell(title: "Distribution", saveTitle: "Save distribution", canSave: (Money.parse(amount) ?? 0) > 0 && partnerId != nil, busy: busy, onSave: save) {
            Section {
                PartnerPicker(label: "Paid to", partnerId: $partnerId)
                AmountField(label: "Amount", text: $amount, big: true)
                ProjectPicker(projectId: $projectId, allowNone: true)
                DayPicker(label: "Date", day: $date)
                MethodPicker(method: $method)
                TextField("Reference (check #, wire id)", text: $reference).frame(minHeight: 44)
                TextField("Notes", text: $notes, axis: .vertical)
            } footer: {
                Text("Money the LLC pays a partner from a sale: capital back and profit share. Can be voided, never edited.")
            }
        }
    }

    func save() {
        guard let ws = app.workspace?.id, let cents = Money.parse(amount), let partnerId else { return }
        let d = Distribution(id: id, workspaceId: ws, partnerUserId: partnerId, projectId: projectId, amountCents: cents, distributionDate: date,
                             paymentMethod: method, reference: reference, notes: notes, clientId: id)
        busy = true
        Task {
            if await app.insert(.distribution(d), success: "Distribution saved") { dismiss() }
            busy = false
        }
    }
}

/// Profit split for one project, or (projectId nil) the LLC default.
struct ProfitSplitForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let projectId: UUID?
    @State private var percents: [UUID: String] = [:]
    @State private var loaded = false
    @State private var busy = false

    var body: some View {
        let l = app.ledger
        let members = l.s.members.filter { m in m.hasAccess || l.s.profitShares.contains { $0.partnerUserId == m.userId } }
        let bps = members.map { m in Int(((Double(percents[m.userId] ?? "") ?? 0) * 100).rounded()) }
        let total = bps.reduce(0, +)
        let current = l.profitShares(project: projectId)
        FormShell(title: projectId == nil ? "LLC default split" : "Profit split", saveTitle: "Save split", canSave: total == 10000, busy: busy, onSave: save) {
            Section {
                ForEach(members) { m in
                    HStack {
                        Text(m.displayName)
                        Spacer()
                        TextField("0", text: Binding(get: { percents[m.userId] ?? "" }, set: { percents[m.userId] = $0 }))
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 90).font(.body.monospacedDigit())
                        Text("%").foregroundStyle(.secondary)
                    }
                    .frame(minHeight: 44)
                }
                LabeledContent("Total") {
                    Text(pct(total)).font(.body.monospacedDigit().weight(.bold)).foregroundStyle(total == 10000 ? Color.primary : Color.red)
                }
                Button("Split equally") {
                    for s in Settlements.equalShares(members) { percents[s.partnerUserId] = String(format: "%.2f", Double(s.shareBps) / 100) }
                }
            } footer: {
                Text("Now: \(current.source.label). Shares must add up to 100%. Capital is returned before profit is split.")
            }
            if current.source == (projectId == nil ? .default : .project) {
                Section {
                    Button(projectId == nil ? "Remove the default (split equally)" : "Use the LLC default for this project", role: .destructive) {
                        busy = true
                        Task {
                            if await app.perform(.setProfitShares(projectId: projectId, shares: []), success: "Back to the default split") { dismiss() }
                            busy = false
                        }
                    }
                }
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            for s in current.shares { percents[s.partnerUserId] = s.shareBps % 100 == 0 ? String(s.shareBps / 100) : String(format: "%.2f", Double(s.shareBps) / 100) }
        }
    }

    func save() {
        let shares = percents.compactMap { uid, text -> Share? in
            let b = Int(((Double(text) ?? 0) * 100).rounded())
            return b > 0 ? Share(partnerUserId: uid, shareBps: b) : nil
        }
        busy = true
        Task {
            if await app.perform(.setProfitShares(projectId: projectId, shares: shares), success: "Profit split saved") { dismiss() }
            busy = false
        }
    }
}

struct MaterialForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var m: LedgerCore.Material
    @State private var bought: String
    @State private var used: String
    @State private var returned: String
    @State private var cost: String
    @State private var confirmDelete = false
    @State private var busy = false
    let isNew: Bool

    init(material: LedgerCore.Material?, projectId: UUID, workspace: UUID) {
        let x = material ?? LedgerCore.Material(workspaceId: workspace, projectId: projectId, name: "")
        _m = State(initialValue: x)
        _bought = State(initialValue: material == nil ? "" : qty(x.qtyBought))
        _used = State(initialValue: material == nil ? "" : qty(x.qtyUsed))
        _returned = State(initialValue: material == nil ? "" : qty(x.qtyReturned))
        _cost = State(initialValue: x.unitCostCents > 0 ? Money.plain(x.unitCostCents) : "")
        isNew = material == nil
    }

    var built: LedgerCore.Material {
        var x = m
        x.qtyBought = Double(bought) ?? 0; x.qtyUsed = Double(used) ?? 0; x.qtyReturned = Double(returned) ?? 0
        x.unitCostCents = Money.parse(cost) ?? 0
        return x
    }

    var body: some View {
        let x = built
        FormShell(title: isNew ? "Add material" : "Material", saveTitle: "Save", canSave: x.isValid, busy: busy, onSave: save) {
            Section {
                TextField("What (e.g. LVP flooring)", text: $m.name).frame(minHeight: 44)
                TextField("Unit (box, sheet, each)", text: $m.unit).frame(minHeight: 44)
                Picker("Project", selection: $m.projectId) {
                    ForEach(app.ledger.s.projects.sorted { $0.nickname < $1.nickname }) { Text($0.nickname).tag($0.id) }
                }
            }
            Section {
                qtyField("Bought", $bought)
                qtyField("Used", $used)
                qtyField("Returned", $returned)
                AmountField(label: "Cost per unit", text: $cost)
                LabeledContent("Left over", value: "\(qty(x.qtyLeft)) \(x.unit)")
                if x.unitCostCents > 0 { LabeledMoney(label: "Left value", cents: x.leftValueCents) }
                if x.qtyUsed + x.qtyReturned > x.qtyBought + 0.0001 {
                    Label("Used plus returned can’t be more than what was bought.", systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                }
            }
            Section {
                TextField("Where it is (garage, shed)", text: $m.location).frame(minHeight: 44)
                TextField("Notes (return by date, color, lot #)", text: $m.notes, axis: .vertical)
            }
            if !isNew {
                Section { Button("Remove material", role: .destructive) { confirmDelete = true } }
            }
        }
        .confirmationDialog("Remove \(m.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                Task { if await app.perform(.deleteMaterial(id: m.id), success: "LedgerCore.Material removed") { dismiss() } }
            }
        } message: { Text("Materials aren't money records, so they can be removed. The receipt stays.") }
    }

    func qtyField(_ label: String, _ text: Binding<String>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("0", text: text).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 110).font(.body.monospacedDigit())
        }
        .frame(minHeight: 44)
    }

    func save() {
        busy = true
        Task {
            if await app.perform(.saveMaterial(built), success: "LedgerCore.Material saved") { dismiss() }
            busy = false
        }
    }
}
