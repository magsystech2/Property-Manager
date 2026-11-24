import SwiftUI
import LedgerCore

struct HomeView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let l = app.ledger
        let h = l.home()
        let open = l.openCommitments().filter { l.project($0.0.projectId)?.isActive ?? false }
        let unbilled = open.reduce(0) { $0 + $1.1.unbilledCents }
        let drafts = app.allDrafts
        let pendingFiles = app.pendingAttachments

        List {
            // Things to act on first.
            if !h.overdue.isEmpty {
                Section {
                    EntryList(entries: h.overdue)
                } header: {
                    Label("Overdue bills", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                }
            }
            if !h.needsReview.isEmpty {
                Section {
                    EntryList(entries: h.needsReview)
                } header: {
                    Label("Needs review or payment", systemImage: "hourglass")
                } footer: {
                    if app.workspace?.requireReview == true {
                        Text("Review is on: another partner must approve bills, change orders and reimbursement requests.")
                    }
                }
            }
            if !drafts.isEmpty || !pendingFiles.isEmpty {
                Section {
                    NavigationLink(value: Route.drafts) {
                        HStack {
                            Label("\(drafts.count) draft\(drafts.count == 1 ? "" : "s")", systemImage: "tray.full")
                            Spacer()
                            let waiting = drafts.filter { $0.sync == .waiting }.count + pendingFiles.count
                            let failed = drafts.filter { $0.sync == .failed }.count
                            if failed > 0 { SyncBadge(state: .failed) } else if waiting > 0 { SyncBadge(state: .waiting) }
                        }
                        .frame(minHeight: 44)
                    }
                } header: {
                    Text("On this phone")
                } footer: {
                    Text("Drafts and documents here aren't visible to partners until they sync.")
                }
            }

            ToolsSection()

            Section {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                    NavigationLink(value: Route.records(title: "Paid on active projects", refs: h.paidActiveSources,
                                                        explanation: "Receipts and bill payments on projects that aren't sold yet. Reimbursements to partners are not project costs and aren't included.")) {
                        Tile(title: "Paid, active projects", cents: h.paidActiveCents, symbol: "checkmark.circle")
                    }
                    NavigationLink(value: Route.records(title: "Unpaid bills", refs: h.unpaidBills.map(\.ref),
                                                        explanation: "Bills with a balance still owed to the vendor, after payments and credits.")) {
                        Tile(title: "Unpaid bills", cents: h.unpaidBillsCents, symbol: "doc.text", detail: "\(h.unpaidBills.count) bills")
                    }
                    NavigationLink(value: Route.records(title: "Owed to partners", refs: h.partnerBalances.flatMap { b in l.reimbursableItems(b.member.userId).map(\.ref) },
                                                        explanation: "Costs partners paid personally that the LLC hasn't reimbursed yet. Owed = paid personally minus reimbursements received.")) {
                        Tile(title: "Owed to partners", cents: h.owedToPartnersCents, symbol: "person.3")
                    }
                    NavigationLink(value: Route.records(title: "Committed, not billed", refs: open.map { EntryRef(.commitment, $0.0.id) },
                                                        explanation: "Contractor and supplier agreements (with approved change orders) that haven't been invoiced yet.")) {
                        Tile(title: "Committed, not billed", cents: unbilled, symbol: "signature")
                    }
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                .listRowBackground(Color.clear)
            }

            Section {
                if h.dueSoon.isEmpty { Text("No bills due in the next 14 days.").foregroundStyle(.secondary) }
                EntryList(entries: h.dueSoon)
            } header: {
                Text("Due in the next 14 days")
            }

            Section("Owed to each partner") {
                ForEach(h.partnerBalances) { b in
                    NavigationLink(value: Route.partner(b.member.userId)) {
                        LabeledContent {
                            MoneyText(cents: b.owedCents, font: .body.weight(.semibold))
                        } label: {
                            Text(b.member.userId == app.me ? "\(b.member.displayName) (me)" : b.member.displayName)
                        }
                        .frame(minHeight: 44)
                    }
                }
            }

            Section("Active projects") {
                ForEach(l.s.projects.filter(\.isActive).sorted { $0.nickname < $1.nickname }) { p in
                    NavigationLink(value: Route.project(p.id)) { ProjectRow(project: p) }
                }
            }
        }
        .navigationTitle(app.workspace?.name ?? "Home")
        .refreshable { await app.reload(); await app.syncPending() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if app.isSyncing { ProgressView() }
            }
        }
    }
}

struct Tile: View {
    let title: String
    let cents: Cents
    let symbol: String
    var detail: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: symbol).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            MoneyText(cents: cents, font: .title2.weight(.bold))
                .minimumScaleFactor(0.6).lineLimit(1)
            HStack {
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Text("See records").font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor)
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(Color.accentColor)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows the records behind this total")
    }
}

struct ProjectRow: View {
    @Environment(AppModel.self) private var app
    let project: Project
    var body: some View {
        let t = app.ledger.totals(project: project.id)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(project.nickname).font(.headline)
                Spacer()
                Text("\(project.typeLabel) · \(project.statusLabel)").font(.caption).foregroundStyle(.secondary)
            }
            if !project.address.isEmpty { Text(project.address).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
            if t.budgetCents > 0 {
                ProgressView(value: Double(min(t.projectedCents, t.budgetCents)), total: Double(max(t.budgetCents, 1)))
                    .tint(t.remainingCents < 0 ? .red : .accentColor)
                    .accessibilityHidden(true)
            }
            HStack {
                Text("Projected \(Money.format(t.projectedCents, showCents: false)) of \(Money.format(t.budgetCents, showCents: false)) budget")
                    .font(.caption.monospacedDigit())
                Spacer()
                if t.remainingCents < 0 {
                    Label("Over by \(Money.format(-t.remainingCents, showCents: false))", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold)).foregroundStyle(.red)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Inbox, statements, weekly review, cash plan, recurring costs and reports, with what needs attention.
struct ToolsSection: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        let l = app.ledger
        let inbox = l.s.inboxItems.filter { $0.status == "new" }.count
        let toMatch = l.s.statementLines.filter { $0.status == "unmatched" }.count
        let due = l.dueTemplates().count
        let plan = l.cashPlan()
        Section {
            row(.review, "Weekly review", "checklist", nil)
            row(.inbox, "Receipt inbox", "tray", inbox > 0 ? "\(inbox) to file" : nil)
            row(.statements, "Card and bank statements", "creditcard", toMatch > 0 ? "\(toMatch) to match" : nil)
            row(.cashPlan, "Cash plan, next 30 days", "calendar", plan.shortfall.map { "Short \(Money.format($0.shortByCents, showCents: false))" }, warn: plan.shortfall != nil)
            row(.templates, "Recurring and templates", "repeat", due > 0 ? "\(due) due" : nil)
            row(.reports, "Reports", "chart.bar.xaxis", nil)
        } header: { Text("Keep up") }
    }

    func row(_ r: Route, _ title: String, _ icon: String, _ badge: String?, warn: Bool = false) -> some View {
        NavigationLink(value: r) {
            HStack {
                Label(title, systemImage: icon)
                Spacer()
                if let badge {
                    Text(badge).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
                        .foregroundStyle(warn ? Color.red : Color.accentColor)
                        .background((warn ? Color.red : Color.accentColor).opacity(0.12), in: Capsule())
                }
            }
            .frame(minHeight: 44)
        }
    }
}
