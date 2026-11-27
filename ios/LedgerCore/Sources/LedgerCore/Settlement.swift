import Foundation

// Cost basis, profit split and "who gets what" after a sale. Same rules as the web app (web/src/core/settlement.ts).

public enum BasisGroup: String, CaseIterable, Sendable {
    case purchase, closing, rehab, holding
    public var label: String {
        switch self {
        case .purchase: "Purchase price"
        case .closing: "Closing costs"
        case .rehab: "Rehab and construction"
        case .holding: "Holding and financing"
        }
    }
    /// Which group a budget category counts toward, by its name. Renamed categories fall into rehab.
    public static func of(_ categoryName: String) -> BasisGroup {
        let n = categoryName.trimmingCharacters(in: .whitespaces).lowercased()
        if n == "acquisition" || n.contains("purchase") { return .purchase }
        if n.contains("closing") { return .closing }
        if ["financing", "insurance", "utilities", "taxes", "property taxes", "interest", "holding"].contains(where: { n == $0 || n.contains($0) }) { return .holding }
        return .rehab
    }
}

public struct CostBasis: Sendable {
    /// Paid plus billed but unpaid, per group.
    public var spent: [BasisGroup: Cents]
    /// Spent plus committed not billed, per group.
    public var projected: [BasisGroup: Cents]
    public var spentTotal: Cents { spent.values.reduce(0, +) }
    public var projectedTotal: Cents { projected.values.reduce(0, +) }
}

public struct ProjectSummary: Sendable {
    public var basis: CostBasis
    public var arvCents: Cents?
    public var soldNetCents: Cents?
    /// Sold: net proceeds − projected costs. Otherwise the forecast profit (needs an expected sale price).
    public var profitCents: Cents?
    public var profitIsActual: Bool
    /// Profit ÷ total cost, in basis points.
    public var roiBps: Int?
}

public struct Share: Hashable, Sendable {
    public var partnerUserId: UUID
    public var shareBps: Int
    public init(partnerUserId: UUID, shareBps: Int) { self.partnerUserId = partnerUserId; self.shareBps = shareBps }
}

public enum ShareSource: String, Sendable {
    case project, `default`, equal
    public var label: String {
        switch self {
        case .project: "Split set for this project"
        case .default: "LLC default split"
        case .equal: "Equal split (no split set)"
        }
    }
}

public struct PartnerPayout: Identifiable, Sendable {
    public var member: Member
    public var id: UUID { member.userId }
    public var shareBps: Int
    /// Capital this partner contributed to the project, returned first.
    public var capitalCents: Cents
    public var profitShareCents: Cents
    /// Capital + profit share (a loss reduces it; never below zero).
    public var dueCents: Cents
    public var distributedCents: Cents
    public var remainingCents: Cents
    /// Owed for receipts paid personally (all projects); paid as a reimbursement, not a distribution.
    public var owedForReceiptsCents: Cents
}

public struct Settlement: Sendable {
    public var sold: Bool
    public var saleDate: Day?
    public var grossCents: Cents?
    public var sellingCostsCents: Cents?
    public var netProceedsCents: Cents
    public var loanPayoffCents: Cents
    public var costsCents: Cents
    public var stillToPayCents: Cents
    public var profitCents: Cents
    public var shareSource: ShareSource
    public var partners: [PartnerPayout]
    /// LLC-wide contributions (not tied to a project) are returned at the LLC's first sale.
    public var returnsLLCCapital: Bool
    /// Net proceeds − loan payoff − bills and contracts still to pay − distributions already made.
    public var cashLeftCents: Cents
    public var remainingTotalCents: Cents
}

public extension Ledger {
    func costBasis(project pid: UUID) -> CostBasis {
        var spent: [BasisGroup: Cents] = [:], projected: [BasisGroup: Cents] = [:]
        for g in BasisGroup.allCases { spent[g] = 0; projected[g] = 0 }
        for line in categorySummary(project: pid) {
            let g = BasisGroup.of(line.name)
            spent[g, default: 0] += line.paidCents + line.unpaidBilledCents
            projected[g, default: 0] += line.projectedCents
        }
        return CostBasis(spent: spent, projected: projected)
    }

