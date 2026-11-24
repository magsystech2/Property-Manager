import Foundation

// Statement import and matching, missing receipts, weekly review, 30-day cash plan, profit forecast and inbox
// suggestions. Same rules as the web app (web/src/core/planning.ts) so both suggest the same things.

private func norm(_ s: String) -> String {
    s.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
}
private func squash(_ s: String) -> String { norm(s).replacingOccurrences(of: " ", with: "") }

// MARK: - CSV

public enum CSVText {
    /// Rows of a CSV (or tab/semicolon separated) file, with quotes handled. Blank rows are dropped.
    public static func parse(_ text: String) -> [[String]] {
        let t = text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
        let firstLine = t.split(whereSeparator: { $0 == "\n" || $0 == "\r" }).first.map(String.init) ?? ""
        let count = { (c: Character) in firstLine.filter { $0 == c }.count }
        let sep: Character = count("\t") > count(",") ? "\t" : count(";") > count(",") ? ";" : ","
        var rows: [[String]] = []
        var row: [String] = []
        var f = ""
        var inQ = false
        let chars = Array(t)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if inQ {
                if c == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" { f.append("\""); i += 1 } else { inQ = false }
                } else { f.append(c) }
            } else if c == "\"" && f.isEmpty { inQ = true }
            else if c == sep { row.append(f); f = "" }
            else if c == "\n" || c == "\r" {
                if c == "\r" && i + 1 < chars.count && chars[i + 1] == "\n" { i += 1 }
                row.append(f); rows.append(row); row = []; f = ""
            } else { f.append(c) }
            i += 1
        }
        if !f.isEmpty || !row.isEmpty { row.append(f); rows.append(row) }
        return rows.filter { $0.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } }
    }

    /// "2026-11-20", "11/20/2026", "11/20/26", "2026/11/20" → "2026-11-20".
    public static func day(_ v: String) -> Day? {
        let s = v.trimmingCharacters(in: .whitespaces)
        func valid(_ y: Int, _ m: Int, _ d: Int) -> Day? {
            guard (1...12).contains(m), d >= 1 else { return nil }
            var cal = Calendar(identifier: .gregorian); cal.timeZone = .current
            guard let date = cal.date(from: DateComponents(year: y, month: m, day: d)) else { return nil }
            let c = cal.dateComponents([.year, .month, .day], from: date)
            return c.year == y && c.month == m && c.day == d ? Days.string(date) : nil
        }
        if let m = s.firstMatch(of: #/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/#) {
            return valid(Int(m.1)!, Int(m.2)!, Int(m.3)!)
        }
        if let m = s.firstMatch(of: #/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/#) {
            let y = m.3.count == 2 ? 2000 + Int(m.3)! : Int(m.3)!
            return valid(y, Int(m.1)!, Int(m.2)!)
        }
        return nil
    }
}

// MARK: - Statement import

public struct ParsedStatement: Sendable {
    public struct Line: Hashable, Sendable {
        public var postedDate: Day
        public var description: String
        public var amountCents: Cents
        public init(postedDate: Day, description: String, amountCents: Cents) {
            self.postedDate = postedDate; self.description = description; self.amountCents = amountCents
        }
    }
    public var lines: [Line] = []
    public var skipped: [(row: Int, reason: String)] = []
    /// True when charges appear as negative numbers in the file (most card exports).
    public var chargesNegative: Bool
    public var error: String?
}

public enum Statements {
    public static let matchDaysAfter = 5
    public static let matchDaysBefore = 2

