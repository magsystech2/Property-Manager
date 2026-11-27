// Cost basis, profit split and "who gets what" after a sale. Pure functions over the ledger.
import type { Ledger } from './ledger'
import { Days, type Cents, type Day } from './money'
import { hasAccess, type Member, type Project, type Repeat } from './models'
import { forecast } from './planning'

// ---------------------------------------------------------------------------
// Cost basis
// ---------------------------------------------------------------------------

export type BasisGroup = 'purchase' | 'closing' | 'rehab' | 'holding'
export const basisLabel: Record<BasisGroup, string> = {
  purchase: 'Purchase price', closing: 'Closing costs', rehab: 'Rehab and construction', holding: 'Holding and financing',
}
/** Which group a budget category counts toward, by its name. Renamed categories fall into rehab. */
export function basisGroup(categoryName: string): BasisGroup {
  const n = categoryName.trim().toLowerCase()
  if (n === 'acquisition' || n.includes('purchase')) return 'purchase'
  if (n.includes('closing')) return 'closing'
  if (['financing', 'insurance', 'utilities', 'taxes', 'property taxes', 'interest', 'holding'].some((k) => n === k || n.includes(k))) return 'holding'
  return 'rehab'
}

export interface CostBasis {
  /** Paid plus billed but unpaid, per group. */
  spent: Record<BasisGroup, Cents>
  /** Spent plus committed not billed, per group. */
  projected: Record<BasisGroup, Cents>
  spent_total: Cents
  projected_total: Cents
}

export function costBasis(l: Ledger, pid: string): CostBasis {
  const zero = (): Record<BasisGroup, Cents> => ({ purchase: 0, closing: 0, rehab: 0, holding: 0 })
  const spent = zero(), projected = zero()
  for (const line of l.categorySummary(pid)) {
    const g = basisGroup(line.name)
    spent[g] += line.paid_cents + line.unpaid_billed_cents
    projected[g] += line.projected_cents
  }
  const sum = (r: Record<BasisGroup, Cents>) => r.purchase + r.closing + r.rehab + r.holding
  return { spent, projected, spent_total: sum(spent), projected_total: sum(projected) }
}

export interface ProjectSummary {
  basis: CostBasis
  /** ARV / expected sale price from the forecast inputs. */
  arv_cents: Cents | null
  /** Recorded sale (net proceeds), when there is one. */
  sold_net_cents: Cents | null
  /** Sold: net proceeds - projected costs. Otherwise the forecast profit (needs ARV and a target date). */
  profit_cents: Cents | null
  profit_is_actual: boolean
  /** Profit / total cost, in basis points. */
  roi_bps: number | null
}

export function projectSummary(l: Ledger, p: Project): ProjectSummary {
  const basis = costBasis(l, p.id)
  const t = l.totals(p.id)
  const sold = l.s.proceeds.some((x) => x.project_id === p.id && x.status !== 'void')
  let profit: Cents | null = null
  let cost = basis.projected_total
  if (sold) profit = t.proceeds_cents - t.projected_cents
  else if (p.expected_sale_cents) {
    const f = forecast(l, p)
    profit = f.profit_cents
    cost = f.sale_cents - f.profit_cents
  }
  return {
    basis, arv_cents: p.expected_sale_cents ?? null, sold_net_cents: sold ? t.proceeds_cents : null, profit_cents: profit,
    profit_is_actual: sold, roi_bps: profit != null && cost > 0 ? Math.round(profit / cost * 10000) : null,
  }
}

// ---------------------------------------------------------------------------
// Profit split
// ---------------------------------------------------------------------------

export interface Share { partner_user_id: string; share_bps: number }
export type ShareSource = 'project' | 'default' | 'equal'

