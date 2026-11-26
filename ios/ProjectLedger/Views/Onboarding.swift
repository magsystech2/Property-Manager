import SwiftUI
import LedgerCore

struct WelcomeView: View {
    @Environment(AppModel.self) private var app
    @State private var showLiveSetup = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "building.2.crop.circle.fill")
                        .font(.system(size: 72)).foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                    Text("Project Ledger").font(.largeTitle.bold())
                    Text("Track every receipt, bill and payment across your properties, and see who paid what and what the LLC owes each partner.")
                        .font(.title3).foregroundStyle(.secondary)

                    Button {
                        app.chooseLive()
                        if !AppConfig.isLiveConfigured { showLiveSetup = true }
                    } label: {
                        Label("Sign in to our LLC", systemImage: "person.badge.key.fill")
                            .frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(.borderedProminent)
                    .font(.headline)

                    Button { app.startDemo() } label: {
                        VStack(spacing: 2) {
                            Label("Try the demo", systemImage: "theatermasks.fill")
                            Text("Sample data on this phone only. Nothing is shared.").font(.caption)
                        }
                        .frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(.bordered)
                    .font(.headline)

                    if !AppConfig.isBuiltIn {
                        Button("Live sync settings") { showLiveSetup = true }
                            .frame(minHeight: 44)
                    }
                }
                .padding(24)
            }
            .sheet(isPresented: $showLiveSetup) { LiveSetupView { app.chooseLive() } }
        }
    }
}

/// Supabase URL and anon key, if they weren't built into the app.
struct LiveSetupView: View {
    @Environment(\.dismiss) private var dismiss
    var onSave: () -> Void = {}
    @State private var url = AppConfig.supabaseURL
    @State private var key = AppConfig.supabaseAnonKey

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://yourproject.supabase.co", text: $url)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("anon public key", text: $key, axis: .vertical)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().lineLimit(2...5)
                        .font(.footnote.monospaced())
                } header: {
                    Text("Supabase project")
                } footer: {
                    Text("Find these in Supabase under Project Settings → API. All three partners use the same project. The key is safe to share: the database only shows each signed-in partner their own LLC's records.")
                }
            }
            .navigationTitle("Live sync")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        AppConfig.supabaseURL = url
                        AppConfig.supabaseAnonKey = key
                        dismiss()
                        if AppConfig.isLiveConfigured { onSave() }
                    }
                    .disabled(URL(string: url.trimmingCharacters(in: .whitespaces))?.host == nil || key.isEmpty)
                }
            }
        }
    }
}

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var email = ""
    @State private var password = ""
    @State private var creating = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress).textContentType(.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .frame(minHeight: 44)
                    SecureField("Password", text: $password)
                        .textContentType(creating ? .newPassword : .password)
                        .frame(minHeight: 44)
                } footer: {
                    Text(creating ? "Use the email your LLC owner invited. Passwords need at least 6 characters." :
                            "Each partner signs in with their own account, so every record shows who entered and who paid it.")
                }
                Section {
                    Button {
                        busy = true
                        Task { await app.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password, create: creating); busy = false }
                    } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text(creating ? "Create account" : "Sign in").bold() }; Spacer() }
                            .frame(minHeight: 44)
                    }
                    .disabled(busy || email.isEmpty || password.count < 6)
                    Button(creating ? "I already have an account" : "New here? Create an account") { creating.toggle() }
                        .frame(minHeight: 44)
                }
                Section {
                    Button("Back") { app.phase = .welcome }.frame(minHeight: 44)
                }
            }
            .navigationTitle(creating ? "Create account" : "Sign in")
        }
    }
}

struct ChooseWorkspaceView: View {
    @Environment(AppModel.self) private var app
    @State private var displayName = ""
    @State private var llcName = ""

    var body: some View {
        NavigationStack {
            Form {
                if !app.workspaces.isEmpty {
                    Section("Your LLCs") {
                        ForEach(app.workspaces) { w in
                            Button { Task { await app.open(workspace: w.id) } } label: {
                                Label(w.name, systemImage: "building.2").frame(minHeight: 44)
                            }
                        }
                    }
                }
                Section {
                    TextField("Your name (shown to partners)", text: $displayName).frame(minHeight: 44)
                }
                Section {
                    Button("Join my invitation") { Task { await app.joinInvites(displayName: displayName) } }
                        .disabled(displayName.isEmpty)
                        .frame(minHeight: 44)
                } header: {
                    Text("Invited by a partner?")
                } footer: {
                    Text("The owner adds your email under Partners → Settings → Invite. Then tap Join.")
                }
                Section {
                    TextField("LLC name", text: $llcName).frame(minHeight: 44)
                    Button("Create LLC workspace") { Task { await app.createWorkspace(name: llcName, displayName: displayName) } }
                        .disabled(displayName.isEmpty || llcName.isEmpty)
                        .frame(minHeight: 44)
                } header: {
                    Text("Setting it up for the first time?")
                } footer: {
                    Text("You become the owner and can invite the other partners. Default budget categories are added for you.")
                }
                Section { Button("Sign out", role: .destructive) { Task { await app.signOut() } } }
            }
            .navigationTitle("Choose LLC")
        }
    }
}