    /// Reads the CSV a bank or card site exports. Money out comes back positive.
    /// chargesNegative nil = decide from the file (most signed rows negative means charges are negative).
    public static func parse(_ text: String, chargesNegative: Bool? = nil) -> ParsedStatement {
        let table = CSVText.parse(text)
        var out = ParsedStatement(chargesNegative: chargesNegative ?? true)
        guard let headerAt = table.firstIndex(where: { $0.contains { $0.range(of: "date", options: .caseInsensitive) != nil } }) else {
            out.error = "Couldn’t find a header row with a Date column. Export the statement as CSV from your bank’s website."
            return out
        }
        let keys = table[headerAt].map(norm)
        func col(_ names: [String]) -> Int? { keys.firstIndex { names.contains($0) } }
        let dateCol = col(["transaction date", "trans date", "date", "posted date", "post date", "posting date"])
        let descCol = col(["description", "payee", "merchant", "name", "details", "memo", "transaction description"])
        let amtCol = col(["amount", "transaction amount", "amount usd"])
        let debitCol = col(["debit", "debits", "withdrawal", "withdrawals", "money out", "charge"])
        let creditCol = col(["credit", "credits", "deposit", "deposits", "money in", "payment"])
        guard let dateCol else { out.error = "No Date column found."; return out }
        guard amtCol != nil || debitCol != nil else { out.error = "No Amount (or Debit/Credit) column found."; return out }

        struct Raw { var row: Int; var date: Day?; var desc: String; var amount: Cents?; var split: Bool; var rawDate: String }
        func cell(_ r: [String], _ i: Int?) -> String { guard let i, i < r.count else { return "" }; return r[i] }
        var raw: [Raw] = []
        for (i, r) in table.dropFirst(headerAt + 1).enumerated() {
            let row = headerAt + i + 2
            let rawDate = cell(r, dateCol)
            let date = CSVText.day(rawDate)
            let desc = cell(r, descCol).trimmingCharacters(in: .whitespaces)
            if let amtCol {
                let v = cell(r, amtCol).replacingOccurrences(of: "(", with: "-").replacingOccurrences(of: ")", with: "")
                raw.append(Raw(row: row, date: date, desc: desc, amount: Money.parse(v), split: false, rawDate: rawDate))
            } else {
                let d = Money.parse(cell(r, debitCol)), c = creditCol == nil ? nil : Money.parse(cell(r, creditCol))
                let amount: Cents? = (d ?? 0) != 0 ? Swift.abs(d!) : (c ?? 0) != 0 ? -Swift.abs(c!) : nil
                raw.append(Raw(row: row, date: date, desc: desc, amount: amount, split: true, rawDate: rawDate))
            }
        }
        let signed = raw.filter { !$0.split && ($0.amount ?? 0) != 0 }
        let neg = chargesNegative ?? (Double(signed.filter { $0.amount! < 0 }.count) >= Double(signed.count) / 2)
        out.chargesNegative = neg
        for x in raw {
            guard let date = x.date else { out.skipped.append((x.row, x.rawDate.isEmpty ? "No date" : "Date “\(x.rawDate)” not understood")); continue }
            guard let amount = x.amount, amount != 0 else { out.skipped.append((x.row, "No amount")); continue }
            out.lines.append(.init(postedDate: date, description: x.desc, amountCents: x.split ? amount : neg ? -amount : amount))
        }
        return out
    }

    /// The same statement row imported twice gets the same fingerprint, so it's skipped. n counts identical rows in one file.
    public static func fingerprint(account: String, line: ParsedStatement.Line, n: Int) -> String {
        [norm(account), line.postedDate, String(line.amountCents), norm(line.description), String(n)].joined(separator: "|")
    }

    /// Fingerprints for a whole file, numbering identical rows 1, 2, 3…
    public static func fingerprints(account: String, lines: [ParsedStatement.Line]) -> [String] {
        var seen: [String: Int] = [:]
        return lines.map { l in
            let key = fingerprint(account: account, line: l, n: 0)
            seen[key, default: 0] += 1
            return fingerprint(account: account, line: l, n: seen[key]!)
        }
    }
}

public struct MatchCandidate: Identifiable, Sendable {
    public var ref: EntryRef
    public var id: UUID { ref.id }
    public var entry: Entry
    public var amountCents: Cents
    public var score: Int
    public var why: String
}

