import Foundation

/// Suggested fields from a scanned receipt/invoice or a spoken sentence. The user always reviews them.
public struct Suggestion: Equatable, Sendable {
    public var vendorName: String?
    public var vendorId: UUID?
    public var date: Day?
    public var totalCents: Cents?
    public var taxCents: Cents?
    public var invoiceNumber: String?
    public var description: String?
    public var projectId: UUID?
    public var categoryId: UUID?
    public var paidByMe: Bool?           // true = I paid personally, false = LLC account
    public var paymentMethod: String?
    public init() {}
}

private func matches(_ pattern: String, in text: String, options: NSRegularExpression.Options = [.caseInsensitive]) -> [[String]] {
    guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
    let ns = text as NSString
    return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { m in
        (0..<m.numberOfRanges).map { i in
            let r = m.range(at: i)
            return r.location == NSNotFound ? "" : ns.substring(with: r)
        }
    }
}

private let amountPattern = #"\$?\s?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?!\d)"#

/// Reads on-device OCR text (Apple Vision) from a receipt or invoice.
public enum ReceiptTextParser {
    public static func parse(_ text: String, vendors: [Vendor] = [], today: Day = Days.today) -> Suggestion {
        var s = Suggestion()
        let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }

        // Total: prefer labeled totals, last one wins (receipts print subtotal, then total).
        let labels = ["grand total", "amount due", "balance due", "total due", "invoice total", "total amount", "total"]
        var labeled: Cents?
        for (i, line) in lines.enumerated() {
            let lower = line.lowercased()
            guard labels.contains(where: { lower.contains($0) }), !lower.contains("subtotal"), !lower.contains("sub total"),
                  !lower.contains("total tax"), !lower.contains("savings") else { continue }
            let here = matches(amountPattern, in: line).compactMap { Money.parse($0[1]) }
            let next = i + 1 < lines.count ? matches(amountPattern, in: lines[i + 1]).compactMap { Money.parse($0[1]) } : []
            if let v = here.last ?? next.first { labeled = v }
        }
        let allAmounts = matches(amountPattern, in: text).compactMap { Money.parse($0[1]) }
        s.totalCents = labeled ?? allAmounts.max()

        for line in lines where line.lowercased().contains("tax") && !line.lowercased().contains("total") {
            if let v = matches(amountPattern, in: line).compactMap({ Money.parse($0[1]) }).last, v <= (s.totalCents ?? .max) {
                s.taxCents = v
            }
        }

        s.date = findDate(text, today: today)

        if let m = matches(#"(?:invoice|inv|bill|receipt|order|ticket|trans(?:action)?)\s*(?:#|no\.?|num(?:ber)?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})"#, in: text).first {
            let candidate = m[1]
            if candidate.rangeOfCharacter(from: .decimalDigits) != nil { s.invoiceNumber = candidate }
        }

