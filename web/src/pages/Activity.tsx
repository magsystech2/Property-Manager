import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store'
import { emptyFilter, type ActivityFilter } from '../core/ledger'
import { allKinds, kindLabel, refKey, type EntryKind, type EntryRef } from '../core/models'
import { Money } from '../core/money'
import { EntryList, Field, Icon, PageHead, PartnerSelect, ProjectSelect, CategorySelect, Section } from '../ui/common'

// "See records" links: the list of records behind a total, kept for this browser tab.
export function recordsLink(title: string, refs: EntryRef[], explanation?: string): string {
  const key = Math.abs([...title + refs.map(refKey).join()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)
  try { sessionStorage.setItem(`ledger.records.${key}`, JSON.stringify({ title, refs, explanation })) } catch { /* ignore */ }
  return `/records?k=${key}`
}

export function RecordsPage() {
  const app = useStore()
  const [params] = useSearchParams()
  let data: { title: string; refs: EntryRef[]; explanation?: string } | null = null
  try { data = JSON.parse(sessionStorage.getItem(`ledger.records.${params.get('k')}`) ?? 'null') } catch { data = null }
  if (!data) return <PageHead title="Records" sub="This list has expired. Open it again from the total you clicked." back="/" />
  const keys = new Set(data.refs.map(refKey))
  const entries = app.ledger.entries().filter((e) => keys.has(refKey(e.ref)))
  const total = entries.filter((e) => e.status.text !== 'Void').reduce((a, e) => a + e.amount_cents, 0)
  return (
    <div className="stack">
      <PageHead title={data.title} sub={`${entries.length} record${entries.length === 1 ? '' : 's'}`} back="/" />
      {data.explanation && <div className="callout info">{data.explanation}</div>}
      <Section footer={<>Record amounts add up to {Money.format(total)}. For bills, the total above counts only what is still owed.</>}>
        <EntryList entries={entries} empty="No records." />
      </Section>
    </div>
  )
}

const statusOptions = ['Paid', 'Unpaid', 'Partly paid', 'Overdue', 'Needs approval', 'Requested', 'Approved, not paid', 'Approved', 'Recorded', 'Committed', 'Void']

export function ActivityPage() {
  const app = useStore()
  const l = app.ledger
  const [f, setF] = useState<ActivityFilter>(emptyFilter())
  const [showFilters, setShowFilters] = useState(false)
  const results = useMemo(() => l.search(f), [l, f])
  const set = (patch: Partial<ActivityFilter>) => setF({ ...f, ...patch })
  const active = f.kinds.length + [f.project_id, f.vendor_id, f.partner_id, f.category_id, f.status_text, f.from, f.to].filter(Boolean).length
  const toggleKind = (k: EntryKind) => set({ kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] })
  return (
    <div className="stack">
      <PageHead title="Activity" sub="Every receipt, bill, payment, reimbursement, contribution and contract." />
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 11, top: 11, color: 'var(--muted)' }}><Icon name="search" /></span>
          <input type="search" placeholder="Search vendor, invoice #, amount, project, partner…" value={f.text} style={{ paddingLeft: 36 }}
            onChange={(e) => set({ text: e.target.value })} aria-label="Search" />
        </div>
        <button className="btn" onClick={() => setShowFilters(!showFilters)}>Filters{active ? ` (${active})` : ''}</button>
        {active > 0 && <button className="btn link" onClick={() => setF({ ...emptyFilter(), text: f.text })}>Clear</button>}
      </div>
      {showFilters && (
        <div className="panel">
          <div className="row wrap" style={{ gap: 6 }}>
            {allKinds.map((k) => (
              <button key={k} type="button" className={`btn ${f.kinds.includes(k) ? 'primary' : ''}`} style={{ minHeight: 32, padding: '4px 10px' }} onClick={() => toggleKind(k)}>{kindLabel[k]}</button>
            ))}
          </div>
          <div className="form-grid">
            <Field label="Project"><ProjectSelect value={f.project_id} onChange={(v) => set({ project_id: v })} noneLabel="All projects" /></Field>
            <Field label="Vendor">
              <select value={f.vendor_id ?? ''} onChange={(e) => set({ vendor_id: e.target.value || null })}>
                <option value="">All vendors</option>
                {[...l.s.vendors].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Partner (whose money moved)"><PartnerSelect value={f.partner_id} onChange={(v) => set({ partner_id: v })} allowLLC llcLabel="Any" /></Field>
            <Field label="Budget category"><CategorySelect value={f.category_id} onChange={(v) => set({ category_id: v })} /></Field>
            <Field label="Status">
              <select value={f.status_text ?? ''} onChange={(e) => set({ status_text: e.target.value || null })}>
                <option value="">Any status</option>
                {statusOptions.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <div className="row">
              <Field label="From" className="grow"><input type="date" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value || null })} /></Field>
              <Field label="To" className="grow"><input type="date" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value || null })} /></Field>
            </div>
          </div>
        </div>
      )}
      <Section title={`${results.length} result${results.length === 1 ? '' : 's'}`}>
        <EntryList entries={results} empty="Nothing matches." limit={200} />
      </Section>
    </div>
  )
}
