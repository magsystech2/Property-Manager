// Sample LLC for demo mode: 3 partners, 2 properties. Same numbers as the iPhone demo
// (LedgerCore/DemoData.swift). Nothing is sent anywhere.
import { Days, uuid, type Cents, type Day } from './money'
import {
  defaultCategoryNames, emptySnapshot, type Allocation, type Bill, type BillPayment, type Expense, type Project,
  type Snapshot, type Vendor, type Commitment, type Reimbursement,
} from './models'

export const DemoIds = {
  workspace: 'd0000000-0000-0000-0000-000000000001',
  partnerA: 'd0000000-0000-0000-0000-0000000000a1',
  partnerB: 'd0000000-0000-0000-0000-0000000000b1',
  partnerC: 'd0000000-0000-0000-0000-0000000000c1',
}

export function demoSnapshot(today: Day = Days.today): Snapshot {
  const ws = DemoIds.workspace
  const { partnerA, partnerB, partnerC } = DemoIds
  const d = (offset: number) => Days.adding(offset, today)
  const ts = (offset: number) => d(offset) + 'T15:00:00Z'

  const s = emptySnapshot({ id: ws, name: 'Demo Flips LLC', require_review: false })
  s.members = [
    { workspace_id: ws, user_id: partnerA, role: 'owner', display_name: 'Madhan', email: 'madhan@example.com' },
    { workspace_id: ws, user_id: partnerB, role: 'partner', display_name: 'Partner B', email: 'partner.b@example.com' },
    { workspace_id: ws, user_id: partnerC, role: 'partner', display_name: 'Partner C', email: 'partner.c@example.com' },
  ]
  s.categories = defaultCategoryNames.map((name, i) => ({ id: uuid(), workspace_id: ws, name, sort_order: i + 1, archived: false }))
  const cat = (n: string) => s.categories.find((c) => c.name === n)!.id

  const project = (nickname: string, address: string, type: string, start: number, done: number, sale: number): Project => ({
    id: uuid(), workspace_id: ws, nickname, address, project_type: type, status: 'active',
    start_date: d(start), target_complete_date: d(done), target_sale_date: d(sale), notes: '',
  })
  const oak = project('Oak St Flip', '123 Oak St', 'flip', -80, 40, 70)
  const pine = project('Pine Rd New Build', 'Lot 14 Pine Rd', 'new_construction', -50, 210, 240)
  s.projects = [oak, pine]

  const budgets: [Project, string, Cents][] = [
    [oak, 'Acquisition', 18_500_000], [oak, 'Closing Costs', 650_000], [oak, 'Demolition', 400_000], [oak, 'Plumbing', 800_000],
    [oak, 'Electrical', 600_000], [oak, 'Materials', 2_500_000], [oak, 'Labor', 1_500_000], [oak, 'Permits', 150_000],
    [oak, 'Utilities', 60_000], [oak, 'Equipment Rentals', 120_000],
    [pine, 'Acquisition', 6_500_000], [pine, 'Permits', 900_000], [pine, 'Framing', 1_200_000], [pine, 'Materials', 6_000_000],
    [pine, 'Plumbing', 1_400_000], [pine, 'Electrical', 1_300_000], [pine, 'HVAC', 1_100_000], [pine, 'Equipment Rentals', 300_000],
  ]
  s.budgets = budgets.map(([p, c, amt]) => ({ workspace_id: ws, project_id: p.id, category_id: cat(c), amount_cents: amt }))

  const vendor = (name: string, kind: string, extra: Partial<Vendor> = {}): Vendor => ({
    id: uuid(), workspace_id: ws, name, kind, contact_name: '', phone: '', email: '', address: '', notes: '', ...extra,
  })
  const homeDepot = vendor('Home Depot', 'supplier')
  const lowes = vendor("Lowe's", 'supplier')
  const framer = vendor('Solid Framing LLC', 'contractor', { contact_name: 'Mike R.', phone: '555-0100', email: 'mike@solidframing.example' })
  const plumber = vendor('ABC Plumbing', 'contractor', { contact_name: 'Dana', phone: '555-0142' })
  const county = vendor('County Building Dept', 'government')
  const water = vendor('City Water', 'utility')
  const title = vendor('First Title Co.', 'other')
  s.vendors = [homeDepot, lowes, framer, plumber, county, water, title]

  const alloc = (parent: { bill_id?: string; expense_id?: string }, splits: [string, Cents][]): Allocation[] =>
    splits.map(([c, amt]) => ({ id: uuid(), workspace_id: ws, category_id: cat(c), amount_cents: amt, bill_id: null, expense_id: null, ...parent }))

  const expense = (p: Project, v: Vendor, day: number, desc: string, total: Cents, payer: string | null, splits: [string, Cents][],
    o: { method?: string; tax?: Cents; refund?: boolean } = {}): Expense => {
    const e: Expense = {
      id: uuid(), workspace_id: ws, project_id: p.id, vendor_id: v.id, expense_date: d(day), description: desc, total_cents: total,
      tax_cents: o.tax ?? 0, is_refund: o.refund ?? false, paid_by_user_id: payer, payment_method: o.method ?? 'card', reference: '',
      status: 'posted', client_id: uuid(), created_by: payer ?? partnerA, created_at: ts(day),
    }
    s.expenses.push(e)
    s.allocations.push(...alloc({ expense_id: e.id }, splits))
    return e
  }
  const bill = (p: Project, v: Vendor, day: number, due: number | null, inv: string, desc: string, total: Cents,
    splits: [string, Cents][], commitment: string | null = null): Bill => {
    const b: Bill = {
      id: uuid(), workspace_id: ws, project_id: p.id, vendor_id: v.id, commitment_id: commitment, invoice_number: inv, bill_date: d(day),
      due_date: due == null ? null : d(due), description: desc, total_cents: total, tax_cents: 0, status: 'posted', client_id: uuid(),
      created_by: partnerA, created_at: ts(day),
    }
    s.bills.push(b)
    s.allocations.push(...alloc({ bill_id: b.id }, splits))
    return b
  }
  const pay = (b: Bill, day: number, amt: Cents, payer: string | null, method: string, ref: string): BillPayment => {
    const p: BillPayment = {
      id: uuid(), workspace_id: ws, bill_id: b.id, kind: 'payment', payment_date: d(day), amount_cents: amt, paid_by_user_id: payer,
      payment_method: method, reference: ref, status: 'posted', client_id: uuid(), created_by: payer ?? partnerA, created_at: ts(day),
    }
    s.payments.push(p)
    return p
  }

  // Capital contributions (deliberately not equal).
  const contribution = (uid: string, amt: Cents, day: number, ref: string) => ({
    id: uuid(), workspace_id: ws, partner_user_id: uid, project_id: null, amount_cents: amt, contribution_date: d(day),
    payment_method: 'ach', reference: ref, notes: '', status: 'posted', client_id: uuid(), created_by: uid, created_at: ts(day),
  })
  s.contributions = [
    contribution(partnerA, 8_000_000, -90, 'Wire 1001'),
    contribution(partnerB, 8_000_000, -90, 'Wire 1002'),
    contribution(partnerC, 5_000_000, -88, 'Wire 1003'),
  ]

  // Oak St
  expense(oak, title, -80, 'Purchase price', 18_500_000, null, [['Acquisition', 18_500_000]], { method: 'wire' })
  expense(oak, title, -80, 'Buyer closing costs', 612_500, null, [['Closing Costs', 612_500]], { method: 'wire' })
  const drywall = expense(oak, homeDepot, -3, 'Drywall, screws, mud', 35_000, partnerA, [['Materials', 35_000]], { tax: 2_300 })
  expense(oak, lowes, -20, 'Vanity, faucets, tile', 231_055, partnerB, [['Materials', 181_055], ['Plumbing', 50_000]], { tax: 15_100 })
  expense(oak, lowes, -18, 'Returned extra tile', 18_000, partnerB, [['Materials', 18_000]], { refund: true })
  expense(oak, county, -60, 'Plumbing + electrical permits', 42_500, partnerC, [['Permits', 42_500]])
  expense(oak, water, -10, 'Water service', 8_820, null, [['Utilities', 8_820]], { method: 'ach' })
  const plumbBill1 = bill(oak, plumber, -45, -30, 'ABC-1001', 'Rough-in, draw 1 of 2', 450_000, [['Plumbing', 450_000]])
  pay(plumbBill1, -31, 450_000, partnerC, 'check', 'Check 1043')
  bill(oak, plumber, -25, -5, 'ABC-1007', 'Finish plumbing, draw 2 of 2', 450_000, [['Plumbing', 450_000]])

  // Pine Rd
  expense(pine, title, -50, 'Lot purchase', 6_500_000, null, [['Acquisition', 6_500_000]], { method: 'wire' })
  expense(pine, county, -40, 'Building permit + impact fees', 875_000, partnerB, [['Permits', 875_000]], { method: 'check' })
  const framing: Commitment = {
    id: uuid(), workspace_id: ws, project_id: pine.id, vendor_id: framer.id, category_id: cat('Framing'), description: 'Framing contract',
    amount_cents: 1_000_000, status: 'posted', client_id: uuid(), created_by: partnerA, created_at: ts(-30),
  }
  s.commitments.push(framing)
  s.change_orders.push({
    id: uuid(), workspace_id: ws, commitment_id: framing.id, description: 'Add covered porch framing', amount_cents: 85_000,
    status: 'pending_review', client_id: uuid(), created_by: partnerB, created_at: ts(-2),
  })
  const frameBill = bill(pine, framer, -12, 6, 'SF-210', 'Framing draw 1', 400_000, [['Framing', 400_000]], framing.id)
  const framePay = pay(frameBill, -8, 150_000, null, 'check', 'Check 2001')
  const rental = expense(pine, homeDepot, -7, 'Mini excavator, 3 days', 115_000, partnerC, [['Equipment Rentals', 115_000]])

  // Reimbursements: the LLC paid Madhan back part of the drywall receipt; Partner C asked for the excavator.
  const r1: Reimbursement = {
    id: uuid(), workspace_id: ws, partner_user_id: partnerA, amount_cents: 20_000, request_date: d(-2), paid_date: d(-1), status: 'paid',
    payment_method: 'zelle', reference: 'Zelle 8812', notes: '', client_id: uuid(), created_by: partnerB, created_at: ts(-1),
  }
  const r2: Reimbursement = {
    id: uuid(), workspace_id: ws, partner_user_id: partnerC, amount_cents: 115_000, request_date: d(-6), paid_date: null, status: 'requested',
    payment_method: 'ach', reference: '', notes: 'Excavator rental', client_id: uuid(), created_by: partnerC, created_at: ts(-6),
  }
  s.reimbursements = [r1, r2]
  s.reimbursement_items = [
    { id: uuid(), workspace_id: ws, reimbursement_id: r1.id, expense_id: drywall.id, bill_payment_id: null, amount_cents: 20_000 },
    { id: uuid(), workspace_id: ws, reimbursement_id: r2.id, expense_id: rental.id, bill_payment_id: null, amount_cents: 115_000 },
  ]

  const file = (path: string, name: string, mime: string, size: number, link: Record<string, string>, by: string, day: number) => ({
    id: uuid(), workspace_id: ws, storage_path: `${ws}/${path}`, filename: name, mime_type: mime, size_bytes: size,
    client_id: uuid(), uploaded_by: by, created_at: ts(day), ...link,
  })
  s.attachments = [
    file('demo-drywall.jpg', 'home-depot-drywall.jpg', 'image/jpeg', 182_000, { expense_id: drywall.id }, partnerA, -3),
    file('demo-sf-210.pdf', 'SF-210.pdf', 'application/pdf', 96_000, { bill_id: frameBill.id }, partnerA, -12),
    file('demo-check-2001.jpg', 'check-2001.jpg', 'image/jpeg', 120_000, { bill_payment_id: framePay.id }, partnerB, -8),
  ]
  return s
}
