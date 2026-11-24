import { useState } from 'react'
import { useStore } from '../store'
import { Days, Money, uuid } from '../core/money'
import { RepeatOptions, hasAccess, leftover, type EntryRef, type EntryTemplate, type Material, type Repeat } from '../core/models'
import { equalShares, profitShares } from '../core/settlement'
import { AmountInput, CategorySelect, Field, MethodSelect, ModalShell, MoneyKV, PartnerSelect, ProjectSelect, Segmented } from '../ui/common'

type Close = { onClose: () => void }
const pctText = (bps: number) => String(Math.round(bps) / 100)
const toBps = (v: string) => { const n = Number(v.replace('%', '').trim()); return v.trim() === '' || Number.isNaN(n) ? null : Math.round(n * 100) }

// ---------------------------------------------------------------------------
// Sale: sale price, selling costs and loan payoff; the LLC's net is worked out.
// ---------------------------------------------------------------------------
export function SaleForm({ projectId, onClose }: { projectId: string } & Close) {
  const app = useStore()
  const p = app.ledger.project(projectId)
  const [id] = useState(uuid())
  const [mode, setMode] = useState<'detail' | 'net'>('detail')
  const [gross, setGross] = useState(p?.expected_sale_cents ? Money.plain(p.expected_sale_cents) : '')
  const [selling, setSelling] = useState('')
  const [net, setNet] = useState('')
  const [payoff, setPayoff] = useState(p?.loan_balance_cents ? Money.plain(p.loan_balance_cents) : '')
  const [date, setDate] = useState(Days.today)
  const [notes, setNotes] = useState('')
  const [markSold, setMarkSold] = useState(true)
  const [busy, setBusy] = useState(false)
  const g = Money.parse(gross), sc = Money.parse(selling) ?? 0
  const cents = mode === 'detail' ? (g != null ? g - sc : 0) : Money.parse(net) ?? 0
  const save = async () => {
    const ws = app.workspace?.id
    if (!ws) return
    setBusy(true)
    const row = {
      id, workspace_id: ws, project_id: projectId, amount_cents: cents, sale_date: date, notes, status: 'posted', client_id: id,
      ...(mode === 'detail' ? { gross_price_cents: g, selling_costs_cents: sc } : {}),
      ...(Money.parse(payoff) ? { loan_payoff_cents: Money.parse(payoff) } : {}),
    }
    if (await app.insert({ type: 'proceeds', row }, 'Sale recorded')) {
      const cur = app.ledger.project(projectId)
      if (markSold && cur && cur.status !== 'sold') await app.saveProject({ ...cur, status: 'sold' })
      onClose()
    }
    setBusy(false)
  }
  return (
    <ModalShell title="Record the sale" onClose={onClose} onSave={save} saveTitle="Save sale" canSave={cents > 0} busy={busy}>
      <div className="panel">
        <div className="note">Project: {p?.nickname}. Take the numbers from the closing statement.</div>
        <Segmented value={mode} onChange={setMode} options={[['detail', 'Sale price and costs'], ['net', 'Net amount only']]} />
        {mode === 'detail' ? (
          <div className="form-grid">
            <Field label="Sale price"><AmountInput value={gross} onChange={setGross} autoFocus /></Field>
            <Field label="Selling costs"><AmountInput value={selling} onChange={setSelling} placeholder="Commission, seller closing costs" /></Field>
          </div>
        ) : <Field label="Net proceeds to the LLC"><AmountInput big value={net} onChange={setNet} autoFocus /></Field>}
        {mode === 'detail' && <MoneyKV label="Net proceeds to the LLC" cents={cents} bold tone={cents < 0 ? 'bad' : undefined} />}
        <div className="form-grid">
          <Field label="Loan paid off at closing"><AmountInput value={payoff} onChange={setPayoff} placeholder="0.00" /></Field>
          <Field label="Sale date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Notes" className="full"><textarea value={notes} placeholder="Buyer, title company, closing statement details" onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        {p?.status !== 'sold' && <label className="check"><input type="checkbox" checked={markSold} onChange={(e) => setMarkSold(e.target.checked)} />Mark the project as sold</label>}
        <div className="note">The loan payoff isn't a cost (the loan already paid for costs you entered). It only shows how much cash is left to distribute.</div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Distribution: money paid out to a partner from a project.
// ---------------------------------------------------------------------------
export function DistributionForm({ projectId, partnerId, amountCents, onClose }: { projectId: string; partnerId?: string | null; amountCents?: number | null } & Close) {
  const app = useStore()
  const [id] = useState(uuid())
  const [partner, setPartner] = useState<string | null>(partnerId ?? null)
  const [project, setProject] = useState<string | null>(projectId)
  const [amount, setAmount] = useState(amountCents && amountCents > 0 ? Money.plain(amountCents) : '')
  const [date, setDate] = useState(Days.today)
  const [method, setMethod] = useState('ach')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const cents = Money.parse(amount) ?? 0
  const save = async () => {
    const ws = app.workspace?.id
    if (!ws || !partner) return
    setBusy(true)
    if (await app.insert({ type: 'distribution', row: { id, workspace_id: ws, partner_user_id: partner, project_id: project, amount_cents: cents,
      distribution_date: date, payment_method: method, reference, notes, status: 'posted', client_id: id } }, 'Distribution recorded')) onClose()
    setBusy(false)
  }
  return (
    <ModalShell title="Record a distribution" onClose={onClose} onSave={save} saveTitle="Save distribution" canSave={!!partner && cents > 0} busy={busy}>
      <div className="panel">
        <Field label="Paid to"><PartnerSelect value={partner} onChange={setPartner} /></Field>
        <Field label="Amount"><AmountInput big value={amount} onChange={setAmount} autoFocus={!amountCents} /></Field>
        <div className="form-grid">
          <Field label="From project"><ProjectSelect value={project} onChange={setProject} allowNone noneLabel="LLC-wide" /></Field>
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method"><MethodSelect value={method} onChange={setMethod} /></Field>
          <Field label="Reference"><input value={reference} placeholder="Wire or check number" onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Notes" className="full"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="note">Return of capital and profit from a sale. Reimbursements for receipts a partner paid are separate (Partners → Reimburse).</div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Profit split: the LLC default, or an override for one project.
// ---------------------------------------------------------------------------
export function SharesForm({ projectId, onClose }: { projectId: string | null } & Close) {
  const app = useStore()
  const l = app.ledger
  const current = profitShares(l, projectId)
  const people = l.s.members.filter((m) => hasAccess(m) || current.shares.some((x) => x.partner_user_id === m.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(people.map((m) => [m.user_id, pctText(current.shares.find((x) => x.partner_user_id === m.user_id)?.share_bps ?? 0)])))
  const [busy, setBusy] = useState(false)
  const bps = people.map((m) => ({ partner_user_id: m.user_id, share_bps: toBps(vals[m.user_id] ?? '') ?? 0 }))
  const total = bps.reduce((a, x) => a + x.share_bps, 0)
  const bad = bps.some((x) => x.share_bps < 0 || x.share_bps > 10000)
  const ownRows = projectId ? l.s.profit_shares.some((x) => x.project_id === projectId) : l.s.profit_shares.some((x) => !x.project_id)
  const save = async (shares: typeof bps) => {
    setBusy(true)
    if (await app.setProfitShares(projectId, shares)) onClose()
    setBusy(false)
  }
  const title = projectId ? `Profit split for ${l.project(projectId)?.nickname}` : 'Default profit split'
  return (
    <ModalShell title={title} onClose={onClose} onSave={() => save(bps.filter((x) => x.share_bps > 0))} saveTitle="Save split" canSave={total === 10000 && !bad} busy={busy}
      secondary={ownRows ? <button type="button" className="btn" disabled={busy} onClick={() => save([])}>{projectId ? 'Use the LLC default' : 'Back to equal split'}</button> : undefined}>
      <div className="panel">
        <div className="note">{projectId ? 'Overrides the LLC default for this project only.' : 'Used for every project that has no split of its own.'} Each partner's capital is returned first; this split applies to the profit (or loss) after that.</div>
        {people.map((m) => (
          <Field key={m.user_id} label={m.display_name}>
            <div className="row" style={{ gap: 6 }}>
              <input inputMode="decimal" value={vals[m.user_id] ?? ''} onChange={(e) => setVals({ ...vals, [m.user_id]: e.target.value })} aria-label={`${m.display_name} share`} style={{ maxWidth: 120 }} />
              <span className="muted">%</span>
            </div>
          </Field>
        ))}
        <div className="row" style={{ gap: 8 }}>
          <span className={`grow small ${total === 10000 ? 'muted' : ''}`} style={total === 10000 ? undefined : { color: 'var(--bad)' }}>Total {pctText(total)}%{total === 10000 ? '' : ' (must be 100%)'}</span>
          <button type="button" className="btn link" onClick={() => setVals(Object.fromEntries(equalShares(people.filter(hasAccess)).map((x) => [x.partner_user_id, pctText(x.share_bps)])))}>Split equally</button>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
const num = (v: string) => { const n = Number(v.replace(/,/g, '').trim()); return v.trim() === '' ? 0 : Number.isNaN(n) ? NaN : n }
export function MaterialForm({ projectId, material, onClose }: { projectId: string; material?: Material | null } & Close) {
  const app = useStore()
  const ws = app.workspace?.id ?? ''
  const m0: Material = material ?? { id: uuid(), workspace_id: ws, project_id: projectId, name: '', unit: '', qty_bought: 0, qty_used: 0, qty_returned: 0, unit_cost_cents: 0, location: '', notes: '' }
  const [f, setF] = useState({ name: m0.name, unit: m0.unit, bought: m0.qty_bought ? String(m0.qty_bought) : '', used: m0.qty_used ? String(m0.qty_used) : '',
    returned: m0.qty_returned ? String(m0.qty_returned) : '', cost: m0.unit_cost_cents ? Money.plain(m0.unit_cost_cents) : '', location: m0.location, notes: m0.notes, project: m0.project_id })
  const [busy, setBusy] = useState(false)
  const m: Material = { ...m0, project_id: f.project, name: f.name.trim(), unit: f.unit.trim(), qty_bought: num(f.bought), qty_used: num(f.used), qty_returned: num(f.returned),
    unit_cost_cents: Money.parse(f.cost) ?? 0, location: f.location.trim(), notes: f.notes }
  const left = leftover(m)
  const problem = !m.name ? 'Name the material.' : [m.qty_bought, m.qty_used, m.qty_returned].some((q) => Number.isNaN(q) || q < 0) ? 'Quantities must be numbers, 0 or more.'
    : left < 0 ? 'Used plus returned is more than what was bought.' : null
  const save = async () => { setBusy(true); if (await app.saveMaterial(m)) onClose(); setBusy(false) }
  return (
    <ModalShell title={material ? 'Edit material' : 'Add material'} onClose={onClose} onSave={save} saveTitle="Save" canSave={!problem} busy={busy}
      secondary={material ? <button type="button" className="btn link danger" onClick={async () => { if (await app.deleteMaterial(m.id)) onClose() }}>Remove</button> : undefined}>
      <div className="panel">
        <div className="form-grid">
          <Field label="Item"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="LVP flooring, 2x4 studs…" autoFocus /></Field>
          <Field label="Unit"><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="box, sheet, each" /></Field>
          <Field label="Bought"><input inputMode="decimal" value={f.bought} onChange={(e) => setF({ ...f, bought: e.target.value })} /></Field>
          <Field label="Cost per unit"><AmountInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} /></Field>
          <Field label="Used"><input inputMode="decimal" value={f.used} onChange={(e) => setF({ ...f, used: e.target.value })} /></Field>
          <Field label="Returned to store"><input inputMode="decimal" value={f.returned} onChange={(e) => setF({ ...f, returned: e.target.value })} /></Field>
          <Field label="Project"><ProjectSelect value={f.project} onChange={(v) => v && setF({ ...f, project: v })} /></Field>
          <Field label="Where leftovers are"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Garage, Pine Rd shed" /></Field>
          <Field label="Notes" className="full"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Color, SKU, return deadline" /></Field>
        </div>
        <div className="note">{problem ?? `Leftover: ${left} ${m.unit}${m.unit_cost_cents && left > 0 ? `, worth ${Money.format(Math.round(left * m.unit_cost_cents))}` : ''}.`}</div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Templates and repeating costs
// ---------------------------------------------------------------------------
export function TemplateForm({ template, from, onClose }: { template?: EntryTemplate | null; from?: EntryRef | null } & Close) {
  const app = useStore()
  const l = app.ledger
  const ws = app.workspace?.id ?? ''
  const seed = (): EntryTemplate => {
    if (template) return template
    const base: EntryTemplate = { id: uuid(), workspace_id: ws, name: '', kind: 'receipt', payment_method: 'card', description: '', repeat: 'none', active: true, paid_by_user_id: null }
    const d = from ? app.againDraft(from) : null
    if (!d) return base
    const vendor = l.vendor(d.vendor_id)?.name ?? ''
    return { ...base, kind: d.kind, name: [vendor, l.project(d.project_id)?.nickname].filter(Boolean).join(' · '), project_id: d.project_id, vendor_id: d.vendor_id,
      category_id: d.splits.length === 1 ? d.splits[0].category_id : null, amount_cents: Money.parse(d.total_text), description: d.description,
      payment_method: d.payment_method, paid_by_user_id: d.kind === 'receipt' ? (d.payer === 'me' ? app.me : d.payer === 'llc' ? null : d.payer) : null }
  }
  const [t, setT] = useState<EntryTemplate>(seed)
  const [amount, setAmount] = useState(t.amount_cents ? Money.plain(t.amount_cents) : '')
  const [busy, setBusy] = useState(false)
  const vendors = [...l.s.vendors].sort((a, b) => a.name.localeCompare(b.name))
  const set = (patch: Partial<EntryTemplate>) => setT({ ...t, ...patch })
  const row: EntryTemplate = { ...t, name: t.name.trim(), amount_cents: Money.parse(amount), next_due: t.repeat === 'none' ? (t.next_due ?? null) : t.next_due || null }
  const problem = !row.name ? 'Name it.' : row.repeat !== 'none' && !row.next_due ? 'Pick when it’s next due.' : null
  const save = async () => { setBusy(true); if (await app.saveTemplate(row)) onClose(); setBusy(false) }
  return (
    <ModalShell title={template ? 'Edit template' : 'Save as template'} onClose={onClose} onSave={save} saveTitle="Save template" canSave={!problem} busy={busy}
      secondary={template ? <button type="button" className="btn link danger" onClick={async () => { if (await app.deleteTemplate(t.id)) onClose() }}>Remove</button> : undefined}>
      <div className="panel">
        <Field label="Name"><input value={t.name} onChange={(e) => set({ name: e.target.value })} placeholder="Oak St insurance, dumpster swap…" autoFocus={!t.name} /></Field>
        <Segmented value={t.kind} onChange={(k) => set({ kind: k as 'receipt' | 'bill' })} options={[['receipt', 'Receipt · paid'], ['bill', 'Bill · owed']]} />
        <div className="form-grid">
          <Field label="Repeats"><select value={t.repeat} onChange={(e) => set({ repeat: e.target.value as Repeat, next_due: e.target.value !== 'none' && !t.next_due ? Days.adding(30, Days.today) : t.next_due })}>{RepeatOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {t.repeat !== 'none' && <Field label="Next due"><input type="date" value={t.next_due ?? ''} onChange={(e) => set({ next_due: e.target.value || null })} /></Field>}
          <Field label="Amount (optional)"><AmountInput value={amount} onChange={setAmount} placeholder="Varies" /></Field>
          <Field label="Project"><ProjectSelect value={t.project_id} onChange={(v) => set({ project_id: v })} allowNone noneLabel="Choose when adding" /></Field>
          <Field label="Vendor"><select value={t.vendor_id ?? ''} onChange={(e) => set({ vendor_id: e.target.value || null })}><option value="">Choose when adding</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="Budget category"><CategorySelect value={t.category_id} onChange={(v) => set({ category_id: v })} /></Field>
          {t.kind === 'receipt' && <Field label="Usually paid by"><PartnerSelect value={t.paid_by_user_id} onChange={(v) => set({ paid_by_user_id: v })} allowLLC /></Field>}
          <Field label="Method"><MethodSelect value={t.payment_method} onChange={(v) => set({ payment_method: v })} /></Field>
          <Field label="Description" className="full"><input value={t.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
        {t.repeat !== 'none' && <label className="check"><input type="checkbox" checked={t.active} onChange={(e) => set({ active: e.target.checked })} />Remind us when it's due</label>}
        <div className="note">{problem ?? 'A template never posts anything by itself. When it’s due it shows on Home and the Recurring page; a partner adds it with one tap and checks the amount.'}</div>
      </div>
    </ModalShell>
  )
}
