import Foundation
import FirebaseFirestore

enum Categories {
    static let all = [
        "Purchase / Closing", "Materials", "Labor", "Contractor", "Permits & Fees",
        "Utilities", "Insurance", "Property Tax", "Loan Interest", "Equipment Rental",
        "Dumpster / Debris", "Inspection / Appraisal", "Staging / Cleaning",
        "Selling Costs", "Other",
    ]
    static func icon(_ c: String) -> String {
        switch c {
        case "Purchase / Closing": return "house.fill"
        case "Materials": return "shippingbox.fill"
        case "Labor": return "person.2.fill"
        case "Contractor": return "hammer.fill"
        case "Permits & Fees": return "doc.text.fill"
        case "Utilities": return "bolt.fill"
        case "Insurance": return "shield.fill"
        case "Property Tax": return "building.columns.fill"
        case "Loan Interest": return "percent"
        case "Equipment Rental": return "wrench.and.screwdriver.fill"
        case "Dumpster / Debris": return "trash.fill"
        case "Inspection / Appraisal": return "magnifyingglass"
        case "Staging / Cleaning": return "sparkles"
        case "Selling Costs": return "signpost.right.fill"
        default: return "tag.fill"
        }
    }
}

enum PaymentMethods {
    static let all = ["Card", "Check", "Zelle", "ACH / Wire", "Cash", "Other"]
}

struct Member: Codable, Identifiable, Hashable {
    @DocumentID var id: String?
    var name: String
    var email: String
}

struct Property: Codable, Identifiable, Hashable {
    @DocumentID var id: String?
    var name: String
    var address: String = ""
    var type: String = "Flip"            // Flip, New Build, Rental
    var status: String = "Renovating"    // Under Contract, Renovating, Building, Listed, Sold, On Hold
    var purchasePrice: Double = 0
    var budget: Double = 0               // renovation / build budget
    var targetSalePrice: Double = 0
    var actualSalePrice: Double?
    var createdAt: Date = .now

    static let types = ["Flip", "New Build", "Rental"]
    static let statuses = ["Under Contract", "Renovating", "Building", "Listed", "Sold", "On Hold"]
}

struct Expense: Codable, Identifiable, Hashable {
    @DocumentID var id: String?
    var date: Date = .now
    var propertyId: String?
    var propertyName: String?
    var category: String = "Materials"
    var vendor: String = ""
    var description: String = ""
    var invoiceNumber: String = ""
    var amount: Double = 0
    /// true = paid from the LLC account; false = the partner paid personally.
    var paidFromLLC: Bool = false
    var paymentMethod: String = "Card"
    var status: String = "Paid"          // Paid, Unpaid
    var receiptPath: String?             // Firebase Storage path
    var notes: String = ""
    /// Always the signed-in partner. Firestore rules enforce this.
    var createdByUid: String = ""
    var createdByName: String = ""
    var source: String = "manual"        // manual, photo, voice
    var createdAt: Date = .now

    var isPaid: Bool { status == "Paid" }
    /// Who is out of pocket: the partner, or the LLC.
    var payerLabel: String { paidFromLLC ? "LLC account" : createdByName }
}

struct Invoice: Codable, Identifiable, Hashable {
    @DocumentID var id: String?
    var contractor: String
    var propertyId: String?
    var propertyName: String?
    var invoiceNumber: String
    var invoiceDate: Date = .now
    var dueDate: Date?
    var work: String = ""
    var amount: Double = 0
    var createdAt: Date = .now
}

/// What the receipt/voice reader returns. Every field is optional.
struct ParsedExpense: Decodable {
    var vendor: String?
    var date: String?
    var amount: Double?
    var category: String?
    var description: String?
    var invoiceNumber: String?
    var propertyName: String?
    var paymentMethod: String?
    var paidFromLLC: Bool?
    var status: String?
}

extension Double {
    var money: String { formatted(.currency(code: "USD")) }
    var money0: String { formatted(.currency(code: "USD").precision(.fractionLength(0))) }
}