public struct MissingReceipt: Identifiable, Sendable {
    public enum Kind: String, Sendable { case noDocument, unmatchedCharge }
    public var kind: Kind
    public var id: String
    public var date: Day
    public var title: String
    public var subtitle: String
    public var amountCents: Cents
    /// Who should clean it up: who paid (or whose card), else who entered it.
    public var owner: UUID?
    public var ref: EntryRef?
    public var lineId: UUID?
}

public struct ReviewItem: Identifiable, Sendable {
    public var claimKind: ClaimKind
    public var itemId: UUID
    public var id: String { "\(claimKind.rawValue)-\(itemId)" }
    public var title: String
    public var subtitle: String
    public var amountCents: Cents
    public var date: Day
    /// Record to open, when it is one.
    public var ref: EntryRef?
    public var claim: Claim?
}

public struct WeeklyReview: Sendable {
    public var billsDue: [ReviewItem]
    public var approvals: [ReviewItem]
    public var reimbursementsToPay: [ReviewItem]
    public var inbox: [ReviewItem]
    public var unmatched: [ReviewItem]
    public var missing: [MissingReceipt]
}

public struct CashEvent: Identifiable, Sendable {
    public enum Kind: String, Sendable { case bill, reimbursement, draw }
    public var id = UUID()
    public var date: Day
    public var kind: Kind
    public var title: String
    public var subtitle: String
    public var projectId: UUID?
    public var amountCents: Cents
    public var ref: EntryRef?
}

public struct CashDay: Identifiable, Sendable {
    public var date: Day
    public var id: Day { date }
    public var outCents: Cents
    public var balanceCents: Cents?
    public var events: [CashEvent]
}

public struct CashPlan: Sendable {
    public var cashOnHandCents: Cents?
    public var asOf: Day?
    public var events: [CashEvent]
    public var days: [CashDay]
    public var totalCents: Cents
    public var byProject: [(projectId: UUID?, totalCents: Cents)]
    /// First day expected payments exceed the cash on hand, if any.
    public var shortfall: (date: Day, shortByCents: Cents)?
}

public struct Forecast: Sendable {
    public var saleCents: Cents
    public var sellingCostsCents: Cents
    public var projectedCostsCents: Cents
    /// Budget left beyond what's projected, when the budget is higher (unspent budget isn't counted as profit).
    public var budgetGapCents: Cents
    public var monthsLeft: Double
    public var holdingCents: Cents
    public var interestCents: Cents
    public var profitCents: Cents
    /// Profit ÷ all costs, in basis points.
    public var marginBps: Int?
    public var missing: [String]
}

public struct InboxSuggestion: Equatable, Sendable {
    public var vendor: String?
    public var totalCents: Cents?
    public var date: Day?
    public var projectId: UUID?
    public var kind: String?
}

public extension Ledger {
    // MARK: Statement matching

    func matchedRecordIds() -> Set<UUID> {
        Set(s.statementMatches.flatMap { [$0.expenseId, $0.billPaymentId].compactMap { $0 } })
    }

    func matchedCents(line id: UUID) -> Cents {
        s.statementMatches.filter { $0.statementLineId == id }.reduce(0) { sum, m in
            if let eid = m.expenseId, let e = s.expenses.first(where: { $0.id == eid }) { return sum + e.signedCents }
            if let pid = m.billPaymentId, let p = s.payments.first(where: { $0.id == pid }) { return sum + (p.kind == "refund" ? -p.amountCents : p.amountCents) }
            return sum
        }
    }

