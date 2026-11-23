import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import QuickLook
import LedgerCore

/// A captured or imported file ready to store.
struct PickedFile {
    var data: Data
    var filename: String
    var mimeType: String
    var image: UIImage?
}

enum FileMaker {
    static func jpeg(_ image: UIImage, name: String) -> PickedFile? {
        let small = image.resized(maxSide: 2200)
        guard let data = small.jpegData(compressionQuality: 0.7) else { return nil }
        return PickedFile(data: data, filename: name, mimeType: "image/jpeg", image: small)
    }
    static func stamp() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"
        return f.string(from: Date())
    }
}

/// Three big ways to add a document: scan with the camera, pick a photo, import a PDF.
struct CaptureButtons: View {
    var scanTitle = "Scan with camera"
    let onFiles: ([PickedFile]) -> Void
    @State private var scanning = false
    @State private var photoItem: PhotosPickerItem?
    @State private var importing = false

    var body: some View {
        VStack(spacing: 12) {
            if DocumentScanner.isAvailable {
                Button { scanning = true } label: {
                    Label(scanTitle, systemImage: "doc.viewfinder").frame(maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(.borderedProminent)
            }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Choose a photo", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.bordered)
            Button { importing = true } label: {
                Label("Import a PDF or file", systemImage: "doc.badge.plus").frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(.bordered)
        }
        .font(.headline)
        .fullScreenCover(isPresented: $scanning) {
            DocumentScanner { images in
                scanning = false
                let stamp = FileMaker.stamp()
                let files = images.enumerated().compactMap { i, img in
                    FileMaker.jpeg(img, name: "scan-\(stamp)\(images.count > 1 ? "-p\(i + 1)" : "").jpg")
                }
                if !files.isEmpty { onFiles(files) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data),
                   let f = FileMaker.jpeg(img, name: "photo-\(FileMaker.stamp()).jpg") {
                    onFiles([f])
                }
                photoItem = nil
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            let type = UTType(filenameExtension: url.pathExtension)
            let mime = type?.preferredMIMEType ?? (url.pathExtension.lowercased() == "pdf" ? "application/pdf" : "application/octet-stream")
            onFiles([PickedFile(data: data, filename: url.lastPathComponent, mimeType: mime, image: UIImage(data: data))])
        }
    }
}

/// Attach a receipt or payment confirmation to an existing record. Totals don't change.
struct AttachSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let target: AppModel.AttachTarget

    init(ref: EntryRef) { target = .record(ref) }
    init(target: AppModel.AttachTarget) { self.target = target }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                switch target {
                case .record(let ref):
                    if let e = app.ledger.entry(ref) {
                        EntryRow(entry: e)
                            .padding().background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                    }
                    Text("The document is added to this record for everyone. Amounts and balances stay the same.")
                        .font(.callout).foregroundStyle(.secondary)
                case .project(let id):
                    Text("Filed on \(app.ledger.project(id)?.nickname ?? "this project") for everyone: permits, plans, closing papers and other documents that aren't a single transaction. Totals don't change.")
                        .font(.callout).foregroundStyle(.secondary)
                case .vendor(let id):
                    Text("Filed on \(app.ledger.vendor(id)?.name ?? "this vendor") for everyone: contracts, W-9s, licenses and insurance certificates. Totals don't change.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                CaptureButtons(scanTitle: "Scan document") { files in
                    Task {
                        for f in files { await app.attach(f.data, filename: f.filename, mimeType: f.mimeType, target: target) }
                    }
                    dismiss()
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Attach document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

/// One stored document; tap to preview.
struct AttachmentRow: View {
    @Environment(AppModel.self) private var app
    let attachment: Attachment
    var showRecord = false
    @State private var previewURL: URL?
    @State private var loading = false

    var body: some View {
        Button {
            Task { await open() }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: attachment.isImage ? "photo" : attachment.mimeType == "application/pdf" ? "doc.richtext" : "doc")
                    .font(.title3).frame(width: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(attachment.filename).lineLimit(1)
                    Text([app.ledger.payerName(attachment.uploadedBy).replacingOccurrences(of: "LLC account", with: "Unknown"),
                          attachment.createdAt.map { Days.display(String($0.prefix(10))) },
                          ByteCountFormatter.string(fromByteCount: Int64(attachment.sizeBytes), countStyle: .file)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                    if showRecord, let e = recordEntry { Text("\(e.ref.kind.label): \(e.title)").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if loading { ProgressView() }
            }
            .frame(minHeight: 44)
        }
        .quickLookPreview($previewURL)
    }

    var recordEntry: Entry? {
        let a = attachment
        let ref: EntryRef? = a.expenseId.map { EntryRef(.expense, $0) } ?? a.billId.map { EntryRef(.bill, $0) }
            ?? a.billPaymentId.map { EntryRef(.payment, $0) } ?? a.reimbursementId.map { EntryRef(.reimbursement, $0) }
            ?? a.contributionId.map { EntryRef(.contribution, $0) } ?? a.commitmentId.map { EntryRef(.commitment, $0) }
        return ref.flatMap { app.ledger.entry($0) }
    }

    /// Downloads to a temporary file named like the original, so Quick Look shows it properly.
    func open() async {
        loading = true
        defer { loading = false }
        guard let url = await app.fileURL(attachment) else {
            app.errorMessage = app.isDemo ? "This sample record has no real file in demo mode. Attach one to try it." : "Couldn't open this document. Check your connection."
            return
        }
        if url.isFileURL { previewURL = url; return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent(attachment.id.uuidString, isDirectory: true)
            try? FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
            let file = dest.appendingPathComponent(attachment.filename)
            try data.write(to: file, options: .atomic)
            previewURL = file
        } catch {
            app.errorMessage = "Couldn't download this document: \(error.localizedDescription)"
        }
    }
}

/// A file on this phone that hasn't uploaded yet.
struct PendingFileRow: View {
    let file: LocalFile
    let message: String?
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "icloud.and.arrow.up").font(.title3).frame(width: 36).foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.filename).lineLimit(1)
                Text(message ?? "Waiting to sync").font(.caption.weight(.semibold)).foregroundStyle(.blue)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}
