import SwiftUI
import PhotosUI

/// Snap a receipt / say it / type it, then confirm the pre-filled form and save.
struct AddExpenseFlow: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let mode: AddMode

    enum Stage { case capture, reading, form }
    @State private var stage: Stage = .capture
    @State private var expense = Expense()
    @State private var receiptImage: UIImage?
    @State private var notice: String?
    @State private var speech = SpeechRecognizer()
    @State private var showCamera = false
    @State private var libraryItem: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            Group {
                switch stage {
                case .capture: capture
                case .reading:
                    VStack(spacing: 16) {
                        ProgressView().controlSize(.large)
                        Text(mode == .photo ? "Reading the receipt…" : "Filling in the expense…").foregroundStyle(.secondary)
                    }
                case .form:
                    ExpenseForm(expense: $expense, receiptImage: receiptImage, notice: notice)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { speech.stop(); dismiss() } }
                if stage == .form {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { save() }.disabled(expense.amount <= 0 || expense.propertyId == nil)
                    }
                }
            }
        }
        .interactiveDismissDisabled(stage != .capture)
        .onAppear {
            if mode == .manual { stage = .form }
            if mode == .photo && UIImagePickerController.isSourceTypeAvailable(.camera) { showCamera = true }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in
                showCamera = false
                if let image { Task { await read(image: image) } }
            }
            .ignoresSafeArea()
        }
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    await read(image: img)
                }
            }
        }
    }

    private var title: String {
        switch mode { case .photo: "Snap receipt"; case .voice: "Say it"; case .manual: "New expense" }
    }

    @ViewBuilder private var capture: some View {
        if mode == .photo {
            VStack(spacing: 20) {
                Image(systemName: "doc.viewfinder").font(.system(size: 64)).foregroundStyle(.tint)
                Text("Take a photo of the bill or receipt").font(.headline)
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { showCamera = true } label: { Label("Open camera", systemImage: "camera.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                }
                PhotosPicker(selection: $libraryItem, matching: .images) {
                    Label("Choose from photos", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered).controlSize(.large)
                Button("Enter by hand instead") { stage = .form }
            }
            .padding(24)
        } else {
            VoiceCaptureView(speech: speech) { transcript in Task { await read(transcript: transcript) } }
        }
    }

    private var propertyNames: [String] { store.properties.map(\.name) }

    private func read(image: UIImage) async {
        receiptImage = image
        stage = .reading
        do {
            let path = try await AIService.uploadReceipt(image)
            expense.receiptPath = path
            expense.source = "photo"
            let parsed = try await AIService.readReceipt(path: path, propertyNames: propertyNames)
            apply(parsed)
            notice = "Filled in from the photo. Please check it before saving."
        } catch {
            notice = "Couldn't read the receipt automatically (\(error.localizedDescription)). The photo is attached; fill in the rest."
        }
        stage = .form
    }

    private func read(transcript: String) async {
        stage = .reading
        expense.source = "voice"
        expense.notes = "Said: \"\(transcript)\""
        do {
            apply(try await AIService.readVoice(transcript: transcript, propertyNames: propertyNames))
            notice = "Filled in from what you said. Please check it before saving."
        } catch {
            notice = "Couldn't understand that automatically. Fill in the details below."
        }
        stage = .form
    }

    private func apply(_ p: ParsedExpense) {
        if let v = p.vendor { expense.vendor = v }
        if let d = AIService.parseDate(p.date) { expense.date = d }
        if let a = p.amount { expense.amount = a }
        if let c = p.category, Categories.all.contains(c) { expense.category = c }
        if let d = p.description { expense.description = d }
        if let i = p.invoiceNumber { expense.invoiceNumber = i }
        if let name = p.propertyName { expense.propertyId = store.properties.first { $0.name == name }?.id }
        if let m = p.paymentMethod, PaymentMethods.all.contains(m) { expense.paymentMethod = m }
        if let llc = p.paidFromLLC { expense.paidFromLLC = llc }
        if let s = p.status, ["Paid", "Unpaid"].contains(s) { expense.status = s }
        if expense.propertyId == nil, store.properties.count == 1 { expense.propertyId = store.properties[0].id }
    }

    private func save() {
        do { try store.save(expense); dismiss() }
        catch { notice = error.localizedDescription }
    }
}

struct VoiceCaptureView: View {
    @Bindable var speech: SpeechRecognizer
    let onDone: (String) -> Void

    var body: some View {
        VStack(spacing: 24) {
            Text("Say something like:\n“Spent 1,280 at Home Depot on drywall for Oak Street, paid with my card.”")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            ScrollView {
                Text(speech.transcript.isEmpty ? (speech.isRecording ? "Listening…" : "") : speech.transcript)
                    .font(.title3).frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 200).padding().background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
            if let e = speech.error { Text(e).foregroundStyle(.red) }
            Button {
                if speech.isRecording { speech.stop() } else { Task { await speech.start() } }
            } label: {
                Image(systemName: speech.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                    .font(.system(size: 88)).symbolEffect(.pulse, isActive: speech.isRecording)
            }
            .foregroundStyle(speech.isRecording ? .red : .accentColor)
            Text(speech.isRecording ? "Tap to stop" : "Tap to talk").font(.caption).foregroundStyle(.secondary)
            Button("Use this") { speech.stop(); onDone(speech.transcript) }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(speech.transcript.trimmingCharacters(in: .whitespaces).isEmpty || speech.isRecording)
        }
        .padding(24)
        .task { await speech.start() }
    }
}

/// The editable expense fields, shared by add and edit.
struct ExpenseForm: View {
    @Environment(DataStore.self) private var store
    @Binding var expense: Expense
    var receiptImage: UIImage?
    var notice: String?

    var body: some View {
        Form {
            if let notice { Section { Label(notice, systemImage: "sparkles").font(.callout) } }
            if let receiptImage {
                Section { Image(uiImage: receiptImage).resizable().scaledToFit().frame(maxHeight: 220) }
            }
            Section {
                HStack {
                    Text("Amount")
                    TextField("0.00", value: $expense.amount, format: .number.precision(.fractionLength(2)))
                        .keyboardType(.decimalPad).multilineTextAlignment(.trailing).font(.title3.bold())
                }
                Picker("Property", selection: $expense.propertyId) {
                    Text("Choose…").tag(String?.none)
                    ForEach(store.properties) { Text($0.name).tag($0.id) }
                }
                Picker("Category", selection: $expense.category) {
                    ForEach(Categories.all, id: \.self) { Label($0, systemImage: Categories.icon($0)).tag($0) }
                }
                TextField("Vendor / paid to", text: $expense.vendor)
                TextField("What was it for?", text: $expense.description)
                DatePicker("Date", selection: $expense.date, displayedComponents: .date)
            }
            Section("Payment") {
                Picker("Paid from", selection: $expense.paidFromLLC) {
                    Text("My own money").tag(false)
                    Text("LLC account").tag(true)
                }
                .pickerStyle(.segmented)
                Picker("Method", selection: $expense.paymentMethod) {
                    ForEach(PaymentMethods.all, id: \.self) { Text($0).tag($0) }
                }
                Picker("Status", selection: $expense.status) {
                    Text("Paid").tag("Paid"); Text("Unpaid bill").tag("Unpaid")
                }
                TextField("Invoice # (links to contractor invoices)", text: $expense.invoiceNumber)
            }
            Section("Notes") {
                TextField("Notes", text: $expense.notes, axis: .vertical).lineLimit(2...5)
            }
            if store.properties.isEmpty {
                Section { Text("Add a property on the Properties tab first.").foregroundStyle(.orange) }
            }
        }
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void
        init(onFinish: @escaping (UIImage?) -> Void) { self.onFinish = onFinish }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
    }
}
