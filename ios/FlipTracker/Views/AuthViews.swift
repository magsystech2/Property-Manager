import SwiftUI

struct SignInView: View {
    @Environment(SessionStore.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var creating = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 8) {
                        Image(systemName: "house.and.flag.fill").font(.system(size: 48)).foregroundStyle(.tint)
                        Text("Flip Tracker").font(.largeTitle.bold())
                        Text("Shared spending for the partners").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical)
                    .listRowBackground(Color.clear)
                }
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(creating ? .newPassword : .password)
                }
                if let msg = session.errorMessage {
                    Section { Text(msg).foregroundStyle(.red) }
                }
                Section {
                    Button(creating ? "Create account" : "Sign in") {
                        busy = true
                        Task {
                            if creating { await session.createAccount(email: email, password: password) }
                            else { await session.signIn(email: email, password: password) }
                            busy = false
                        }
                    }
                    .disabled(busy || email.isEmpty || password.count < 6)
                    Button(creating ? "I already have an account" : "First time? Create an account") { creating.toggle() }
                    if !creating {
                        Button("Forgot password") { Task { await session.resetPassword(email: email) } }
                            .disabled(email.isEmpty)
                    }
                }
            }
        }
    }
}

struct NotPartnerView: View {
    @Environment(SessionStore.self) private var session
    let email: String
    var body: some View {
        ContentUnavailableView {
            Label("Not on the partner list", systemImage: "person.crop.circle.badge.xmark")
        } description: {
            Text("\(email) isn't one of the LLC partners yet. Ask whoever set up the app to add this email to the partner list in Firebase.")
        } actions: {
            Button("Sign out") { session.signOut() }
        }
    }
}

struct SetNameView: View {
    @Environment(SessionStore.self) private var session
    @State private var name = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("What should your partners see as your name?") {
                    TextField("Your name", text: $name).textContentType(.givenName)
                }
                Button("Continue") { Task { await session.saveName(name) } }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .navigationTitle("Welcome")
        }
    }
}
