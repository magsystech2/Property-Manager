import SwiftUI
import LedgerCore

struct PartnersView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let balances = app.ledger.partnerBalances()
        List {
            Section {
                LabeledMoney(label: "LLC owes partners", cents: balances.reduce(0) { $0 + max($1.owedCents, 0) }, bold: true)
                LabeledMoney(label: "Capital contributed", cents: balances.reduce(0) { $0 + $1.contributionsCents })
                LabeledMoney(label: "Reimbursement requests pending", cents: balances.reduce(0) { $0 + $1.pendingReimbursementCents })
            } header: {
                Text("Across the LLC")
            } footer: {
                Text("Every balance comes from recorded transactions only. Nothing assumes equal shares.")
            }
            Section("Partners") {
                ForEach(balances) { b in
                    NavigationLink(value: Route.partner(b.member.userId)) { PartnerCard(balance: b) }
                }
            }
            Section {
                Button { app.sheet = .reimbursement(partnerId: nil) } label: { Label("Reimburse a partner", systemImage: "arrow.uturn.backward.circle").frame(minHeight: 44) }
                Button { app.sheet = .contribution(projectId: nil) } label: { Label("Add contribution", systemImage: "building.columns").frame(minHeight: 44) }
                Button { app.sheet = .distribution(projectId: nil, partnerId: nil, amountCents: nil) } label: { Label("Record a distribution", systemImage: "arrow.up.forward.circle").frame(minHeight: 44) }
                Button { app.sheet = .profitSplit(projectId: nil) } label: {
                    LabeledContent { Text(app.ledger.profitShares(project: nil).source == .default ? "Set" : "Equal").foregroundStyle(.secondary) } label: {
                        Label("LLC default profit split", systemImage: "chart.pie")
                    }
                    .frame(minHeight: 44)
                }
                NavigationLink(value: Route.reports) { Label("Reports", systemImage: "chart.bar.xaxis").frame(minHeight: 44) }
                NavigationLink(value: Route.export(projectId: nil, partnerId: nil, vendorId: nil)) { Label("Export CSV", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
                NavigationLink(value: Route.settings) { Label("Settings, members and invites", systemImage: "gearshape").frame(minHeight: 44) }
            }
        }
        .navigationTitle("Partners")
        .refreshable { await app.reload() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(value: Route.settings) { Label("Settings", systemImage: "gearshape") }
            }
        }
    }
}

