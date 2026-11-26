import Foundation

/// Live sync settings. Normally built into the app from Config/Local.xcconfig (see Config/Shared.xcconfig),
/// so partners only sign in with email and password. Without them, partners can enter the values under
/// Live sync settings (Supabase dashboard -> Project Settings -> API). The anon key is safe to ship in the app:
/// the database's row-level security decides what each signed-in partner can see.
enum AppConfig {
    private static func info(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
    static var defaultSupabaseURL: String { let h = info("LedgerSupabaseHost"); return h.isEmpty ? "" : "https://\(h)" }
    static var defaultSupabaseAnonKey: String { info("LedgerSupabaseAnonKey") }
    /// True when this build carries the settings, so nobody needs to see the URL and key screen.
    static var isBuiltIn: Bool { !defaultSupabaseURL.isEmpty && !defaultSupabaseAnonKey.isEmpty }

    /// A value typed in the app wins; a blank one falls back to the built-in value.
    private static func stored(_ key: String) -> String? {
        UserDefaults.standard.string(forKey: key).flatMap { $0.isEmpty ? nil : $0 }
    }
    static var supabaseURL: String {
        get { stored("supabaseURL") ?? defaultSupabaseURL }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "supabaseURL") }
    }
    static var supabaseAnonKey: String {
        get { stored("supabaseAnonKey") ?? defaultSupabaseAnonKey }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "supabaseAnonKey") }
    }
    static var isLiveConfigured: Bool { URL(string: supabaseURL)?.host != nil && !supabaseAnonKey.isEmpty }

    static var lastMode: String? {
        get { UserDefaults.standard.string(forKey: "lastMode") }
        set { UserDefaults.standard.set(newValue, forKey: "lastMode") }
    }
    static var lastWorkspace: UUID? {
        get { UserDefaults.standard.string(forKey: "lastWorkspace").flatMap(UUID.init) }
        set { UserDefaults.standard.set(newValue?.uuidString, forKey: "lastWorkspace") }
    }
}
