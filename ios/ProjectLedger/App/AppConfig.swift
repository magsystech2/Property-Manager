import Foundation

/// Live sync settings. Either fill these in before building the app for your partners
/// (Supabase dashboard -> Project Settings -> API), or enter them in the app under
/// Partners -> Settings -> Live sync. The anon key is safe to ship in the app: the
/// database's row-level security decides what each signed-in partner can see.
enum AppConfig {
    static let defaultSupabaseURL = ""       // e.g. "https://abcdefgh.supabase.co"
    static let defaultSupabaseAnonKey = ""   // the "anon public" key

    static var supabaseURL: String {
        get { UserDefaults.standard.string(forKey: "supabaseURL") ?? defaultSupabaseURL }
        set { UserDefaults.standard.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "supabaseURL") }
    }
    static var supabaseAnonKey: String {
        get { UserDefaults.standard.string(forKey: "supabaseAnonKey") ?? defaultSupabaseAnonKey }
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