    /// Store names on card statements are noisy ("HOMEDEPOT #6512 ATLANTA GA"); this guesses a readable vendor.
    func vendorFromDescription(_ desc: String) -> (vendorId: UUID?, name: String) {
        let d = squash(desc)
        if let v = s.vendors.sorted(by: { $0.name.count > $1.name.count }).first(where: { let n = squash($0.name); return n.count >= 3 && d.contains(n) }) {
            return (v.id, v.name)
        }
        var cleaned = desc.replacingOccurrences(of: "^(sq \\*|tst\\* |pos |debit card purchase |purchase )", with: "", options: [.regularExpression, .caseInsensitive])
        cleaned = cleaned.replacingOccurrences(of: "[#*]\\s*\\d+.*$", with: "", options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(of: "\\s{2,}.*$", with: "", options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(of: "\\b\\d{3,}\\b.*$", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        let name = String(cleaned.lowercased().capitalized.prefix(60))
        return (nil, name.isEmpty ? String(desc.prefix(60)) : name)
    }

    /// Receipts and bill payments that could explain a statement line: the amount not matched yet, dated from 2 days
    /// before to 5 days after, not already matched. Ranked by date, same payer as the card owner, vendor in the text.
    func suggestMatches(_ line: StatementLine) -> [MatchCandidate] {
        let used = matchedRecordIds()
        let left = line.amountCents - matchedCents(line: line.id)
        guard left != 0 else { return [] }
        let desc = squash(line.description)
        var out: [MatchCandidate] = []
        func consider(_ ref: EntryRef, _ date: Day, _ amount: Cents, _ payer: UUID?, _ vendorId: UUID) {
            guard !used.contains(ref.id), amount == left else { return }
            let days = Days.daysBetween(date, line.postedDate)
            guard days <= Statements.matchDaysAfter, days >= -Statements.matchDaysBefore else { return }
            let samePayer = payer == line.accountOwner
            let vname = squash(vendor(vendorId)?.name ?? "")
            let vendorHit = vname.count >= 3 && desc.contains(String(vname.prefix(8)))
            guard let e = entry(ref) else { return }
            let ad = Swift.abs(days)
            let score = 100 - ad * 8 + (samePayer ? 25 : -30) + (vendorHit ? 30 : 0)
            let why = [ad == 0 ? "same day" : "\(ad) day\(ad == 1 ? "" : "s") apart", vendorHit ? "vendor name matches" : nil,
                       samePayer ? nil : "paid by someone else"].compactMap { $0 }.joined(separator: " · ")
            out.append(MatchCandidate(ref: ref, entry: e, amountCents: amount, score: score, why: why))
        }
        for e in s.expenses where e.status == RecordStatus.posted {
            consider(EntryRef(.expense, e.id), e.expenseDate, e.signedCents, e.paidByUserId, e.vendorId)
        }
        for p in s.payments where p.status == RecordStatus.posted && p.kind != "credit" {
            if let b = bill(p.billId) { consider(EntryRef(.payment, p.id), p.paymentDate, p.kind == "refund" ? -p.amountCents : p.amountCents, p.paidByUserId, b.vendorId) }
        }
        return out.sorted { $0.score > $1.score }
    }

    // MARK: Missing receipts

    func missingReceipts() -> [MissingReceipt] {
        let withDocs = Set(s.attachments.flatMap { [$0.expenseId, $0.billPaymentId].compactMap { $0 } })
        var out: [MissingReceipt] = []
        for e in s.expenses where e.status == RecordStatus.posted && !withDocs.contains(e.id) {
            out.append(MissingReceipt(kind: .noDocument, id: "expense:\(e.id)", date: e.expenseDate, title: vendor(e.vendorId)?.name ?? "Receipt",
                                      subtitle: "Receipt · \(project(e.projectId)?.nickname ?? "") · no document attached", amountCents: e.signedCents,
                                      owner: e.paidByUserId ?? e.createdBy, ref: EntryRef(.expense, e.id)))
        }
        for line in s.statementLines where line.status == "unmatched" && line.amountCents > 0 {
            out.append(MissingReceipt(kind: .unmatchedCharge, id: "line:\(line.id)", date: line.postedDate,
                                      title: line.description.isEmpty ? "Card charge" : line.description,
                                      subtitle: "\(line.account) · charge with no receipt entered", amountCents: line.amountCents,
                                      owner: line.accountOwner ?? line.createdBy, lineId: line.id))
        }
        return out.sorted { $0.date > $1.date }
    }

    // MARK: Weekly review

    func claim(_ kind: ClaimKind, _ id: UUID) -> Claim? { s.claims.first { $0.itemKind == kind.rawValue && $0.itemId == id } }

    func weeklyReview(days: Int = 7) -> WeeklyReview {
        let until = Days.adding(days, to: today)
        func item(_ k: ClaimKind, _ id: UUID, _ title: String, _ subtitle: String, _ amount: Cents, _ date: Day, _ ref: EntryRef?) -> ReviewItem {
            ReviewItem(claimKind: k, itemId: id, title: title, subtitle: subtitle, amountCents: amount, date: date, ref: ref, claim: claim(k, id))
        }
        let billsDue = s.bills.filter { b in
            b.status == RecordStatus.posted && balance(bill: b.id).outstandingCents > 0 && (b.dueDate.map { $0 <= until } ?? false)
        }.sorted { ($0.dueDate ?? "") < ($1.dueDate ?? "") }.map { b in
            item(.bill, b.id, vendor(b.vendorId)?.name ?? "Bill",
                 "\(b.dueDate! < today ? "Overdue since" : "Due") \(Days.display(b.dueDate)) · \(project(b.projectId)?.nickname ?? "")\(b.invoiceNumber.isEmpty ? "" : " · #\(b.invoiceNumber)")",
                 balance(bill: b.id).outstandingCents, b.dueDate!, EntryRef(.bill, b.id))
        }
        var approvals = s.bills.filter { $0.status == RecordStatus.pendingReview }.map { b in
            item(.bill, b.id, vendor(b.vendorId)?.name ?? "Bill", "Bill waiting for approval · \(project(b.projectId)?.nickname ?? "")",
                 b.totalCents, b.billDate, EntryRef(.bill, b.id))
        }
        approvals += s.changeOrders.filter { $0.status == RecordStatus.pendingReview }.map { c in
            let cm = s.commitments.first { $0.id == c.commitmentId }
            return item(.changeOrder, c.id, vendor(cm?.vendorId)?.name ?? "Change order", "Change order · \(c.description)",
                        c.amountCents, String((c.createdAt ?? today).prefix(10)), EntryRef(.changeOrder, c.id))
        }
        if s.workspace.requireReview {
            approvals += s.reimbursements.filter { $0.status == RecordStatus.requested }.map { r in
                item(.reimbursement, r.id, "Reimburse \(payerName(r.partnerUserId))", "Reimbursement request waiting for approval",
                     r.amountCents, r.requestDate, EntryRef(.reimbursement, r.id))
            }
        }
        let toPay = s.reimbursements.filter { $0.status == RecordStatus.approved || ($0.status == RecordStatus.requested && !s.workspace.requireReview) }.map { r in
            item(.reimbursement, r.id, "Reimburse \(payerName(r.partnerUserId))", "Requested \(Days.display(r.requestDate))",
                 r.amountCents, r.requestDate, EntryRef(.reimbursement, r.id))
        }
        let inbox = s.inboxItems.filter { $0.status == "new" }.map { i in
            item(.inboxItem, i.id, (i.suggestedVendor?.isEmpty == false ? i.suggestedVendor! : i.filename),
                 "In the inbox since \(Days.display(i.createdDay))\(i.note.isEmpty ? "" : " · \(i.note)")", i.suggestedTotalCents ?? 0, i.createdDay, nil)
        }
        let unmatched = s.statementLines.filter { $0.status == "unmatched" }.map { l in
            item(.statementLine, l.id, l.description.isEmpty ? "Statement line" : l.description, "\(l.account) · \(Days.display(l.postedDate))",
                 l.amountCents, l.postedDate, nil)
        }
        return WeeklyReview(billsDue: billsDue, approvals: approvals, reimbursementsToPay: toPay, inbox: inbox, unmatched: unmatched, missing: missingReceipts())
    }

    // MARK: Cash plan

    /// What the LLC expects to pay out from today through `days` ahead: unpaid bills by due date (overdue and undated
    /// count today), reimbursements ready to pay (today), and scheduled draws capped at what's still unbilled.
    func cashPlan(days: Int = 30) -> CashPlan {
        let until = Days.adding(days, to: today)
        var events: [CashEvent] = []
        for b in s.bills where b.status == RecordStatus.posted {
            let owed = balance(bill: b.id).outstandingCents
            guard owed > 0 else { continue }
            let due = (b.dueDate.map { $0 > today } ?? false) ? b.dueDate! : today
            guard due <= until else { continue }
            let sub = b.dueDate == nil ? "Bill with no due date" : b.dueDate! < today ? "Overdue since \(Days.display(b.dueDate))" : "Bill due\(b.invoiceNumber.isEmpty ? "" : " · #\(b.invoiceNumber)")"
            events.append(CashEvent(date: due, kind: .bill, title: vendor(b.vendorId)?.name ?? "Bill", subtitle: sub, projectId: b.projectId, amountCents: owed, ref: EntryRef(.bill, b.id)))
        }
        for r in s.reimbursements where r.status == RecordStatus.approved || (r.status == RecordStatus.requested && !s.workspace.requireReview) {
            events.append(CashEvent(date: today, kind: .reimbursement, title: "Reimburse \(payerName(r.partnerUserId))", subtitle: "Ready to pay",
                                    projectId: nil, amountCents: r.amountCents, ref: EntryRef(.reimbursement, r.id)))
        }
        let byCommitment = Dictionary(grouping: s.scheduledDraws.sorted { $0.dueDate < $1.dueDate }, by: \.commitmentId)
        for (cid, draws) in byCommitment {
            guard let c = s.commitments.first(where: { $0.id == cid }), !c.isVoid else { continue }
            var room = status(commitment: c).unbilledCents
            for d in draws {
                let amount = min(d.amountCents, room)
                room -= amount
                guard amount > 0, d.dueDate >= today, d.dueDate <= until else { continue }
                let capped = amount < d.amountCents ? " (capped at the \(Money.format(amount)) not billed yet)" : ""
                events.append(CashEvent(date: d.dueDate, kind: .draw, title: vendor(c.vendorId)?.name ?? "Draw",
                                        subtitle: "Scheduled draw\(d.description.isEmpty ? "" : " · \(d.description)")\(capped)",
                                        projectId: c.projectId, amountCents: amount, ref: EntryRef(.commitment, c.id)))
            }
        }
        events.sort { $0.date != $1.date ? $0.date < $1.date : $0.amountCents > $1.amountCents }
        let latest = s.cashBalances.sorted { $0.asOf != $1.asOf ? $0.asOf > $1.asOf : ($0.createdAt ?? "") > ($1.createdAt ?? "") }.first
        var bal = latest?.amountCents
        var out: [CashDay] = []
        var shortfall: (date: Day, shortByCents: Cents)?
        for e in events {
            if out.last?.date != e.date { out.append(CashDay(date: e.date, outCents: 0, balanceCents: bal, events: [])) }
            out[out.count - 1].events.append(e)
            out[out.count - 1].outCents += e.amountCents
            if let b = bal {
                bal = b - e.amountCents
                out[out.count - 1].balanceCents = bal
                if bal! < 0 && shortfall == nil { shortfall = (e.date, -bal!) }
            }
        }
        var proj: [UUID?: Cents] = [:]
        for e in events { proj[e.projectId, default: 0] += e.amountCents }
        return CashPlan(cashOnHandCents: latest?.amountCents, asOf: latest?.asOf, events: events, days: out,
                        totalCents: events.reduce(0) { $0 + $1.amountCents },
                        byProject: proj.map { (projectId: $0.key, totalCents: $0.value) }.sorted { $0.totalCents > $1.totalCents },
                        shortfall: shortfall)
    }

    // MARK: Forecast

    /// Expected profit if the flip sells at salePct of the expected price, delayMonths after the target sale date.
    func forecast(_ p: Project, delayMonths: Double = 0, salePct: Double = 100) -> Forecast {
        let t = totals(project: p.id)
        var missing: [String] = []
        if (p.expectedSaleCents ?? 0) == 0 { missing.append("expected sale price") }
        if p.targetSaleDate == nil { missing.append("target sale date") }
        let sale = Cents((Double(p.expectedSaleCents ?? 0) * salePct / 100).rounded())
        let selling = Cents((Double(sale) * Double(p.sellingCostBps ?? 0) / 10000).rounded())
        let gap = max(t.budgetCents - t.projectedCents, 0)
        let months = Ledger.monthsUntil(today, p.targetSaleDate, delayMonths: delayMonths)
        let holding = Cents((Double(p.monthlyHoldingCents ?? 0) * months).rounded())
        let interest = Cents((Double(p.loanBalanceCents ?? 0) * Double(p.loanRateBps ?? 0) / 10000 / 12 * months).rounded())
        let costs = t.projectedCents + gap + selling + holding + interest
        let profit = sale - costs
        return Forecast(saleCents: sale, sellingCostsCents: selling, projectedCostsCents: t.projectedCents, budgetGapCents: gap,
                        monthsLeft: months, holdingCents: holding, interestCents: interest, profitCents: profit,
                        marginBps: costs > 0 ? Int((Double(profit) / Double(costs) * 10000).rounded()) : nil, missing: missing)
    }

    /// Months from today until the target date (at least 0), plus any delay, rounded to hundredths.
    static func monthsUntil(_ today: Day, _ target: Day?, delayMonths: Double = 0) -> Double {
        let base = target.map { Double(max(Days.daysBetween(today, $0), 0)) / 30.4375 } ?? 0
        return ((base + delayMonths) * 100).rounded() / 100
    }

    // MARK: Inbox suggestions

    /// Reads the note and file name ("homedepot 42.10 oak st.jpg") for a first guess at vendor, amount, date and project.
    func suggestFromText(_ text: String) -> InboxSuggestion {
        let t = text.replacingOccurrences(of: "\\.(jpe?g|png|heic|pdf|webp|gif)$", with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: "_+", with: " ", options: .regularExpression)
        let amounts = t.matches(of: #/\$?\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2}|\$\s?\d+)/#).compactMap { Money.parse(String($0.1)) }.filter { $0 != 0 }
        let nt = squash(t)
        let words = norm(t).split(separator: " ").map(String.init)
        let v = s.vendors.sorted { $0.name.count > $1.name.count }.first { let n = squash($0.name); return n.count >= 3 && nt.contains(n) }
        let p = s.projects.first { p in
            let n = norm(p.nickname)
            let first = n.split(separator: " ").first.map(String.init) ?? ""
            return nt.contains(n.replacingOccurrences(of: " ", with: "")) || (first.count >= 3 && words.contains(first))
        }
        let date = t.firstMatch(of: #/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/#).flatMap { CSVText.day(String($0.1)) }
        let kind: String? = t.range(of: "invoice|bill|inv\\b|estimate|draw", options: [.regularExpression, .caseInsensitive]) != nil ? "bill"
            : t.range(of: "receipt", options: .caseInsensitive) != nil ? "receipt" : nil
        return InboxSuggestion(vendor: v?.name, totalCents: amounts.max(), date: date, projectId: p?.id, kind: kind)
    }
}