    func summary(project p: Project) -> ProjectSummary {
        let basis = costBasis(project: p.id)
        let t = totals(project: p.id)
        let sold = s.proceeds.contains { $0.projectId == p.id && !$0.isVoid }
        var profit: Cents? = nil
        var cost = basis.projectedTotal
        if sold { profit = t.proceedsCents - t.projectedCents }
        else if let e = p.expectedSaleCents, e > 0 {
            let f = forecast(p)
            profit = f.profitCents
            cost = f.saleCents - f.profitCents
        }
        return ProjectSummary(basis: basis, arvCents: p.expectedSaleCents, soldNetCents: sold ? t.proceedsCents : nil, profitCents: profit,
                              profitIsActual: sold, roiBps: profit.flatMap { cost > 0 ? Int((Double($0) / Double(cost) * 10000).rounded()) : nil })
    }

    /// The split for a project: its own override, else the LLC default, else equal among partners with access.
    func profitShares(project pid: UUID?) -> (shares: [Share], source: ShareSource) {
        let own = pid.map { id in s.profitShares.filter { $0.projectId == id } } ?? []
        if !own.isEmpty { return (own.map { Share(partnerUserId: $0.partnerUserId, shareBps: $0.shareBps) }, .project) }
        let def = s.profitShares.filter { $0.projectId == nil }
        if !def.isEmpty { return (def.map { Share(partnerUserId: $0.partnerUserId, shareBps: $0.shareBps) }, .default) }
        return (Settlements.equalShares(s.members.filter(\.hasAccess)), .equal)
    }

    /// True when this project is (or, before any sale, would be) the LLC's first sale.
    func returnsLLCCapital(project pid: UUID) -> Bool {
        var first: [UUID: Day] = [:]
        for x in s.proceeds where !x.isVoid {
            if let cur = first[x.projectId], cur <= x.saleDate { continue }
            first[x.projectId] = x.saleDate
        }
        guard !first.isEmpty else { return true }
        let earliest = first.sorted { $0.value != $1.value ? $0.value < $1.value : $0.key.uuidString.lowercased() < $1.key.uuidString.lowercased() }[0].key
        return earliest == pid
    }

    func settlement(project pid: UUID) -> Settlement {
        let sales = s.proceeds.filter { $0.projectId == pid && !$0.isVoid }
        let t = totals(project: pid)
        let net = sales.reduce(0) { $0 + $1.amountCents }
        let allGross = !sales.isEmpty && sales.allSatisfy { $0.grossPriceCents != nil }
        let payoff = sales.reduce(0) { $0 + ($1.loanPayoffCents ?? 0) }
        let profit = net - t.projectedCents
        let (shares, source) = profitShares(project: pid)
        var ids = Set(shares.map(\.partnerUserId))
        for c in s.contributions where c.projectId == pid && !c.isVoid { ids.insert(c.partnerUserId) }
        for d in s.distributions where d.projectId == pid && !d.isVoid { ids.insert(d.partnerUserId) }
        let people = ids.map { uid in (uid: uid, bps: shares.first { $0.partnerUserId == uid }?.shareBps ?? 0) }
            .sorted { $0.bps != $1.bps ? $0.bps > $1.bps : payerName($0.uid).localizedCompare(payerName($1.uid)) == .orderedAscending }
        // Equal split: divide exactly by head count (33.34/33.33/33.33% bps would put extra dollars on one partner).
        let parts = Settlements.allocate(profit, bps: people.map { source == .equal ? ($0.bps > 0 ? 1 : 0) : $0.bps })
        let firstSale = returnsLLCCapital(project: pid)
        let partners = people.enumerated().map { i, p -> PartnerPayout in
            let b = partnerBalance(p.uid, project: pid)
            let all = partnerBalance(p.uid)
            let llcWide = firstSale ? s.contributions.filter { $0.partnerUserId == p.uid && $0.projectId == nil && !$0.isVoid }.reduce(0) { $0 + $1.amountCents } : 0
            let capital = b.contributionsCents + llcWide
            let due = max(capital + parts[i], 0)
            return PartnerPayout(member: b.member, shareBps: p.bps, capitalCents: capital, profitShareCents: parts[i], dueCents: due,
                                 distributedCents: b.distributionsCents, remainingCents: due - b.distributionsCents, owedForReceiptsCents: all.owedCents)
        }
        let distributed = partners.reduce(0) { $0 + $1.distributedCents }
        let stillToPay = t.unpaidBilledCents + t.unbilledCommittedCents
        return Settlement(sold: !sales.isEmpty, saleDate: sales.map(\.saleDate).max(),
                          grossCents: allGross ? sales.reduce(0) { $0 + ($1.grossPriceCents ?? 0) } : nil,
                          sellingCostsCents: allGross ? sales.reduce(0) { $0 + ($1.sellingCostsCents ?? 0) } : nil,
                          netProceedsCents: net, loanPayoffCents: payoff, costsCents: t.projectedCents, stillToPayCents: stillToPay,
                          profitCents: profit, shareSource: source, partners: partners, returnsLLCCapital: firstSale,
                          cashLeftCents: net - payoff - stillToPay - distributed,
                          remainingTotalCents: partners.reduce(0) { $0 + max($1.remainingCents, 0) })
    }
}

