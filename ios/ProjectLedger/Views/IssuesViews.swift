import SwiftUI
import PhotosUI
import QuickLook
import LedgerCore

// Issue reports (migration 08): any partner flags a problem with a record or the app, with a note and an optional
// screenshot. Reports collect in one shared list until someone marks them resolved. They never change money.
// Same behavior as the web app's Report form and Issues page.

/// Report a problem with a record or the app. Opened from a record, an error alert, Home or the Issues screen.
struct ReportForm: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let ref: EntryRef?
    let error: String?
    let page: String
    @State private var category: IssueCategory
    @State private var note = ""
    @State private var includeError: Bool
    @State private var photoItem: PhotosPickerItem?
    @State private var screenshot: Data?
    @State private var busy = false

    init(ref: EntryRef?, error: String?, page: String) {
        self.ref = ref; self.error = error; self.page = page
        _category = State(initialValue: error != nil ? .appError : ref != nil ? .wrongAmount : .other)
        _includeError = State(initialValue: error != nil)
    }

    var body: some View {
        let entry = ref.flatMap { app.ledger.entry($0) }
        FormShell(title: "Report an issue", saveTitle: "Send report", canSave: !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  busy: busy, onSave: save) {
            if let entry {
                Section("About this \(entry.ref.kind.label.lowercased())") {
                    LabeledContent(entry.title) { MoneyText(cents: entry.amountCents) }
                }
            }
            Section {
                Picker("What kind of problem?", selection: $category) {
                    ForEach(IssueCategory.reportable, id: \.self) { Text($0.label).tag($0) }
                }
                TextField(entry != nil ? "What's wrong? e.g. Should be $412.50, not $4,125.00" : "What's wrong? e.g. Tried to void a receipt and got an error",
                          text: $note, axis: .vertical)
                    .frame(minHeight: 80, alignment: .top)
                if let error {
                    Toggle(isOn: $includeError) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Include the error the app showed")
                            Text("“\(error)”").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } footer: {
                Text("Required: say what's wrong.")
            }
            Section("Screenshot (optional)") {
                if let screenshot, let img = UIImage(data: screenshot) {
                    Image(uiImage: img).resizable().scaledToFit().frame(maxHeight: 240).clipShape(RoundedRectangle(cornerRadius: 8))
                    Button("Remove screenshot", role: .destructive) { self.screenshot = nil }
                } else {
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label("Choose a screenshot", systemImage: "photo.on.rectangle").frame(minHeight: 44)
                    }
                }
            }
            Section {
            } footer: {
                Text("Reports go to the shared Issues list for all partners. They never change any amounts. The screen you were on and your device are added to help whoever fixes it.")
            }
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    let jpeg = img.jpegData(compressionQuality: 0.8)
                    if let jpeg, jpeg.count > 20 * 1024 * 1024 { app.errorMessage = "That screenshot is larger than 20 MB." } else { screenshot = jpeg }
                }
                photoItem = nil
            }
        }
    }

    func save() {
        busy = true
        Task {
            if await app.reportIssue(category: category, note: note, ref: ref, error: includeError ? error : nil, page: page, screenshot: screenshot) {
                dismiss()
            }
            busy = false
        }
    }
}

/// Plain-text list of open reports, to paste into a message when fixing them in one go.
private func summaryText(_ list: [IssueReport], _ l: Ledger) -> String {
    let lines = list.enumerated().map { i, r -> String in
        let entry = r.ref.flatMap { l.entry($0) }
        let about = entry.map { "\($0.ref.kind.label) \"\($0.title)\" \(Money.format($0.amountCents)) (\($0.ref.kind.rawValue)/\($0.ref.id.uuidString.lowercased()))" }
            ?? r.ref.map { "\($0.kind.rawValue)/\($0.id.uuidString.lowercased())" } ?? "App"
        return [
            "\(i + 1). [\(IssueCategory.label(r.category))] \(r.note)",
            "   About: \(about)",
            "   Reported by \(l.payerName(r.createdBy)) on \(issueDay(r.createdAt))\(r.page.isEmpty ? "" : ", screen \(r.page)")",
            r.errorText.isEmpty ? "" : "   Error shown: \(r.errorText)",
            r.screenshotPath == nil ? "" : "   Screenshot attached in the app",
        ].filter { !$0.isEmpty }.joined(separator: "\n")
    }
    return "Open issues (\(list.count))\n\n" + lines.joined(separator: "\n\n")
}

private func issueDay(_ iso: String?) -> String { iso.map { Days.display(String($0.prefix(10))) } ?? "" }

struct IssuesView: View {
    @Environment(AppModel.self) private var app
    @State private var tab = 0

