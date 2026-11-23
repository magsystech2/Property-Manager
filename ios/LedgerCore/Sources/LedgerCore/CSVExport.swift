import Foundation

/// CSV export. One row per transaction, or per category share when a record is split.
/// The effect columns add up to the totals the app shows:
///   project_paid_cost, project_unpaid_billed, project_unbilled_committed -> project/category summaries
///   partner_out_of_pocket - partner_reimbursed -> amount owed to a partner
public enum CSVExport {
    public struct Filter: Sendable {
        public var projectId: UUID?
        public var partnerId: UUID?
        public var vendorId: UUID?
        public var from: Day?
        public var to: Day?
        public init(projectId: UUID? = nil, partnerId: UUID? = nil, vendorId: UUID? = nil, from: Day? = nil, to: Day? = nil) {
            self.projectId = projectId; self.partnerId = partnerId; self.vendorId = vendorId; self.from = from; self.to = to
        }
    }

    public struct Row: Sendable {
        public var transactionId: UUID
        public var type: String
        public var date: Day
        public var projectId: UUID?
        public var vendorId: UUID?
        public var partnerId: UUID?
        public var categoryId: UUID?
        public var description: String
        public var invoiceNumber: String
        public var status: String
        public var amount: Cents
        public var paidCost: Cents = 0
        public var unpaidBilled: Cents = 0
        public var unbilledCommitted: Cents = 0
        public var outOfPocket: Cents = 0
        public var reimbursed: Cents = 0
        public var contribution: Cents = 0
        public var proceeds: Cents = 0
        public var attachments: String = ""
    }

    public static let header = ["transaction_id", "type", "date", "project", "vendor", "partner", "category", "description",
                                "invoice_or_reference", "status", "amount", "project_paid_cost", "project_unpaid_billed",
                                "project_unbilled_committed", "partner_out_of_pocket", "partner_reimbursed",
                                "partner_contribution", "sale_proceeds", "attachment_filenames"]

    public static func rows(_ l: Ledger, _ f: Filter = Filter()) -> [Row] {
        var rows: [Row] = []
        func files(_ k: EntryKind, _ id: UUID) -> String { l.attachments(for: EntryRef(k, id)).map(\.filename).joined(separator: "; ") }

        for e in l.s.expenses {
            let live = !e.isVoid
            for (cid, amt) in l.categoryShares(expense: e) {
                var r = Row(transactionId: e.id, type: e.isRefund ? "receipt_refund" : "receipt", date: e.expenseDate,
                            projectId: e.projectId, vendorId: e.vendorId, partnerId: e.paidByUserId, categoryId: cid,
                            description: e.description, invoiceNumber: e.reference, status: e.status, amount: amt)
                if live {
                    r.paidCost = amt
                    if e.paidByUserId != nil { r.outOfPocket = amt }
                }
                r.attachments = files(.expense, e.id)
                rows.append(r)
            }
        }
        for b in l.s.bills {
            let live = !b.isVoid
            let outstanding = Dictionary(l.categoryShares(outstandingOf: b).map { ($0.0, $0.1) }, uniquingKeysWith: +)
            let allocs = l.allocations(bill: b.id)
            let lines: [(UUID?, Cents)] = allocs.isEmpty ? [(nil, b.totalCents)] : allocs.map { ($0.categoryId, $0.amountCents) }
            for (cid, amt) in lines {
                var r = Row(transactionId: b.id, type: "bill", date: b.billDate, projectId: b.projectId, vendorId: b.vendorId,
                            partnerId: nil, categoryId: cid, description: b.description, invoiceNumber: b.invoiceNumber,
                            status: b.status, amount: amt)
                if live { r.unpaidBilled = outstanding[cid] ?? 0 }
                r.attachments = files(.bill, b.id)
                rows.append(r)
            }
            for p in l.payments(bill: b.id) {
                let shares = p.kind == "credit" ? [(allocs.first?.categoryId, 0)] : l.categoryShares(payment: p)
                for (i, (cid, amt)) in shares.enumerated() {
                    var r = Row(transactionId: p.id, type: "bill_\(p.kind)", date: p.paymentDate, projectId: b.projectId,
                                vendorId: b.vendorId, partnerId: p.paidByUserId, categoryId: cid, description: p.kindLabel,
                                invoiceNumber: [b.invoiceNumber, p.reference].filter { !$0.isEmpty }.joined(separator: " / "),
                                status: p.status, amount: p.kind == "credit" ? (i == 0 ? -p.amountCents : 0) : amt)
                    if !p.isVoid && live {
                        r.paidCost = amt
                        if p.paidByUserId != nil { r.outOfPocket = amt }
                    }
                    r.attachments = files(.payment, p.id)
                    rows.append(r)
                }
            }
        }
        for c in l.s.commitments {
            let st = l.status(commitment: c)
            var r = Row(transactionId: c.id, type: "commitment", date: String((c.createdAt ?? l.today).prefix(10)),
                        projectId: c.projectId, vendorId: c.vendorId, partnerId: nil, categoryId: c.categoryId,
                        description: c.description, invoiceNumber: "", status: c.status, amount: st.revisedCents)
            if !c.isVoid { r.unbilledCommitted = st.unbilledCents }
            r.attachments = files(.commitment, c.id)
            rows.append(r)
        }
        for re in l.s.reimbursements {
            var r = Row(transactionId: re.id, type: "reimbursement", date: re.paidDate ?? re.requestDate, projectId: nil,
                        vendorId: nil, partnerId: re.partnerUserId, categoryId: nil, description: re.notes,
                        invoiceNumber: re.reference, status: re.status, amount: re.amountCents)
            if re.isPaid { r.reimbursed = re.amountCents }
            r.attachments = files(.reimbursement, re.id)
            rows.append(r)
        }
        for c in l.s.contributions {
            var r = Row(transactionId: c.id, type: "contribution", date: c.contributionDate, projectId: c.projectId,
                        vendorId: nil, partnerId: c.partnerUserId, categoryId: nil, description: c.notes,
                        invoiceNumber: c.reference, status: c.status, amount: c.amountCents)
            if !c.isVoid { r.contribution = c.amountCents }
            r.attachments = files(.contribution, c.id)
            rows.append(r)
        }
        for p in l.s.proceeds {
            var r = Row(transactionId: p.id, type: "sale_proceeds", date: p.saleDate, projectId: p.projectId, vendorId: nil,
                        partnerId: nil, categoryId: nil, description: p.notes, invoiceNumber: "", status: p.status, amount: p.amountCents)
            if !p.isVoid { r.proceeds = p.amountCents }
            rows.append(r)
        }

        return rows.filter { r in
            if let p = f.projectId, r.projectId != p { return false }
            if let p = f.partnerId, r.partnerId != p { return false }
            if let v = f.vendorId, r.vendorId != v { return false }
            if let from = f.from, r.date < from { return false }
            if let to = f.to, r.date > to { return false }
            return true
        }.sorted { $0.date != $1.date ? $0.date < $1.date : $0.type < $1.type }
    }

