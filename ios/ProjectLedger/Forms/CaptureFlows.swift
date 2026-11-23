import SwiftUI
import LedgerCore

/// Scan Receipt: camera (edge detection) / photo / PDF → on-device text reading → review → post.
struct ScanFlow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    enum Stage { case capture, reading, review(TransactionDraft, String) }
    @State private var stage: Stage = .capture

    var body: some View {
        NavigationStack {
            switch stage {
            case .capture:
                VStack(alignment: .leading, spacing: 20) {
                    Text("Scan a receipt or invoice").font(.title2.bold())
                    Text("The phone reads the vendor, date, invoice number and total. Nothing is posted until you check it.")
                        .foregroundStyle(.secondary)
                    Spacer()
                    CaptureButtons(scanTitle: "Scan with camera") { files in read(files) }
                    Button {
                        app.sheet = nil
                        Task { try? await Task.sleep(for: .milliseconds(450)); app.sheet = .transaction(TransactionDraft()) }
                    } label: {
                        Label("Type it instead", systemImage: "keyboard").frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .font(.headline)
                }
                .padding()
                .navigationTitle("Scan Receipt")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            case .reading:
                VStack(spacing: 16) {
                    ProgressView().controlSize(.large)
                    Text("Reading the document…").font(.headline)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .review(let draft, let text):
                TransactionForm(draft: draft, readFromDocument: true, recognizedText: text)
            }
        }
        .interactiveDismissDisabled(isReviewing)
    }

    var isReviewing: Bool { if case .review = stage { true } else { false } }

    func read(_ files: [PickedFile]) {
        stage = .reading
        Task {
            var texts: [String] = []
            for f in files {
                if f.mimeType == "application/pdf" { texts.append(await TextRecognizer.text(inPDF: f.data)) }
                else if let img = f.image ?? UIImage(data: f.data) { texts.append(await TextRecognizer.text(in: img)) }
            }
            let text = texts.joined(separator: "\n")
            var d = TransactionDraft()
            d.source = "scan"
            d.files = files.compactMap { app.storeFile($0.data, filename: $0.filename, mimeType: $0.mimeType) }
            let s = ReceiptTextParser.parse(text, vendors: app.ledger.s.vendors)
            d.apply(s, vendors: app.ledger.s.vendors, me: app.me)
            let lower = text.lowercased()
            if lower.contains("amount due") || lower.contains("balance due") || lower.contains("due date") || lower.contains("invoice") && !lower.contains("paid") {
                d.kind = .bill
                d.payer = .llc
            }
            if let vid = d.vendorId { d.projectId = lastProject(for: vid) }
            stage = .review(d, text)
        }
    }

    /// The project this vendor was last used on, as a starting guess.
    func lastProject(for vendor: UUID) -> UUID? {
        app.ledger.entries().first { $0.vendorId == vendor && $0.projectId != nil && (app.ledger.project($0.projectId)?.isActive ?? false) }?.projectId
    }
}

/// Say It: speak the expense ("Paid 350 at Home Depot for Oak Street materials with my card").
struct VoiceFlow: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var speech = SpeechRecognizer()
    @State private var text = ""
    @State private var reading = false
    @State private var draft: TransactionDraft?

    var body: some View {
        NavigationStack {
            if let draft {
                TransactionForm(draft: draft)
            } else {
                VStack(spacing: 20) {
                    Text("Say what you spent").font(.title2.bold())
                    Text("For example: “Paid $350 at Home Depot for Oak Street materials with my card.”")
                        .multilineTextAlignment(.center).foregroundStyle(.secondary)
                    Button {
                        if speech.isRecording { speech.stop() } else { Task { await speech.start() } }
                    } label: {
                        Image(systemName: speech.isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 44, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 120, height: 120)
                            .background(speech.isRecording ? Color.red : Color.accentColor, in: Circle())
                    }
                    .accessibilityLabel(speech.isRecording ? "Stop recording" : "Start recording")
                    Text(speech.isRecording ? "Listening… tap to stop" : "Tap to talk").font(.headline)
                    if let e = speech.error { Text(e).font(.callout).foregroundStyle(.red) }
                    TextField("Or type it here", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                        .padding(12)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    Spacer()
                    Button { use() } label: {
                        HStack { if reading { ProgressView() }; Text("Fill in the details") }
                            .frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(.borderedProminent)
                    .font(.headline)
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || reading)
                }
                .padding()
                .navigationTitle("Say It")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { speech.stop(); dismiss() } } }
                .onChange(of: speech.transcript) { _, t in if !t.isEmpty { text = t } }
                .onDisappear { speech.stop() }
            }
        }
    }

    func use() {
        speech.stop()
        reading = true
        Task {
            let s = await app.readVoice(text)
            var d = TransactionDraft()
            d.source = "voice"
            d.transcript = text
            d.apply(s, vendors: app.ledger.s.vendors, me: app.me)
            let lower = text.lowercased()
            if lower.contains("bill") || lower.contains("invoice") || lower.contains("owe") { d.kind = .bill; d.payer = .llc }
            if d.description.isEmpty { d.description = text }
            reading = false
            draft = d
        }
    }
}
