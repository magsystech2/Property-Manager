// Receipt / bill drafts kept in this browser until posted. Files picked for a draft are kept
// in memory only, so a saved draft keeps its fields but not its documents.
import { Money, Days, uuid, type Cents } from './core/money'

export interface SplitLine { id: string; category_id: string | null; amount_text: string }

export interface TransactionDraft {
  id: string
  kind: 'receipt' | 'bill'
  total_text: string
  project_id: string | null
  vendor_id: string | null
  new_vendor_name: string
  new_vendor_id: string
  date: string
  payer: string // 'me' | 'llc' | partner user id
  payment_method: string
  reference: string
  is_refund: boolean
  invoice_number: string
  due_date: string | null
  commitment_id: string | null
  splits: SplitLine[]
  tax_text: string
  description: string
  updated_at: string
  error?: string | null
}

export function newDraft(kind: 'receipt' | 'bill' = 'receipt', projectId: string | null = null): TransactionDraft {
  return {
    id: uuid(), kind, total_text: '', project_id: projectId, vendor_id: null, new_vendor_name: '', new_vendor_id: uuid(),
    date: Days.today, payer: kind === 'bill' ? 'llc' : 'me', payment_method: 'card', reference: '', is_refund: false,
    invoice_number: '', due_date: null, commitment_id: null, splits: [{ id: uuid(), category_id: null, amount_text: '' }],
    tax_text: '', description: '', updated_at: new Date().toISOString(),
  }
}

export const draftTotal = (d: TransactionDraft): Cents | null => Money.parse(d.total_text)

/** Category split for posting: one line takes the whole total. */
export function draftAllocations(d: TransactionDraft) {
  const total = draftTotal(d) ?? 0
  if (d.splits.length === 1) return d.splits[0].category_id ? [{ category_id: d.splits[0].category_id, amount_cents: total }] : []
  return d.splits.filter((s) => s.category_id).map((s) => ({ category_id: s.category_id!, amount_cents: Money.parse(s.amount_text) ?? 0 }))
}

export function unallocated(d: TransactionDraft): Cents {
  const total = draftTotal(d) ?? 0
  if (d.splits.length <= 1) return 0
  return total - d.splits.reduce((a, s) => a + (Money.parse(s.amount_text) ?? 0), 0)
}

export class DraftStore {
  constructor(private ns: string) {}
  private get key() { return `ledger.drafts.${this.ns}` }
  all(): TransactionDraft[] {
    try { return JSON.parse(localStorage.getItem(this.key) ?? '[]') } catch { return [] }
  }
  save(d: TransactionDraft) {
    const list = this.all().filter((x) => x.id !== d.id)
    list.push({ ...d, updated_at: new Date().toISOString() })
    try { localStorage.setItem(this.key, JSON.stringify(list)) } catch { /* ignore */ }
  }
  remove(id: string) {
    try { localStorage.setItem(this.key, JSON.stringify(this.all().filter((x) => x.id !== id))) } catch { /* ignore */ }
  }
}