/** The split for a project: its own override, else the LLC default, else equal among partners with access. */
export function profitShares(l: Ledger, pid: string | null): { shares: Share[]; source: ShareSource } {
  const own = pid ? l.s.profit_shares.filter((x) => x.project_id === pid) : []
  if (own.length) return { shares: own.map(pick), source: 'project' }
  const def = l.s.profit_shares.filter((x) => !x.project_id)
  if (def.length) return { shares: def.map(pick), source: 'default' }
  return { shares: equalShares(l.s.members.filter(hasAccess)), source: 'equal' }
}
const pick = (x: Share): Share => ({ partner_user_id: x.partner_user_id, share_bps: x.share_bps })

export function equalShares(members: Member[]): Share[] {
  const n = members.length
  if (!n) return []
  const base = Math.floor(10000 / n)
  const sorted = [...members].sort((a, b) => a.display_name.localeCompare(b.display_name))
  return sorted.map((m, i) => ({ partner_user_id: m.user_id, share_bps: base + (i < 10000 - base * n ? 1 : 0) }))
}

/** Splits cents by basis points so the parts add up exactly (largest remainder gets the leftover cents). */
export function allocate(total: Cents, bps: number[]): Cents[] {
  const sum = bps.reduce((a, b) => a + b, 0)
  if (!sum) return bps.map(() => 0)
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const exact = bps.map((b) => (abs * b) / sum)
  const parts = exact.map(Math.floor)
  let left = abs - parts.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, i] of order) { if (left <= 0) break; parts[i] += 1; left -= 1 }
  return parts.map((p) => p * sign)
}

// ---------------------------------------------------------------------------
// Settlement: who gets what after a sale
// ---------------------------------------------------------------------------

export interface PartnerPayout {
  member: Member
  share_bps: number
  /** Capital this partner contributed to the project, returned first. */
  capital_cents: Cents
  profit_share_cents: Cents
  /** capital + profit share (a loss reduces it; never below zero). */
  due_cents: Cents
  distributed_cents: Cents
  remaining_cents: Cents
  /** What the LLC owes them for receipts paid personally (all projects); paid as a reimbursement, not a distribution. */
  owed_for_receipts_cents: Cents
}

export interface Settlement {
  sold: boolean
  sale_date: Day | null
  gross_cents: Cents | null
  selling_costs_cents: Cents | null
  net_proceeds_cents: Cents
  loan_payoff_cents: Cents
  costs_cents: Cents
  still_to_pay_cents: Cents
  profit_cents: Cents
  share_source: ShareSource
  partners: PartnerPayout[]
  /** LLC-wide contributions (not tied to a project) are returned at the LLC's first sale. */
  returns_llc_capital: boolean
  /** Net proceeds - loan payoff - bills and contracts still to pay - distributions already made. */
  cash_left_cents: Cents
  remaining_total_cents: Cents
}