struct PartnerCard: View {
    @Environment(AppModel.self) private var app
    let balance: PartnerBalance
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(balance.member.userId == app.me ? "\(balance.member.displayName) (me)" : balance.member.displayName).font(.headline)
                if balance.member.isOwner { Text("Owner").font(.caption).padding(.horizontal, 6).background(.quaternary, in: Capsule()) }
                if !balance.member.hasAccess {
                    Label("No access", systemImage: "lock.fill").font(.caption.weight(.semibold)).foregroundStyle(.red)
                }
                Spacer()
            }
            HStack(alignment: .firstTextBaseline) {
                Text("LLC owes").font(.subheadline).foregroundStyle(.secondary)
                Spacer()
                MoneyText(cents: balance.owedCents, font: .title3.weight(.bold))
            }
            Text("Paid personally \(Money.format(balance.outOfPocketCents)) · Reimbursed \(Money.format(balance.reimbursedCents)) · Contributed \(Money.format(balance.contributionsCents))")
                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            if balance.pendingReimbursementCents > 0 {
                Label("\(Money.format(balance.pendingReimbursementCents)) reimbursement pending", systemImage: "hourglass").font(.caption.weight(.semibold))
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

struct PartnerDetailView: View {
    @Environment(AppModel.self) private var app
    let userId: UUID

    var body: some View {
        let l = app.ledger
        let b = l.partnerBalance(userId)
        let entries = l.partnerEntries(userId)
        List {
            Section {
                LabeledMoney(label: "Paid personally for projects", cents: b.outOfPocketCents)
                LabeledMoney(label: "Reimbursed by the LLC", cents: b.reimbursedCents)
                LabeledMoney(label: "LLC still owes", cents: b.owedCents, bold: true)
                LabeledMoney(label: "Pending reimbursement requests", cents: b.pendingReimbursementCents)
                LabeledMoney(label: "Capital contributions", cents: b.contributionsCents)
                if b.distributionsCents != 0 { LabeledMoney(label: "Distributions received", cents: b.distributionsCents) }
            } header: {
                Text("Balance")
            } footer: {
                Text("Still owes = paid personally − reimbursed. Contributions are tracked separately and don't change this.")
            }
            Section {
                Button { app.sheet = .reimbursement(partnerId: userId) } label: {
                    Label(userId == app.me ? "Request reimbursement" : "Reimburse \(b.member.displayName)", systemImage: "arrow.uturn.backward.circle").frame(minHeight: 44)
                }
                .disabled(b.owedCents <= 0)
                Button { app.sheet = .contribution(projectId: nil, partnerId: userId) } label: { Label("Add contribution", systemImage: "building.columns").frame(minHeight: 44) }
                NavigationLink(value: Route.export(projectId: nil, partnerId: userId, vendorId: nil)) { Label("Export CSV for \(b.member.displayName)", systemImage: "square.and.arrow.up").frame(minHeight: 44) }
            }
            Section("By property") {
                ForEach(l.s.projects.sorted { $0.nickname < $1.nickname }) { p in
                    let pb = l.partnerBalance(userId, project: p.id)
                    if pb.outOfPocketCents != 0 || pb.contributionsCents != 0 {
                        NavigationLink(value: Route.records(title: "\(b.member.displayName) · \(p.nickname)",
                                                            refs: entries.filter { $0.projectId == p.id }.map(\.ref), explanation: nil)) {
                            VStack(alignment: .leading) {
                                Text(p.nickname).font(.headline)
                                Text("Paid personally \(Money.format(pb.outOfPocketCents)) · Contributed \(Money.format(pb.contributionsCents))")
                                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                let llcWide = l.s.contributions.filter { $0.partnerUserId == userId && $0.projectId == nil && !$0.isVoid }.reduce(0) { $0 + $1.amountCents }
                if llcWide > 0 { LabeledMoney(label: "LLC-wide contributions", cents: llcWide) }
            }
            let open = l.reimbursableItems(userId)
            if !open.isEmpty {
                Section("Not reimbursed yet") {
                    ForEach(open, id: \.ref) { item in
                        NavigationLink(value: item.ref) {
                            LabeledContent {
                                MoneyText(cents: item.remainingCents, font: .body.weight(.semibold))
                            } label: {
                                Text(item.entry.title)
                                Text("\(Days.display(item.entry.date)) · \(app.ledger.project(item.entry.projectId)?.nickname ?? "")")
                            }
                        }
                    }
                }
            }
            Section("All transactions") { EntryList(entries: entries, empty: "No personal payments, reimbursements or contributions yet.") }
        }
        .navigationTitle(b.member.displayName)
    }
}

// MARK: - Settings

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var inviteEmail = ""
    @State private var inviteRole = "partner"
    @State private var newCategory = ""
    @State private var myName = ""
    @State private var showLiveSetup = false
    @State private var confirmSignOut = false
    @State private var removing: Member?

    var body: some View {
        let s = app.ledger.s
        Form {
            Section {
                LabeledContent("LLC", value: s.workspace.name)
                LabeledContent("Mode", value: app.isDemo ? "Demo (this phone only)" : "Live sync")
                if let d = app.lastSynced { LabeledContent("Last updated", value: d.formatted(date: .omitted, time: .shortened)) }
                if let me = app.myMember {
                    HStack {
                        TextField("Your name", text: $myName).frame(minHeight: 44)
                        Button("Save") { var m = me; m.displayName = myName; Task { await app.save(member: m) } }
                            .disabled(myName.isEmpty || myName == me.displayName)
                    }
                    .onAppear { myName = me.displayName }
                }
            }

            Section {
                Toggle("Require a second partner to approve", isOn: Binding(get: { s.workspace.requireReview }, set: { on in
                    var w = s.workspace; w.requireReview = on; Task { await app.save(workspace: w) }
                }))
                .disabled(!app.isOwner)
                .frame(minHeight: 44)
            } header: { Text("Approvals") } footer: {
                Text("When on, new bills, change orders and reimbursement requests wait until a different partner approves them. Only the owner can change this.")
            }

            Section {
                ForEach(s.members) { m in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(m.displayName)
                            if let e = m.email { Text(e).font(.caption).foregroundStyle(.secondary) }
                            if !m.hasAccess {
                                Label("Access removed", systemImage: "lock.fill").font(.caption.weight(.semibold)).foregroundStyle(.red)
                            }
                        }
                        Spacer()
                        if !m.hasAccess {
                            if app.isOwner {
                                Button("Restore") { Task { await app.setAccess(member: m, revoked: false) } }
                            }
                        } else if app.isOwner && m.userId != app.me {
                            Menu {
                                Picker("Role", selection: Binding(get: { m.role }, set: { r in var x = m; x.role = r; Task { await app.save(member: x) } })) {
                                    Text("Owner").tag("owner"); Text("Partner").tag("partner")
                                }
                                if !m.isOwner {
                                    Divider()
                                    Button(role: .destructive) { removing = m } label: { Label("Remove access…", systemImage: "lock") }
                                }
                            } label: {
                                HStack(spacing: 4) { Text(m.isOwner ? "Owner" : "Partner"); Image(systemName: "chevron.up.chevron.down").font(.caption) }
                                    .frame(minHeight: 44)
                            }
                            .accessibilityLabel("Role and access for \(m.displayName)")
                        } else {
                            Text(m.isOwner ? "Owner" : "Partner").foregroundStyle(.secondary)
                        }
                    }
                    .frame(minHeight: 44)
                }
            } header: { Text("Members") } footer: {
                if app.isOwner {
                    Text("Tap a partner's role to change it or remove their access. A partner without access keeps their place in the books (what they paid, what the LLC owes them) but can no longer see or add anything. You can restore access later.")
                }
            }

            if app.isOwner {
                Section {
                    ForEach(s.invites.filter { $0.acceptedAt == nil }) { i in
                        HStack {
                            VStack(alignment: .leading) { Text(i.email); Text("Invited as \(i.role)").font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Button("Cancel", role: .destructive) { Task { await app.cancel(invite: i) } }
                        }
                    }
                    TextField("partner@email.com", text: $inviteEmail)
                        .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .frame(minHeight: 44)
                    Picker("Role", selection: $inviteRole) { Text("Partner").tag("partner"); Text("Owner").tag("owner") }
                    Button("Invite") {
                        Task { if await app.invite(email: inviteEmail.trimmingCharacters(in: .whitespaces), role: inviteRole) { inviteEmail = "" } }
                    }
                    .disabled(!inviteEmail.contains("@"))
                    .frame(minHeight: 44)
                } header: { Text("Invite partners") } footer: {
                    Text("The partner installs the app, creates an account with this exact email, and taps “Join my invitation”. Only members of this LLC can see its records and documents.")
                }
            }

            Section {
                ForEach(s.categories.sorted { $0.sortOrder < $1.sortOrder }) { c in
                    CategoryRow(category: c)
                }
                HStack {
                    TextField("New category", text: $newCategory).frame(minHeight: 44)
                    Button("Add") {
                        let c = BudgetCategory(workspaceId: s.workspace.id, name: newCategory.trimmingCharacters(in: .whitespaces),
                                               sortOrder: (s.categories.map(\.sortOrder).max() ?? 0) + 1)
                        Task { await app.save(category: c); newCategory = "" }
                    }
                    .disabled(newCategory.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: { Text("Budget categories") } footer: {
                Text("Shared by all projects. Hidden categories keep their history but aren't offered for new entries.")
            }

            Section {
                if app.isDemo {
                    Button("Leave demo and connect live sync") { showLiveSetup = true }.frame(minHeight: 44)
                    Button("Reset sample data", role: .destructive) { Task { await app.resetDemo() } }.frame(minHeight: 44)
                } else {
                    Button("Live sync settings") { showLiveSetup = true }.frame(minHeight: 44)
                }
                Button(app.isDemo ? "Exit demo" : "Sign out", role: .destructive) { confirmSignOut = true }.frame(minHeight: 44)
            } footer: {
                Text("Drafts and documents waiting to sync stay on this phone after signing out and upload next time you sign in to the same LLC.")
            }
        }
        .navigationTitle("Settings")
        .sheet(isPresented: $showLiveSetup) {
            LiveSetupView {
                Task {
                    await app.signOut()
                    app.chooseLive()
                }
            }
        }
        .confirmationDialog("Remove \(removing?.displayName ?? "")'s access?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible, presenting: removing) { m in
            Button("Remove access", role: .destructive) { Task { await app.setAccess(member: m, revoked: true) } }
        } message: { _ in
            Text("They won't be able to see this LLC's records or documents. Their past entries and balances stay as they are.")
        }
        .confirmationDialog(app.isDemo ? "Exit demo?" : "Sign out?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(app.isDemo ? "Exit demo" : "Sign out", role: .destructive) { Task { await app.signOut() } }
        }
    }
}

struct CategoryRow: View {
    @Environment(AppModel.self) private var app
    let category: BudgetCategory
    @State private var name = ""
    var body: some View {
        HStack {
            TextField("Name", text: $name)
            .onSubmit {
                guard !name.isEmpty, name != category.name else { return }
                var c = category; c.name = name; Task { await app.save(category: c) }
            }
            .foregroundStyle(category.archived ? .secondary : .primary)
            .onAppear { name = category.name }
            Button(category.archived ? "Show" : "Hide") {
                var c = category; c.archived.toggle(); Task { await app.save(category: c) }
            }
            .buttonStyle(.borderless)
        }
        .frame(minHeight: 44)
    }
}