        // Vendor: a known vendor mentioned anywhere, else the first plausible name line.
        let lowerText = text.lowercased()
        if let v = vendors.first(where: { lowerText.contains($0.name.lowercased()) }) {
            s.vendorId = v.id; s.vendorName = v.name
        } else if let first = lines.first(where: { line in
            let letters = line.filter(\.isLetter).count
            return letters >= 3 && line.count <= 40 && matches(amountPattern, in: line).isEmpty
                && findDate(line, today: today) == nil && !line.lowercased().contains("receipt")
                && !line.lowercased().contains("invoice") && !line.contains("@") && !line.lowercased().hasPrefix("www")
        }) {
            s.vendorName = first.capitalized
        }
        return s
    }

    static func findDate(_ text: String, today: Day) -> Day? {
        // 11/20/2026, 11-20-26
        if let m = matches(#"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b"#, in: text).first,
           let mo = Int(m[1]), let d = Int(m[2]), var y = Int(m[3]), (1...12).contains(mo), (1...31).contains(d) {
            if y < 100 { y += 2000 }
            return String(format: "%04d-%02d-%02d", y, mo, d)
        }
        // 2026-11-20
        if let m = matches(#"\b(20\d{2})-(\d{2})-(\d{2})\b"#, in: text).first { return "\(m[1])-\(m[2])-\(m[3])" }
        // Nov 20, 2026
        let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        if let m = matches(#"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b"#, in: text).first,
           let mi = months.firstIndex(of: m[1].lowercased()), let d = Int(m[2]), let y = Int(m[3]) {
            return String(format: "%04d-%02d-%02d", y, mi + 1, d)
        }
        return nil
    }
}

/// On-device fallback for "say it" when the server reader isn't set up (and in demo mode).
public enum VoiceParser {
    public static func parse(_ transcript: String, projects: [Project], vendors: [Vendor], categories: [BudgetCategory],
                             today: Day = Days.today) -> Suggestion {
        var s = Suggestion()
        let t = transcript.lowercased()

        if let m = matches(#"\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)"#, in: transcript).first, let v = Money.parse(m[1]) {
            s.totalCents = v
        } else if let m = matches(#"((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:dollars|bucks|usd)"#, in: t).first, let v = Money.parse(m[1]) {
            s.totalCents = v
        } else if let m = matches(#"(?:spent|paid|cost|was|for)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)"#, in: t).first, let v = Money.parse(m[1]) {
            s.totalCents = v
        }

        if let v = vendors.first(where: { t.contains($0.name.lowercased()) }) {
            s.vendorId = v.id; s.vendorName = v.name
        } else if let m = matches(#"\b(?:at|from)\s+([a-z0-9'&\. ]{2,40}?)(?=\s+(?:on|for|with|paid|using|to|yesterday|today)\b|[,.]|$)"#, in: t).first {
            s.vendorName = m[1].trimmingCharacters(in: .whitespaces).capitalized
        }

        // Project: the one whose nickname shares the most words with the sentence.
        let words = Set(t.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init))
        let ignore: Set<String> = ["st", "street", "rd", "road", "ave", "the", "flip", "new", "build", "house", "lot"]
        let scored = projects.map { p -> (Project, Int) in
            let pw = Set(p.nickname.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)).subtracting(ignore)
            return (p, pw.intersection(words).count)
        }.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }
        s.projectId = scored.first?.0.id

        s.categoryId = categories.first(where: { t.contains($0.name.lowercased()) })?.id
        if s.categoryId == nil {
            let hints: [(String, [String])] = [
                ("Materials", ["drywall", "lumber", "tile", "paint", "materials", "supplies", "screws", "fixtures", "flooring"]),
                ("Plumbing", ["plumb", "pipe", "faucet", "water heater"]), ("Electrical", ["electric", "wiring", "panel", "outlet"]),
                ("Permits", ["permit", "inspection fee"]), ("Utilities", ["water bill", "electric bill", "utility", "utilities"]),
                ("Equipment Rentals", ["rental", "rent a", "dumpster", "excavator"]), ("Labor", ["labor", "worker", "crew", "helper"]),
                ("HVAC", ["hvac", "furnace", "air condition", "duct"]), ("Framing", ["framing", "framer"]), ("Demolition", ["demo", "demolition"]),
            ]
            for (name, keys) in hints where keys.contains(where: { t.contains($0) }) {
                if let c = categories.first(where: { $0.name == name }) { s.categoryId = c.id; break }
            }
        }

        if ["my card", "my own", "i paid", "personal", "my credit", "my debit", "out of pocket", "my cash", "my money"].contains(where: { t.contains($0) }) {
            s.paidByMe = true
        } else if ["llc", "company", "business account", "business card", "company card"].contains(where: { t.contains($0) }) {
            s.paidByMe = false
        }
        if t.contains("zelle") { s.paymentMethod = "zelle" }
        else if t.contains("check") { s.paymentMethod = "check" }
        else if t.contains("cash") { s.paymentMethod = "cash" }
        else if t.contains("card") { s.paymentMethod = "card" }

        if t.contains("yesterday") { s.date = Days.adding(-1, to: today) }
        else { s.date = ReceiptTextParser.findDate(transcript, today: today) ?? today }

        if let m = matches(#"\b(?:on|for)\s+([a-z0-9 ,'&-]{3,60}?)(?=\s+(?:for|at|on|paid|using|with)\b|[.]|$)"#, in: t).first {
            s.description = m[1].trimmingCharacters(in: .whitespaces).capitalizingFirst
        }
        return s
    }
}

extension String {
    var capitalizingFirst: String { prefix(1).uppercased() + dropFirst() }
}
