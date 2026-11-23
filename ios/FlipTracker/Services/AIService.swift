import Foundation
import UIKit
import FirebaseAuth
import FirebaseFunctions
import FirebaseStorage

/// Uploads receipt photos and asks the backend (Claude) to read them or a spoken sentence.
enum AIService {
    private static let functions = Functions.functions()

    /// Resizes and uploads a photo. Returns its Storage path.
    static func uploadReceipt(_ image: UIImage) async throws -> String {
        guard let uid = Auth.auth().currentUser?.uid else { throw URLError(.userAuthenticationRequired) }
        let resized = image.resized(maxSide: 1600)
        guard let data = resized.jpegData(compressionQuality: 0.75) else { throw URLError(.cannotDecodeContentData) }
        let path = "receipts/\(uid)/\(UUID().uuidString).jpg"
        let meta = StorageMetadata()
        meta.contentType = "image/jpeg"
        _ = try await Storage.storage().reference(withPath: path).putDataAsync(data, metadata: meta)
        return path
    }

    static func readReceipt(path: String, propertyNames: [String]) async throws -> ParsedExpense {
        try await call("parseReceipt", ["storagePath": path, "propertyNames": propertyNames, "today": today()])
    }

    static func readVoice(transcript: String, propertyNames: [String]) async throws -> ParsedExpense {
        try await call("parseVoice", ["transcript": transcript, "propertyNames": propertyNames, "today": today()])
    }

    private static func call(_ name: String, _ payload: [String: Any]) async throws -> ParsedExpense {
        let result = try await functions.httpsCallable(name).call(payload)
        let json = try JSONSerialization.data(withJSONObject: result.data)
        return try JSONDecoder().decode(ParsedExpense.self, from: json)
    }

    private static func today() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: .now)
    }

    static func parseDate(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s)
    }
}

extension UIImage {
    func resized(maxSide: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxSide else { return self }
        let scale = maxSide / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        return UIGraphicsImageRenderer(size: newSize).image { _ in draw(in: CGRect(origin: .zero, size: newSize)) }
    }
}
