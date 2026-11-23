import SwiftUI
import FirebaseCore

@main
struct FlipTrackerApp: App {
    @State private var session: SessionStore
    @State private var store: DataStore

    init() {
        // Firebase must be configured before the stores touch Auth/Firestore.
        FirebaseApp.configure()
        _session = State(initialValue: SessionStore())
        _store = State(initialValue: DataStore())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(store)
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session
    @Environment(DataStore.self) private var store

    var body: some View {
        Group {
            switch session.state {
            case .loading:
                ProgressView()
            case .signedOut:
                SignInView()
            case .notPartner(let email):
                NotPartnerView(email: email)
            case .needsName:
                SetNameView()
            case .signedIn(let me):
                MainTabView()
                    .task(id: me.id) { store.start(me: me) }
            }
        }
        .onChange(of: session.isSignedIn) { _, signedIn in
            if !signedIn { store.stop() }
        }
    }
}
