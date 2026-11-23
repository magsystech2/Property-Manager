import SwiftUI

enum AddMode: String, Identifiable { case photo, voice, manual; var id: String { rawValue } }

struct MainTabView: View {
    @State private var addMode: AddMode?

    var body: some View {
        TabView {
            FeedView(addMode: $addMode)
                .tabItem { Label("Spending", systemImage: "list.bullet.rectangle") }
            PropertiesView()
                .tabItem { Label("Properties", systemImage: "house") }
            PartnersView()
                .tabItem { Label("Partners", systemImage: "person.3") }
            InvoicesView()
                .tabItem { Label("Invoices", systemImage: "doc.plaintext") }
        }
        .sheet(item: $addMode) { mode in
            AddExpenseFlow(mode: mode)
        }
    }
}

/// The three big "add" buttons shown at the top of the spending feed.
struct QuickAddBar: View {
    @Binding var addMode: AddMode?
    var body: some View {
        HStack(spacing: 12) {
            button("Snap receipt", "camera.fill", .photo)
            button("Say it", "mic.fill", .voice)
            button("Type it", "square.and.pencil", .manual)
        }
    }
    private func button(_ title: String, _ icon: String, _ mode: AddMode) -> some View {
        Button { addMode = mode } label: {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.title2)
                Text(title).font(.caption.weight(.semibold))
            }
            .frame(maxWidth: .infinity).padding(.vertical, 14)
            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}