    var body: some View {
        let l = app.ledger
        let all = l.s.issueReports.filter { !$0.isReviewFlag }   // review flags have their own screen
        let open = all.filter(\.isOpen).sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        let resolved = all.filter { !$0.isOpen }.sorted { ($0.resolvedAt ?? "") > ($1.resolvedAt ?? "") }
        // Reports about the same record sit together, so a record flagged twice is fixed once.
        let groups: [(key: String, ref: EntryRef?, items: [IssueReport])] = open.reduce(into: []) { acc, r in
            let key = r.ref.map { "\($0.kind.rawValue):\($0.id)" } ?? "app:\(r.id)"
            if let i = acc.firstIndex(where: { $0.key == key }) { acc[i].items.append(r) } else { acc.append((key, r.ref, [r])) }
        }
        let byCategory = Dictionary(grouping: open, by: \.category).map { ($0.key, $0.value.count) }.sorted { $0.1 > $1.1 }

        List {
            if !open.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(open.count) open" + (groups.count != open.count ? " · \(groups.count) \(groups.count == 1 ? "thing" : "things") to fix" : "")).font(.headline)
                        Text(byCategory.map { "\(IssueCategory.label($0.0)) \($0.1)" }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    }
                    Button {
                        UIPasteboard.general.string = summaryText(open, l)
                        app.toast = "Open issues copied"
                    } label: { Label("Copy all open", systemImage: "doc.on.doc").frame(minHeight: 44) }
                } footer: {
                    Text("Copies a plain-text list of every open issue, to paste into a message.")
                }
            }
            Section {
                Picker("Show", selection: $tab) {
                    Text("Open (\(open.count))").tag(0)
                    Text("Resolved (\(resolved.count))").tag(1)
                }
                .pickerStyle(.segmented)
            }
            if tab == 0 {
                if groups.isEmpty {
                    Section { Text("No open issues. Nice.").foregroundStyle(.secondary) }
                }
                ForEach(groups, id: \.key) { g in
                    Section {
                        ForEach(g.items) { IssueRow(report: $0) }
                    } header: {
                        IssueGroupHeader(ref: g.ref, count: g.items.count)
                    }
                }
            } else {
                Section {
                    if resolved.isEmpty { Text("Nothing resolved yet.").foregroundStyle(.secondary) }
                    ForEach(resolved) { IssueRow(report: $0, showRecord: true) }
                }
            }
        }
        .navigationTitle("Issues")
        .refreshable { await app.reload() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { app.sheet = .report(ref: nil, error: nil, page: "Issues") } label: { Label("Report an issue", systemImage: "exclamationmark.bubble") }
            }
        }
    }
}

private struct IssueGroupHeader: View {
    @Environment(AppModel.self) private var app
    let ref: EntryRef?
    let count: Int
    var body: some View {
        HStack {
            if let ref, let e = app.ledger.entry(ref) {
                NavigationLink(value: ref) { Text("\(ref.kind.label): \(e.title) · \(Money.format(e.amountCents))") }
            } else if let ref {
                Text("\(ref.kind.label) (not found)")
            } else {
                Text("App")
            }
            if count > 1 { Text("\(count) reports").font(.caption.weight(.semibold)).padding(.horizontal, 6).background(.orange.opacity(0.2), in: Capsule()) }
        }
    }
}

struct IssueRow: View {
    @Environment(AppModel.self) private var app
    let report: IssueReport
    var showRecord = false
    @State private var resolving = false
    @State private var resolution = ""
    @State private var opening = false
    @State private var previewURL: URL?

    var body: some View {
        let l = app.ledger
        let r = report
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: r.isOpen ? "exclamationmark.bubble" : "checkmark.circle").foregroundStyle(r.isOpen ? .orange : .green)
                VStack(alignment: .leading, spacing: 4) {
                    Text(IssueCategory.label(r.category)).font(.caption.weight(.semibold)).padding(.horizontal, 6).background(.quaternary, in: Capsule())
                    Text(r.note)
                }
            }
            Text("\(l.payerName(r.createdBy)) · \(issueDay(r.createdAt))\(r.page.isEmpty ? "" : " · on \(r.page)")")
                .font(.caption).foregroundStyle(.secondary)
            if showRecord, let ref = r.ref, let e = l.entry(ref) {
                NavigationLink(value: ref) { Text(e.title).font(.caption) }
            }
            if !r.errorText.isEmpty { Text("Error shown: \(r.errorText)").font(.caption).foregroundStyle(.red) }
            if !r.isOpen {
                Text("Resolved by \(l.payerName(r.resolvedBy)) · \(issueDay(r.resolvedAt))\(r.resolution.map { ": \($0)" } ?? "")")
                    .font(.caption).foregroundStyle(.green)
            }
            HStack {
                if r.screenshotPath != nil {
                    Button(opening ? "Opening…" : "Screenshot") { Task { await openShot() } }.disabled(opening)
                }
                Spacer()
                if r.isOpen {
                    Button("Resolve") { resolving.toggle() }.bold()
                } else {
                    Button("Reopen") { Task { await app.setIssue(r, resolved: false) } }
                }
            }
            .buttonStyle(.borderless)
            if resolving {
                TextField("What was done? e.g. Voided and re-entered at $412.50", text: $resolution, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Button("Mark resolved") {
                    Task { if await app.setIssue(r, resolved: true, resolution: resolution) { resolving = false } }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(.vertical, 4)
        .quickLookPreview($previewURL)
    }

    func openShot() async {
        guard let path = report.screenshotPath else { return }
        opening = true
        defer { opening = false }
        guard let url = await app.fileURL(path: path) else {
            app.errorMessage = app.isDemo ? "Demo mode keeps screenshots only until the app restarts." : "Couldn't open the screenshot. Check your connection."
            return
        }
        if url.isFileURL { previewURL = url; return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(report.id.uuidString)-\(report.screenshotName ?? "screenshot.jpg")")
            try data.write(to: file, options: .atomic)
            previewURL = file
        } catch {
            app.errorMessage = "Couldn't download the screenshot: \(error.localizedDescription)"
        }
    }
}