export function settlement(l: Ledger, pid: string): Settlement {
  const sales = l.s.proceeds.filter((x) => x.project_id === pid && x.status !== 'void')
  const t = l.totals(pid)
  const net = sales.reduce((a, x) => a + x.amount_cents, 0)
  const allGross = sales.length > 0 && sales.every((x) => x.gross_price_cents != null)
  const payoff = sales.reduce((a, x) => a + (x.loan_payoff_cents ?? 0), 0)
  const profit = net - t.projected_cents
  const { shares, source } = profitShares(l, pid)
  const ids = new Set(shares.map((x) => x.partner_user_id))
  for (const c of l.s.contributions) if (c.project_id === pid && c.status !== 'void') ids.add(c.partner_user_id)
  for (const d of l.s.distributions) if (d.project_id === pid && d.status !== 'void') ids.add(d.partner_user_id)
  const people = [...ids].map((uid) => ({ uid, bps: shares.find((x) => x.partner_user_id === uid)?.share_bps ?? 0 }))
    .sort((a, b) => b.bps - a.bps || l.payerName(a.uid).localeCompare(l.payerName(b.uid)))
  // Equal split: divide exactly by head count (33.34/33.33/33.33% bps would put extra dollars on one partner).
  const profitParts = allocate(profit, people.map((x) => (source === 'equal' ? (x.bps ? 1 : 0) : x.bps)))
  const firstSale = returnsLLCCapital(l, pid)
  const partners = people.map(({ uid, bps }, i): PartnerPayout => {
    const b = l.partnerBalance(uid, pid)
    const all = l.partnerBalance(uid)
    const llcWide = firstSale ? l.s.contributions.filter((c) => c.partner_user_id === uid && !c.project_id && c.status !== 'void').reduce((a, c) => a + c.amount_cents, 0) : 0
    const capital = b.contributions_cents + llcWide
    const due = Math.max(capital + profitParts[i], 0)
    return {
      member: b.member, share_bps: bps, capital_cents: capital, profit_share_cents: profitParts[i], due_cents: due,
      distributed_cents: b.distributions_cents, remaining_cents: due - b.distributions_cents, owed_for_receipts_cents: all.owed_cents,
    }
  })
  const distributed = partners.reduce((a, p) => a + p.distributed_cents, 0)
  const stillToPay = t.unpaid_billed_cents + t.unbilled_committed_cents
  return {
    sold: sales.length > 0, sale_date: sales.map((x) => x.sale_date).sort().reverse()[0] ?? null,
    gross_cents: allGross ? sales.reduce((a, x) => a + (x.gross_price_cents ?? 0), 0) : null,
    selling_costs_cents: allGross ? sales.reduce((a, x) => a + (x.selling_costs_cents ?? 0), 0) : null,
    net_proceeds_cents: net, loan_payoff_cents: payoff, costs_cents: t.projected_cents, still_to_pay_cents: stillToPay, profit_cents: profit,
    share_source: source, partners, returns_llc_capital: firstSale, cash_left_cents: net - payoff - stillToPay - distributed,
    remaining_total_cents: partners.reduce((a, p) => a + Math.max(p.remaining_cents, 0), 0),
  }
}

/** True when this project is (or, before any sale, would be) the LLC's first sale. */
export function returnsLLCCapital(l: Ledger, pid: string): boolean {
  const first = new Map<string, string>()
  for (const x of l.s.proceeds) {
    if (x.status === 'void') continue
    const cur = first.get(x.project_id)
    if (!cur || x.sale_date < cur) first.set(x.project_id, x.sale_date)
  }
  if (!first.size) return true
  const earliest = [...first.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))[0][0]
  return earliest === pid
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** The next due date after `day` for a repeat, keeping the day of the month (Jan 31 + 1 month = Feb 28). */
export function advance(day: Day, repeat: Repeat | string): Day {
  const months = repeat === 'monthly' ? 1 : repeat === 'quarterly' ? 3 : repeat === 'yearly' ? 12 : 0
  const d = Days.date(day)
  if (!d || !months) return day
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), last))
  return Days.string(target)
}

// ---------------------------------------------------------------------------
// Pooled money: who put in what, what was spent, and each partner against their share
// ---------------------------------------------------------------------------

export interface PartnerShareLine {
  member: Member
  /** Lump sums put into the LLC account (the pot). */
  contributed_cents: Cents
  /** Receipts and bill payments the partner paid from their own money. */
  paid_personally_cents: Cents
  /** Paid back to the partner by the LLC for personal payments. Only counted LLC-wide. */
  reimbursed_cents: Cents
  /** contributed + paid personally - reimbursed. */
  put_in_cents: Cents
  share_bps: number
  /** Total spent x this partner's share. */
  share_of_spending_cents: Cents
  /** put in - share of spending. Positive: they've covered more than their share. Negative: they owe the others. */
  over_share_cents: Cents
}

export interface PoolSummary {
  /** Every receipt and bill payment, whoever paid it (refunds subtract). */
  total_spent_cents: Cents
  paid_by_llc_cents: Cents
  paid_personally_cents: Cents
  contributed_cents: Cents
  reimbursed_cents: Cents
  proceeds_cents: Cents
  distributed_cents: Cents
  /** What's left in the pot: contributions + sale proceeds - LLC payments - reimbursements - distributions. */
  pot_balance_cents: Cents
  share_source: ShareSource
  partners: PartnerShareLine[]
}

