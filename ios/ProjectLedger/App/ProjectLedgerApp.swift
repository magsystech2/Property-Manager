import SwiftUI
import LedgerCore

@main
struct ProjectLedgerApp: App {
    @State private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .task { await app.launch() }
                // "Share" or "Open in Project Ledger" from Mail, Files or Photos: the file goes to the receipt inbox.
                .onOpenURL { url in
                    guard url.isFileURL else { return }
                    Task { await app.handleOpenedFile(url) }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active, app.phase == .ready {
                        Task { await app.reload(quiet: true); await app.syncPending() }
                    }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        Group {
            switch app.phase {
            case .launching: ProgressView("Loading…")
            case .welcome: WelcomeView()
            case .signIn: SignInView()
            case .chooseWorkspace: ChooseWorkspaceView()
            case .ready: MainTabs()
            }
        }
        .overlay(alignment: .top) { ToastView() }
        .alert("Couldn't do that", isPresented: Binding(get: { app.errorMessage != nil }, set: { if !$0 { app.errorMessage = nil } })) {
            Button("OK", role: .cancel) { app.errorMessage = nil }
            if app.phase == .ready && app.sheet == nil {
                Button("Report this") {
                    let err = app.errorMessage
                    app.errorMessage = nil
                    app.sheet = .report(ref: nil, error: err, page: "Error message")
                }
            }
        } message: {
            Text(app.errorMessage ?? "")
        }
    }
}

struct ToastView: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        if let t = app.toast {
            Label(t, systemImage: "checkmark.circle.fill")
                .font(.callout.weight(.semibold))
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(.thinMaterial, in: Capsule())
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: t) {
                    try? await Task.sleep(for: .seconds(2.5))
                    withAnimation { app.toast = nil }
                }
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

enum Tab: Hashable { case home, projects, activity, partners }

struct MainTabs: View {
    @Environment(AppModel.self) private var app
    @State private var tab: Tab = .home

    var body: some View {
        @Bindable var app = app
        VStack(spacing: 0) {
            DemoBanner()
            TabView(selection: $tab) {
                NavigationStack { HomeView().ledgerDestinations() }
                    .addButtonInset()
                    .tabItem { Label("Home", systemImage: "house") }.tag(Tab.home)
                NavigationStack { ProjectsView().ledgerDestinations() }
                    .addButtonInset()
                    .tabItem { Label("Projects", systemImage: "building.2") }.tag(Tab.projects)
                NavigationStack { ActivityView().ledgerDestinations() }
                    .addButtonInset()
                    .tabItem { Label("Activity", systemImage: "list.bullet.rectangle") }.tag(Tab.activity)
                NavigationStack { PartnersView().ledgerDestinations() }
                    .addButtonInset()
                    .tabItem { Label("Partners", systemImage: "person.3") }.tag(Tab.partners)
            }
        }
        .sheet(item: $app.sheet) { route in
            FormHost(route: route).environment(app)
        }
    }
}

/// Reserves a strip at the bottom for the Add button, so lists end above it instead of under it.
struct AddButtonInset: ViewModifier {
    @Environment(AppModel.self) private var app
    func body(content: Content) -> some View {
        // The inset alone doesn't reach Lists inside the NavigationStack, so also pad
        // their scroll content by the button's height (64pt + 2×8pt padding).
        content
            .contentMargins(.bottom, 80, for: .scrollContent)
            .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack {
                Spacer()
                AddButton(action: Binding(get: { nil }, set: { a in if let a { app.sheet = FormRoute(a, projectId: app.currentProjectId) } }))
            }
        }
    }
}

extension View {
    func addButtonInset() -> some View { modifier(AddButtonInset()) }
}

// MARK: - Navigation

enum Route: Hashable {
    case project(UUID)
    case vendor(UUID)
    case vendors
    case partner(UUID)
    case records(title: String, refs: [EntryRef], explanation: String?)
    case drafts
    case settings
    case export(projectId: UUID?, partnerId: UUID?, vendorId: UUID?)
    case sale(UUID)
    case materials(UUID)
    case inbox
    case statements
    case statementLine(UUID)
    case review
    case cashPlan
    case templates
    case reports
    case issues
    case needsReview
    case help
}

extension View {
    func ledgerDestinations() -> some View {
        self
            .navigationDestination(for: EntryRef.self) { EntryDetailView(ref: $0) }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .project(let id): ProjectDetailView(projectId: id)
                case .vendor(let id): VendorDetailView(vendorId: id)
                case .vendors: VendorsListView()
                case .partner(let id): PartnerDetailView(userId: id)
                case .records(let title, let refs, let explanation): RecordsView(title: title, refs: refs, explanation: explanation)
                case .drafts: DraftsView()
                case .settings: SettingsView()
                case .export(let p, let partner, let v): ExportView(filter: CSVExport.Filter(projectId: p, partnerId: partner, vendorId: v))
                case .sale(let id): SaleView(projectId: id)
                case .materials(let id): MaterialsView(projectId: id)
                case .inbox: InboxView()
                case .statements: StatementsView()
                case .statementLine(let id): StatementLineView(lineId: id)
                case .review: WeeklyReviewView()
                case .cashPlan: CashPlanView()
                case .templates: TemplatesView()
                case .reports: ReportsView()
                case .issues: IssuesView()
                case .needsReview: NeedsReviewView()
                case .help: HelpView()
                }
            }
            .navigationDestination(for: AnyRoute.self) { r in
                switch r {
                case .entry(let ref): EntryDetailView(ref: ref)
                case .route(.statementLine(let id)): StatementLineView(lineId: id)
                case .route(.inbox): InboxView()
                case .route(.statements): StatementsView()
                default: WeeklyReviewView()
                }
            }
    }
}