public enum Settlements {
    public static func equalShares(_ members: [Member]) -> [Share] {
        let n = members.count
        guard n > 0 else { return [] }
        let base = 10000 / n
        let extra = 10000 - base * n
        return members.sorted { $0.displayName.localizedCompare($1.displayName) == .orderedAscending }
            .enumerated().map { i, m in Share(partnerUserId: m.userId, shareBps: base + (i < extra ? 1 : 0)) }
    }

    /// Splits cents by basis points so the parts add up exactly (largest remainder gets the leftover cents).
    public static func allocate(_ total: Cents, bps: [Int]) -> [Cents] {
        let sum = bps.reduce(0, +)
        guard sum > 0 else { return bps.map { _ in 0 } }
        let sign = total < 0 ? -1 : 1
        let abs = Swift.abs(total)
        let exact = bps.map { Double(abs) * Double($0) / Double(sum) }
        var parts = exact.map { Cents($0.rounded(.down)) }
        var left = abs - parts.reduce(0, +)
        let order = exact.enumerated().map { (rem: $1 - $1.rounded(.down), i: $0) }
            .sorted { $0.rem != $1.rem ? $0.rem > $1.rem : $0.i < $1.i }
        for o in order where left > 0 { parts[o.i] += 1; left -= 1 }
        return parts.map { $0 * sign }
    }

    /// The next due date after `day` for a repeat, keeping the day of the month (Jan 31 + 1 month = Feb 28).
    public static func advance(_ day: Day, repeat r: String) -> Day {
        let months = r == "monthly" ? 1 : r == "quarterly" ? 3 : r == "yearly" ? 12 : 0
        guard months > 0, let d = Days.date(day) else { return day }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let c = cal.dateComponents([.year, .month, .day], from: d)
        guard let firstOfTarget = cal.date(from: DateComponents(year: c.year, month: (c.month ?? 1) + months, day: 1)),
              let range = cal.range(of: .day, in: .month, for: firstOfTarget) else { return day }
        var tc = cal.dateComponents([.year, .month], from: firstOfTarget)
        tc.day = min(c.day ?? 1, range.count)
        return cal.date(from: tc).map { Days.string($0) } ?? day
    }
}

// MARK: - Pooled money: who put in what, what was spent, and each partner against their share
// Same rules as the web app's poolSummary (web/src/core/settlement.ts).

public struct PartnerShareLine: Identifiable, Sendable {
    public var member: Member
    public var id: UUID { member.userId }
    /// Lump sums put into the LLC account (the pot).
    public var contributedCents: Cents
    /// Receipts and bill payments the partner paid from their own money.
    public var paidPersonallyCents: Cents
    /// Paid back to the partner by the LLC for personal payments. Only counted LLC-wide.
    public var reimbursedCents: Cents
    /// contributed + paid personally − reimbursed.
    public var putInCents: Cents
    public var shareBps: Int
    /// Total spent × this partner's share.
    public var shareOfSpendingCents: Cents
    /// put in − share of spending. Positive: covered more than their share. Negative: owes the others.
    public var overShareCents: Cents
}