    public static func csv(_ l: Ledger, _ f: Filter = Filter()) -> String {
        let rs = rows(l, f)
        func esc(_ s: String) -> String {
            s.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" }) ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : s
        }
        var lines = [header.joined(separator: ",")]
        for r in rs {
            lines.append([r.transactionId.uuidString, r.type, r.date, l.project(r.projectId)?.nickname ?? "",
                          l.vendor(r.vendorId)?.name ?? "", r.partnerId.map { l.payerName($0) } ?? "",
                          l.category(r.categoryId)?.name ?? "", r.description, r.invoiceNumber, r.status,
                          Money.plain(r.amount), Money.plain(r.paidCost), Money.plain(r.unpaidBilled),
                          Money.plain(r.unbilledCommitted), Money.plain(r.outOfPocket), Money.plain(r.reimbursed),
                          Money.plain(r.contribution), Money.plain(r.proceeds), r.attachments].map(esc).joined(separator: ","))
        }
        func sum(_ k: KeyPath<Row, Cents>) -> String { Money.plain(rs.reduce(0) { $0 + $1[keyPath: k] }) }
        lines.append(["TOTAL", "", "", "", "", "", "", "", "", "", "", sum(\.paidCost), sum(\.unpaidBilled),
                      sum(\.unbilledCommitted), sum(\.outOfPocket), sum(\.reimbursed), sum(\.contribution), sum(\.proceeds), ""]
            .joined(separator: ","))
        return lines.joined(separator: "\n") + "\n"
    }

    public static func filename(_ l: Ledger, _ f: Filter) -> String {
        var parts = ["project-ledger"]
        if let p = l.project(f.projectId) { parts.append(p.nickname) }
        if let p = f.partnerId { parts.append(l.payerName(p)) }
        if let v = l.vendor(f.vendorId) { parts.append(v.name) }
        if let from = f.from { parts.append("from-\(from)") }
        if let to = f.to { parts.append("to-\(to)") }
        let name = parts.joined(separator: "-").lowercased()
            .map { $0.isLetter || $0.isNumber || $0 == "-" ? String($0) : "-" }.joined()
        return name + ".csv"
    }
}
