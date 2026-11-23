// Receipt (already paid) or bill (still owed), with category split and documents.
import { useState } from 'react'
import { useStore } from '../store'
import { Money, uuid } from '../core/money'
import { isActiveProject } from '../core/models'
import { unallocated, type TransactionDraft } from '../drafts'
import { AmountInput, CategorySelect, EntryRow, Field, FilePicker, MethodSelect, ModalShell, ProjectSelect, Segmented, VendorInput } from '../ui/common'

export function TransactionForm({ initial, initialFiles, onClose, note }: { initial: TransactionDraft; initialFiles?: File[]; onClose: () => void; note?: string }) {
  const app = useStore()
  const l = app.ledger
  const [d, setD] = useState<TransactionDraft>(() => {
    const x = { ...initial }
    const active = l.s.projects.filter(isActiveProject)
    if (!x.project_id && active.length === 1) x.project_id = active[0].id
    return x
  })
  const [files, setFiles] = useState<File[]>(initialFiles ?? [])
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<TransactionDraft>) => setD((p) => ({ ...p, ...patch }))
  const total = Money.parse(d.total_text) ?? -1
  const dupes = l.possibleDuplicates(d.vendor_id, d.date, total, d.invoice_number, d.id)
  const isSavedDraft = app.draftList.some((x) => x.id === d.id)
  const left = unallocated(d)
  const contracts = l.s.commitments.filter((c) => c.status !== 'void' && c.project_id === d.project_id && c.vendor_id === d.vendor_id)
  const others = l.s.members.filter((m) => m.user_id !== app.me)

  const post = async () => {
    setBusy(true)
    const ok = await app.submit(d, files)
    setBusy(false)
    if (ok) onClose()
  }
  const saveDraft = () => {
    app.saveDraft({ ...d, error: null })
    app.showToast(files.length ? 'Draft saved. Documents aren’t kept with drafts.' : 'Draft saved in this browser')
    onClose()
  }
  const close = () => {
    const hasContent = d.total_text || files.length || d.vendor_id || d.new_vendor_name
    if (!isSavedDraft && hasContent) {
      if (confirm('Save this as a draft before closing? Press Cancel to discard it.')) return saveDraft()
    }
    onClose()
  }

  return (
    <ModalShell title={isSavedDraft ? (d.kind === 'bill' ? 'Bill draft' : 'Receipt draft') : d.kind === 'bill' ? 'Add bill' : 'Add expense'}
      onClose={close} onSave={post} busy={busy} saveTitle={d.kind === 'bill' ? 'Post bill' : 'Post receipt'}
      secondary={<button type="button" className="btn big" onClick={saveDraft}>Save draft</button>}>
      {note && <div className="callout info">{note}</div>}
      <div className="panel">
        <Segmented value={d.kind} onChange={(k) => set({ kind: k, payer: k === 'bill' ? 'llc' : d.payer })}
          options={[['receipt', 'Receipt · already paid'], ['bill', 'Bill · still owed']]} />
        <Field label="Total"><AmountInput big value={d.total_text} onChange={(v) => set({ total_text: v })} autoFocus={!d.total_text} /></Field>
        <div className="form-grid">
          <Field label="Project"><ProjectSelect value={d.project_id} onChange={(v) => set({ project_id: v, commitment_id: null })} /></Field>
          <Field label={d.kind === 'bill' ? 'Invoice date' : 'Date'}><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} required /></Field>
          <Field label="Vendor" className="full"><VendorInput vendorId={d.vendor_id} newName={d.new_vendor_name} onChange={(id, name) => set({ vendor_id: id, new_vendor_name: name, commitment_id: null })} /></Field>
        </div>
      </div>

      {dupes.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--warn)' }}>
          <div className="warn bold">Possible duplicate</div>
          <div className="card list">{dupes.map((e) => <EntryRow key={e.ref.id} entry={e} />)}</div>
          <div className="note">Same vendor with the same invoice number, or the same amount within 3 days. Post anyway only if this is a different purchase.</div>
        </div>
      )}

      {d.kind === 'receipt' ? (
        <div className="panel">
          <h2>Who paid</h2>
          <Segmented value={d.payer} onChange={(v) => set({ payer: v })}
            options={[['me', 'Me'], ['llc', 'LLC account'], ...others.map((m) => [m.user_id, m.display_name] as [string, string])]} />
          <div className="form-grid">
            <Field label="Method"><MethodSelect value={d.payment_method} onChange={(v) => set({ payment_method: v })} /></Field>
            <Field label="Reference"><input value={d.reference} placeholder="Last 4, check #, receipt #" onChange={(e) => set({ reference: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={d.is_refund} onChange={(e) => set({ is_refund: e.target.checked })} />This is a refund from the vendor</label>
          {d.payer !== 'llc' && <div className="note">Paid personally: the LLC will owe {d.payer === 'me' ? 'you' : l.payerName(d.payer)} this amount until it's reimbursed.</div>}
        </div>
      ) : (
        <div className="panel">
          <h2>Bill details</h2>
          <div className="form-grid">
            <Field label="Invoice number"><input value={d.invoice_number} onChange={(e) => set({ invoice_number: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" value={d.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} /></Field>
            {contracts.length > 0 && (
              <Field label="Against contract" className="full">
                <select value={d.commitment_id ?? ''} onChange={(e) => {
                  const c = contracts.find((x) => x.id === e.target.value)
                  set({ commitment_id: e.target.value || null, ...(c && d.splits.length === 1 && !d.splits[0].category_id ? { splits: [{ ...d.splits[0], category_id: c.category_id }] } : {}) })
                }}>
                  <option value="">None</option>
                  {contracts.map((c) => <option key={c.id} value={c.id}>{c.description || 'Contract'} ({Money.format(l.commitmentStatus(c).unbilled_cents, false)} left)</option>)}
                </select>
              </Field>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Budget category</h2>
        {d.splits.length === 1 ? (
          <>
            <CategorySelect value={d.splits[0].category_id} onChange={(v) => set({ splits: [{ ...d.splits[0], category_id: v }] })} />
            <button type="button" className="btn link" style={{ alignSelf: 'flex-start' }}
              onClick={() => set({ splits: [{ ...d.splits[0], amount_text: d.total_text }, { id: uuid(), category_id: null, amount_text: '' }] })}>
              Split across categories
            </button>
          </>
        ) : (
          <>
            {d.splits.map((line, i) => (
              <div key={line.id} className="row">
                <div style={{ flex: 2 }}><CategorySelect value={line.category_id} onChange={(v) => set({ splits: d.splits.map((x, j) => (j === i ? { ...x, category_id: v } : x)) })} /></div>
                <div style={{ flex: 1 }}><AmountInput value={line.amount_text} onChange={(v) => set({ splits: d.splits.map((x, j) => (j === i ? { ...x, amount_text: v } : x)) })} /></div>
                <button type="button" className="btn link danger" aria-label="Remove line" onClick={() => {
                  const rest = d.splits.filter((_, j) => j !== i)
                  set({ splits: rest.length === 1 ? [{ ...rest[0], amount_text: '' }] : rest })
                }}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn link" style={{ alignSelf: 'flex-start' }}
              onClick={() => set({ splits: [...d.splits, { id: uuid(), category_id: null, amount_text: left > 0 ? Money.plain(left) : '' }] })}>+ Add category</button>
            {left === 0 ? <div className="callout good">Split matches the total</div>
              : <div className="callout warn">{left > 0 ? `${Money.format(left)} still to assign` : `${Money.format(-left)} more than the total`}</div>}
          </>
        )}
      </div>

      <div className="panel">
        <div className="form-grid">
          <Field label="Tax included"><AmountInput value={d.tax_text} onChange={(v) => set({ tax_text: v })} /></Field>
          <Field label="Description" className="full"><textarea value={d.description} placeholder="What was it for?" onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
      </div>

      <FilePicker files={files} onChange={setFiles} title="Receipt photos and PDFs" />
    </ModalShell>
  )
}