public struct PoolSummary: Sendable {
    /// Every receipt and bill payment, whoever paid it (refunds subtract).
    public var totalSpentCents: Cents
    public var paidByLLCCents: Cents
    public var paidPersonallyCents: Cents
    public var contributedCents: Cents
    public var reimbursedCents: Cents
    public var proceedsCents: Cents
    public var distributedCents: Cents
    /// What's left in the pot: contributions + sale proceeds − LLC payments − reimbursements − distributions.
    public var potBalanceCents: Cents
    public var shareSource: ShareSource
    public var partners: [PartnerShareLine]
}

public extension Ledger {
    /// The shared-pot view. Each partner's money in (contributions + personal payments − reimbursements) is compared with
    /// their share of everything spent, using the profit split (project override, LLC default, else equal).
    /// Loans aren't spending and aren't anyone's money in: only cash that left the pot or a partner's pocket counts.
    func poolSummary(project pid: UUID? = nil) -> PoolSummary {
        func inProject(_ p: UUID?) -> Bool { pid == nil || p == pid }
        var personal: [UUID: Cents] = [:]
        var llc: Cents = 0
        for e in s.expenses where !e.isVoid && inProject(e.projectId) {
            if let by = e.paidByUserId { personal[by, default: 0] += e.signedCents } else { llc += e.signedCents }
        }
        for p in s.payments where !p.isVoid && inProject(bill(p.billId)?.projectId) {
            let v = p.kind == "payment" ? p.amountCents : p.kind == "refund" ? -p.amountCents : 0
            if let by = p.paidByUserId { personal[by, default: 0] += v } else { llc += v }
        }
        var contributed: [UUID: Cents] = [:]
        for c in s.contributions where !c.isVoid && inProject(c.projectId) { contributed[c.partnerUserId, default: 0] += c.amountCents }
        var reimbursed: [UUID: Cents] = [:]
        if pid == nil { for r in s.reimbursements where r.status == RecordStatus.paid { reimbursed[r.partnerUserId, default: 0] += r.amountCents } }
        let proceeds = s.proceeds.filter { !$0.isVoid && inProject($0.projectId) }.reduce(0) { $0 + $1.amountCents }
        let distributed = s.distributions.filter { !$0.isVoid && inProject($0.projectId) }.reduce(0) { $0 + $1.amountCents }

        let paidPersonally = personal.values.reduce(0, +)
        let total = llc + paidPersonally
        let (shares, source) = profitShares(project: pid)
        var ids = Set(shares.map(\.partnerUserId))
        ids.formUnion(personal.keys); ids.formUnion(contributed.keys); ids.formUnion(reimbursed.keys)
        let people = ids.map { uid in (uid: uid, bps: shares.first { $0.partnerUserId == uid }?.shareBps ?? 0) }
            .sorted { payerName($0.uid).localizedCompare(payerName($1.uid)) == .orderedAscending }
        // An equal split in basis points (33.34/33.33/33.33%) is off by dollars on big totals, so equal shares split exactly.
        let parts = Settlements.allocate(total, bps: people.map { source == .equal ? ($0.bps > 0 ? 1 : 0) : $0.bps })
        let partners = people.enumerated().map { i, p -> PartnerShareLine in
            let m = member(p.uid) ?? Member(workspaceId: s.workspace.id, userId: p.uid, role: "partner", displayName: "Former partner")
            let c = contributed[p.uid] ?? 0, pp = personal[p.uid] ?? 0, r = reimbursed[p.uid] ?? 0
            return PartnerShareLine(member: m, contributedCents: c, paidPersonallyCents: pp, reimbursedCents: r, putInCents: c + pp - r,
                                    shareBps: p.bps, shareOfSpendingCents: parts[i], overShareCents: c + pp - r - parts[i])
        }
        let contributedTotal = contributed.values.reduce(0, +), reimbursedTotal = reimbursed.values.reduce(0, +)
        return PoolSummary(totalSpentCents: total, paidByLLCCents: llc, paidPersonallyCents: paidPersonally, contributedCents: contributedTotal,
                           reimbursedCents: reimbursedTotal, proceedsCents: proceeds, distributedCents: distributed,
                           potBalanceCents: contributedTotal + proceeds - llc - reimbursedTotal - distributed,
                           shareSource: source, partners: partners)
    }
}
