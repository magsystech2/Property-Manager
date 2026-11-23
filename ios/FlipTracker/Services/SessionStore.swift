import Foundation
import Observation
import FirebaseAuth
import FirebaseFirestore

/// Sign-in state. A user must also be listed in Firestore `config/partners.emails`.
@Observable
@MainActor
final class SessionStore {
    enum State: Equatable {
        case loading, signedOut, needsName
        case notPartner(String)
        case signedIn(Member)
    }

    var state: State = .loading
    var errorMessage: String?
    var isSignedIn: Bool { if case .signedIn = state { return true } else { return false } }

    private var handle: AuthStateDidChangeListenerHandle?
    private let db = Firestore.firestore()

    init() {
        handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in await self?.refresh(user: user) }
        }
    }

    func refresh(user: User?) async {
        guard let user, let email = user.email?.lowercased() else { state = .signedOut; return }
        do {
            let config = try await db.document("config/partners").getDocument()
            let emails = (config.get("emails") as? [String] ?? []).map { $0.lowercased() }
            guard emails.contains(email) else { state = .notPartner(email); return }
            let doc = try await db.collection("members").document(user.uid).getDocument()
            if let member = try? doc.data(as: Member.self), !member.name.isEmpty {
                state = .signedIn(member)
            } else {
                state = .needsName
            }
        } catch {
            // Firestore rules reject anyone who isn't a partner.
            state = .notPartner(email)
        }
    }

    func signIn(email: String, password: String) async {
        errorMessage = nil
        do { try await Auth.auth().signIn(withEmail: email.trimmingCharacters(in: .whitespaces), password: password) }
        catch { errorMessage = error.localizedDescription }
    }

    func createAccount(email: String, password: String) async {
        errorMessage = nil
        do { try await Auth.auth().createUser(withEmail: email.trimmingCharacters(in: .whitespaces), password: password) }
        catch { errorMessage = error.localizedDescription }
    }

    func resetPassword(email: String) async {
        errorMessage = nil
        do {
            try await Auth.auth().sendPasswordReset(withEmail: email.trimmingCharacters(in: .whitespaces))
            errorMessage = "Password reset email sent."
        } catch { errorMessage = error.localizedDescription }
    }

    func saveName(_ name: String) async {
        guard let user = Auth.auth().currentUser else { return }
        let member = Member(name: name.trimmingCharacters(in: .whitespaces), email: user.email?.lowercased() ?? "")
        do {
            try db.collection("members").document(user.uid).setData(from: member)
            await refresh(user: user)
        } catch { errorMessage = error.localizedDescription }
    }

    func signOut() {
        try? Auth.auth().signOut()
    }
}
