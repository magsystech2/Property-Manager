import Foundation

public enum Money {
    /// "$1,234.56", negatives as "-$1,234.56".
    public static func format(_ cents: Cents, showCents: Bool = true) -> String {
        let neg = cents < 0
        let abs = Swift.abs(cents)
        let dollars = abs / 100
        let rem = abs % 100
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_US")
        let d = f.string(from: NSNumber(value: dollars)) ?? "\(dollars)"
        let body = showCents ? "$\(d).\(String(format: "%02d", rem))" : "$\(d)"
        return neg ? "-\(body)" : body
    }

    /// Plain "1234.56" for CSV.
    public static func plain(_ cents: Cents) -> String {
        let neg = cents < 0
        let a = Swift.abs(cents)
        return "\(neg ? "-" : "")\(a / 100).\(String(format: "%02d", a % 100))"
    }

    /// Parses "$1,234.5", "1234", "1,234.56" into cents. Returns nil if not a number.
    public static func parse(_ text: String) -> Cents? {
        let cleaned = text.replacingOccurrences(of: "$", with: "")
            .replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty, let dec = Decimal(string: cleaned, locale: Locale(identifier: "en_US")) else { return nil }
        var value = dec * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &value, 0, .plain)
        return NSDecimalNumber(decimal: rounded).intValue
    }

    /// Splits `amount` across `weights` proportionally; shares always add up exactly to `amount`
    /// (largest-remainder rounding). Used everywhere a bill's payments or balance are spread
    /// over its categories, so the app and the CSV agree to the cent.
    public static func distribute(_ amount: Cents, weights: [Cents]) -> [Cents] {
        let total = weights.reduce(0, +)
        guard total != 0, !weights.isEmpty else { return weights.map { _ in 0 } }
        if weights.count == 1 { return [amount] }
        var shares: [Cents] = []
        var remainders: [(index: Int, rem: Double)] = []
        for (i, w) in weights.enumerated() {
            let exact = Double(amount) * Double(w) / Double(total)
            let floored = Cents(exact.rounded(.towardZero))
            shares.append(floored)
            remainders.append((i, Swift.abs(exact - Double(floored))))
        }
        var left = amount - shares.reduce(0, +)
        let step = left >= 0 ? 1 : -1
        for r in remainders.sorted(by: { $0.rem > $1.rem || ($0.rem == $1.rem && $0.index < $1.index) }) where left != 0 {
            shares[r.index] += step
            left -= step
        }
        return shares
    }
}

public enum Days {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    public static func string(_ date: Date) -> Day { formatter.string(from: date) }
    public static func date(_ day: Day) -> Date? { formatter.date(from: String(day.prefix(10))) }
    public static var today: Day { string(Date()) }
    public static func adding(_ days: Int, to day: Day) -> Day {
        guard let d = date(day), let n = Calendar(identifier: .gregorian).date(byAdding: .day, value: days, to: d) else { return day }
        return string(n)
    }
    public static func daysBetween(_ a: Day, _ b: Day) -> Int {
        guard let da = date(a), let db = date(b) else { return 0 }
        return Calendar(identifier: .gregorian).dateComponents([.day], from: da, to: db).day ?? 0
    }
    public static func display(_ day: Day?) -> String {
        guard let day, let d = date(day) else { return "-" }
        return d.formatted(date: .abbreviated, time: .omitted)
    }
}
