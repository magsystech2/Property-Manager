import { useState } from 'react'
import { useStore } from '../store'
import { Days, Money, uuid } from '../core/money'
import { isActiveProject, type StatementLine } from '../core/models'
import { AmountInput, CategorySelect, Field, ModalShell, ProjectSelect, VendorInput } from '../ui/common'

type Close = { onClose: () => void }
type Part = { id: string; project_id: string | null; category_id: string | null; amount: string }

/** One store trip that covers two or more properties: one receipt per property, all matched to the charge. */
export function SplitLineForm({ line, onClose }: { line: StatementLine } & Close) {
  const app = useStore()
  const l = app.ledger
  const base = app.lineDraft(line)
  const active = l.s.projects.filter(isActiveProject)
  const [vendorId, setVendorId] = useState<string | null>(base.vendor_id)
  const [vendorName, setVendorName] = useState(base.new_vendor_name)
  const [description, setDescription] = useState(line.description)
  const half = Math.round(Math.abs(line.amount_cents) / 2)
  const [parts, setParts] = useState<Part[]>(() => [
    { id: uuid(), project_id: active[0]?.id ?? null, category_id: base.splits[0].category_id, amount: Money.plain(Math.abs(line.amount_cents) - half) },
    { id: uuid(), project_id: active[1]?.id ?? null, category_id: base.splits[0].category_id, amount: Money.plain(half) },
  ])
  const [busy, setBusy] = useState(false)
  const set = (id: string, patch: Partial<Part>) => setParts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const sum = parts.reduce((a, p) => a + (Money.parse(p.amount) ?? 0), 0)
  const left = Math.abs(line.amount_cents) - sum
  const problems = [
    !vendorId && !vendorName.trim() ? 'Choose or type a vendor.' : null,
    parts.some((p) => !p.project_id) ? 'Choose a property for each part.' : null,
    parts.some((p) => !p.category_id) ? 'Choose a budget category for each part.' : null,
    parts.some((p) => !(Money.parse(p.amount)! > 0)) ? 'Each part needs an amount.' : null,
    new Set(parts.map((p) => p.project_id)).size < parts.length ? 'Use each property once.' : null,
    left !== 0 ? `The parts must add up to ${Money.format(Math.abs(line.amount_cents))} (${Money.format(Math.abs(left))} ${left > 0 ? 'left' : 'too much'}).` : null,
  ].filter(Boolean) as string[]
  const save = async () => {
    setBusy(true)
    const drafts = parts.map((p) => {
      const d = app.lineDraft(line, p.project_id)
      d.id = p.id // same id on a retry, so a part that already saved isn't saved twice
      d.vendor_id = vendorId
      d.new_vendor_name = vendorId ? '' : vendorName.trim()
      d.new_vendor_id = base.new_vendor_id // every part reuses one new vendor
      d.total_text = p.amount
      d.description = description
      d.splits = [{ id: uuid(), category_id: p.category_id, amount_text: '' }]
      return d
    })
    if (await app.splitLine(line, drafts)) onClose()
    setBusy(false)
  }
  return (
    <ModalShell title="Split across properties" onClose={onClose} onSave={save} saveTitle={`Save ${parts.length} receipts`} canSave={!problems.length} busy={busy}>
      <div className="callout info"><strong>{line.description}</strong> · {Days.display(line.posted_date)} · {Money.format(line.amount_cents)} · {line.account}{line.account_owner ? ` (${l.payerName(line.account_owner)} paid)` : ' (LLC account)'}</div>
      <div className="panel">
        <Field label="Vendor"><VendorInput vendorId={vendorId} newName={vendorName} onChange={(id, name) => { setVendorId(id); setVendorName(name) }} /></Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="panel">
        {parts.map((p, i) => (
          <div key={p.id} className="form-grid" style={{ alignItems: 'end' }}>
            <Field label={`Property ${i + 1}`}><ProjectSelect value={p.project_id} onChange={(v) => set(p.id, { project_id: v })} /></Field>
            <Field label="Category"><CategorySelect value={p.category_id} onChange={(v) => set(p.id, { category_id: v })} /></Field>
            <Field label="Amount"><AmountInput value={p.amount} onChange={(v) => set(p.id, { amount: v })} /></Field>
            {parts.length > 2 && <button type="button" className="btn link danger" onClick={() => setParts((ps) => ps.filter((x) => x.id !== p.id))}>Remove</button>}
          </div>
        ))}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => setParts((ps) => [...ps, { id: uuid(), project_id: null, category_id: null, amount: left > 0 ? Money.plain(left) : '' }])}>+ Add a property</button>
          <span className={`small ${left === 0 ? 'muted' : ''}`} style={left !== 0 ? { color: 'var(--warn)' } : undefined}>{left === 0 ? 'Adds up to the charge' : `${Money.format(Math.abs(left))} ${left > 0 ? 'left to split' : 'over the charge'}`}</span>
        </div>
      </div>
      {problems.length > 0 && <div className="field-error">{problems[0]}</div>}
      <div className="note">Each property gets its own receipt with the same vendor, date and payer, so budgets and partner balances stay right. All of them are matched to this charge.</div>
    </ModalShell>
  )
}

/** A contractor draw expected on a date, for the 30-day cash view. */
export function DrawForm({ commitmentId, onClose }: { commitmentId: string } & Close) {
  const app = useStore()
  const l = app.ledger
  const c = l.s.commitments.find((x) => x.id === commitmentId)
  const st = c ? l.commitmentStatus(c) : null
  const [date, setDate] = useState(Days.adding(14, Days.today))
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const cents = Money.parse(amount) ?? 0
  const save = async () => {
    if (!c) return
    setBusy(true)
    if (await app.saveDraw({ id: uuid(), workspace_id: c.workspace_id, commitment_id: c.id, due_date: date, amount_cents: cents, description: description.trim() })) onClose()
    setBusy(false)
  }
  return (
    <ModalShell title="Schedule a draw" onClose={onClose} onSave={save} saveTitle="Save draw" canSave={cents > 0 && !!date} busy={busy}>
      <div className="panel">
        {c && st && <div className="note">{l.vendor(c.vendor_id)?.name} · {l.project(c.project_id)?.nickname} · {Money.format(st.unbilled_cents)} not billed yet</div>}
        <div className="form-grid">
          <Field label="Expected date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Amount"><AmountInput value={amount} onChange={setAmount} /></Field>
          <Field label="What it's for" className="full"><input value={description} placeholder="Draw 2: rough-in complete" onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="note">Draws only feed the cash forecast. When the contractor invoices, enter the bill as usual; the forecast never counts more than what's still unbilled on the agreement.</div>
      </div>
    </ModalShell>
  )
}