/**
 * The shared-pot view. Partners put lump sums into the LLC and the LLC pays most costs; sometimes a partner pays
 * personally. Each partner's money in (contributions + personal payments - reimbursements) is compared with their
 * share of everything spent, using the profit split (project override, LLC default, else equal).
 * Loans are not spending and not anyone's money in: only the cash that actually left the pot or a partner's pocket counts.
 */
export function poolSummary(l: Ledger, pid: string | null = null): PoolSummary {
  const live = <T extends { status: string }>(x: T) => x.status !== 'void'
  const inProject = (p: string | null | undefined) => !pid || p === pid
  const personal = new Map<string, Cents>()
  const add = (m: Map<string, Cents>, k: string, v: Cents) => m.set(k, (m.get(k) ?? 0) + v)
  let llc = 0
  for (const e of l.s.expenses) {
    if (!live(e) || !inProject(e.project_id)) continue
    const v = e.is_refund ? -e.total_cents : e.total_cents
    if (e.paid_by_user_id) add(personal, e.paid_by_user_id, v); else llc += v
  }
  for (const p of l.s.payments) {
    if (!live(p) || !inProject(l.bill(p.bill_id)?.project_id)) continue
    const v = p.kind === 'payment' ? p.amount_cents : p.kind === 'refund' ? -p.amount_cents : 0
    if (p.paid_by_user_id) add(personal, p.paid_by_user_id, v); else llc += v
  }
  const contributed = new Map<string, Cents>()
  for (const c of l.s.contributions) if (live(c) && inProject(c.project_id)) add(contributed, c.partner_user_id, c.amount_cents)
  const reimbursed = new Map<string, Cents>()
  if (!pid) for (const r of l.s.reimbursements) if (r.status === 'paid') add(reimbursed, r.partner_user_id, r.amount_cents)
  const proceeds = l.s.proceeds.filter((x) => live(x) && inProject(x.project_id)).reduce((a, x) => a + x.amount_cents, 0)
  const distributed = l.s.distributions.filter((x) => live(x) && inProject(x.project_id)).reduce((a, x) => a + x.amount_cents, 0)

  const sum = (m: Map<string, Cents>) => [...m.values()].reduce((a, b) => a + b, 0)
  const paidPersonally = sum(personal)
  const total = llc + paidPersonally
  const { shares, source } = profitShares(l, pid)
  const ids = new Set([...shares.map((x) => x.partner_user_id), ...personal.keys(), ...contributed.keys(), ...reimbursed.keys()])
  const people = [...ids].map((uid) => ({ uid, bps: shares.find((x) => x.partner_user_id === uid)?.share_bps ?? 0 }))
    .sort((a, b) => l.payerName(a.uid).localeCompare(l.payerName(b.uid)))
  // An equal split in basis points (33.34/33.33/33.33%) is off by dollars on large totals, so split equal shares exactly.
  const parts = allocate(total, people.map((x) => (source === 'equal' ? (x.bps ? 1 : 0) : x.bps)))
  const partners = people.map(({ uid, bps }, i): PartnerShareLine => {
    const member = l.member(uid) ?? { workspace_id: l.s.workspace.id, user_id: uid, role: 'partner', display_name: 'Former partner' }
    const c = contributed.get(uid) ?? 0, p = personal.get(uid) ?? 0, r = reimbursed.get(uid) ?? 0
    const putIn = c + p - r
    return { member, contributed_cents: c, paid_personally_cents: p, reimbursed_cents: r, put_in_cents: putIn, share_bps: bps,
      share_of_spending_cents: parts[i], over_share_cents: putIn - parts[i] }
  })
  const contributedTotal = sum(contributed), reimbursedTotal = sum(reimbursed)
  return {
    total_spent_cents: total, paid_by_llc_cents: llc, paid_personally_cents: paidPersonally, contributed_cents: contributedTotal,
    reimbursed_cents: reimbursedTotal, proceeds_cents: proceeds, distributed_cents: distributed,
    pot_balance_cents: contributedTotal + proceeds - llc - reimbursedTotal - distributed,
    share_source: source, partners,
  }
}
