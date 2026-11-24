import { useEffect, useRef, useState } from 'react'
import { type AttachTarget, useStore } from '../store'
import { Days, Money, uuid } from '../core/money'
import { Rules } from '../core/rules'
import { parseVoice } from '../core/parsers'
import { newDraft } from '../drafts'
import {
  ProjectStatuses, ProjectTypes, VendorKinds, paymentKindLabel, refKey, type BillPayment, type EntryRef, type Project, type Vendor,
} from '../core/models'
import { AmountInput, CategorySelect, Field, FilePicker, MethodSelect, ModalShell, MoneyKV, PartnerSelect, ProjectSelect, Segmented, VendorInput } from '../ui/common'

type Close = { onClose: () => void }

// ---------------------------------------------------------------------------
// Bill payment
// ---------------------------------------------------------------------------
export function PaymentForm({ billId: initialBill, onClose }: { billId?: string | null } & Close) {
  const app = useStore()
  const l = app.ledger
  const [id] = useState(uuid()) // fixed per form: a second click can't create a second payment
  const open = l.s.bills.filter((b) => b.status === 'posted' && l.balance(b.id).outstanding_cents > 0)
    .sort((a, b) => (a.due_date ?? a.bill_date).localeCompare(b.due_date ?? b.bill_date))
  const [billId, setBillId] = useState<string | null>(initialBill ?? (open.length === 1 ? open[0].id : null))
  const [kind, setKind] = useState('payment')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(Days.today)
  const [payer, setPayer] = useState<string | null>(null)
  const [method, setMethod] = useState('check')
  const [reference, setReference] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const bal = billId ? l.balance(billId) : null
  const cents = Money.parse(amount) ?? 0
  const similar = billId ? l.paymentsForBill(billId).filter((p) => p.status !== 'void' && p.amount_cents === cents && Math.abs(Days.daysBetween(p.payment_date, date)) <= 3) : []
  const label = (bid: string) => {
    const b = l.bill(bid)!
    return `${l.vendor(b.vendor_id)?.name ?? 'Vendor'}${b.invoice_number ? ` #${b.invoice_number}` : ''} · ${l.project(b.project_id)?.nickname ?? ''} · owes ${Money.format(l.balance(b.id).outstanding_cents)}`
  }
  const draft = (): BillPayment | null => {
    const ws = app.workspace?.id
    if (!ws || !billId) return null
    return { id, workspace_id: ws, bill_id: billId, kind, payment_date: date, amount_cents: cents,
      paid_by_user_id: kind === 'credit' ? null : payer, payment_method: method, reference, status: 'posted', client_id: id }
  }
  // Checked as you type, shown under the amount, and gone as soon as the amount is valid.
  let amountError: string | null = null
  if (amount.trim()) {
    const d = draft()
    if (Money.parse(amount) == null) amountError = 'Enter an amount like 250 or 1,250.50.'
    else if (d) { try { Rules.checkPayment(d, l) } catch (e) { amountError = (e as Error).message } }
  }
  const save = async () => {
    const p = draft()
    if (!p || amountError) return
    setBusy(true)
    if (await app.insert({ type: 'payment', row: p }, `${paymentKindLabel(kind)} recorded`)) {
      await app.attach(files, { kind: 'payment', id })
      onClose()
    }
    setBusy(false)
  }
  return (
    <ModalShell title="Record payment" onClose={onClose} onSave={save} saveTitle="Save payment" canSave={!!billId && cents > 0 && !amountError} busy={busy}>
      <div className="panel">
        <Field label="Bill">
          <select value={billId ?? ''} onChange={(e) => setBillId(e.target.value || null)}>
            <option value="">Choose a bill…</option>
            {billId && !open.some((b) => b.id === billId) && <option value={billId}>{label(billId)}</option>}
            {open.map((b) => <option key={b.id} value={b.id}>{label(b.id)}</option>)}
          </select>
        </Field>
        {open.length === 0 && !billId && <div className="note">No unpaid bills. Add the bill first, then record its payment.</div>}
        {bal && <div className="card list"><MoneyKV label="Still owed on this bill" cents={bal.outstanding_cents} bold /></div>}
      </div>
      <div className="panel">
        <Segmented value={kind} onChange={setKind} options={[['payment', 'Payment'], ['credit', 'Vendor credit'], ['refund', 'Vendor refund']]} />
        <Field label="Amount"><AmountInput big value={amount} onChange={setAmount} /></Field>
        {amountError && <div className="field-error" role="alert">{amountError}</div>}
        {bal && kind === 'payment' && <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAmount(Money.plain(bal.outstanding_cents))}>Pay full balance {Money.format(bal.outstanding_cents)}</button>}
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="note">{kind === 'credit' ? 'A credit memo lowers what you owe without any cash moving.'
          : kind === 'refund' ? "Money the vendor gave back. Raises the bill's balance and lowers paid costs."
            : "Partial payments are fine. The app won't let payments exceed what's owed."}</div>
      </div>
      {kind !== 'credit' && (
        <div className="panel">
          <div className="form-grid">
            <Field label={kind === 'refund' ? 'Refund went to' : 'Paid by'}><PartnerSelect value={payer} onChange={setPayer} allowLLC /></Field>
            <Field label="Method"><MethodSelect value={method} onChange={setMethod} /></Field>
            <Field label="Reference" className="full"><input value={reference} placeholder="Check #, confirmation #…" onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
          {payer && kind === 'payment' && <div className="note">Paid personally: the LLC will owe {l.payerName(payer)} this amount until it's reimbursed.</div>}
        </div>
      )}
      {similar.length > 0 && <div className="callout warn">A {Money.format(cents)} payment on this bill was already recorded on {Days.display(similar[0].payment_date)}. Make sure this isn't the same payment.</div>}
      <FilePicker files={files} onChange={setFiles} title="Payment confirmation" />
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Contribution
// ---------------------------------------------------------------------------
export function ContributionForm({ projectId, partnerId, onClose }: { projectId?: string | null; partnerId?: string | null } & Close) {
  const app = useStore()
  const [id] = useState(uuid())
  const [partner, setPartner] = useState<string | null>(partnerId ?? app.me)
  const [project, setProject] = useState<string | null>(projectId ?? null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(Days.today)
  const [method, setMethod] = useState('ach')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const cents = Money.parse(amount) ?? 0
  const save = async () => {
    const ws = app.workspace?.id
    if (!ws || !partner) return
    setBusy(true)
    const ok = await app.insert({ type: 'contribution', row: { id, workspace_id: ws, partner_user_id: partner, project_id: project, amount_cents: cents,
      contribution_date: date, payment_method: method, reference, notes, status: 'posted', client_id: id } }, 'Contribution saved')
    if (ok) { await app.attach(files, { kind: 'contribution', id }); onClose() }
    setBusy(false)
  }
  return (
    <ModalShell title="Add contribution" onClose={onClose} onSave={save} saveTitle="Save contribution" canSave={!!partner && cents > 0} busy={busy}>
      <div className="panel">
        <Field label="Partner"><PartnerSelect value={partner} onChange={setPartner} /></Field>
        <Field label="Amount"><AmountInput big value={amount} onChange={setAmount} autoFocus /></Field>
        <div className="form-grid">
          <Field label="Project"><ProjectSelect value={project} onChange={setProject} allowNone /></Field>
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method"><MethodSelect value={method} onChange={setMethod} /></Field>
          <Field label="Reference"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="Notes" className="full"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="note">Capital a partner put into the LLC. Kept separate from reimbursements and from sale proceeds.</div>
      </div>
      <FilePicker files={files} onChange={setFiles} title="Deposit confirmation" />
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Reimbursement
// ---------------------------------------------------------------------------
export function ReimbursementForm({ partnerId, onClose }: { partnerId?: string | null } & Close) {
  const app = useStore()
  const l = app.ledger
  const review = app.workspace?.require_review ?? false
  const [id] = useState(uuid())
  const [partner, setPartner] = useState<string | null>(partnerId ?? null)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [manual, setManual] = useState('')
  const [payNow, setPayNow] = useState(true)
  const [date, setDate] = useState(Days.today)
  const [method, setMethod] = useState('ach')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const owed = partner ? l.partnerBalance(partner).owed_cents : 0
  const items = partner ? l.reimbursableItems(partner) : []
  const keys = Object.keys(selected)
  const total = keys.length === 0 ? (Money.parse(manual) ?? 0) : keys.reduce((a, k) => a + (Money.parse(selected[k]) ?? 0), 0)
  const paid = payNow && !review
  const save = async () => {
    const ws = app.workspace?.id
    if (!ws || !partner) return
    const r = { id, workspace_id: ws, partner_user_id: partner, amount_cents: total, request_date: Days.today, paid_date: paid ? date : null,
      status: paid ? 'paid' : 'requested', payment_method: method, reference, notes, client_id: id }
    if (paid) { try { Rules.checkReimbursementPaid(r, l) } catch (e) { return app.showError(e) } }
    const rows = items.filter((i) => selected[refKey(i.ref)] != null).map((i) => ({
      id: uuid(), workspace_id: ws, reimbursement_id: id, expense_id: i.ref.kind === 'expense' ? i.ref.id : null,
      bill_payment_id: i.ref.kind === 'payment' ? i.ref.id : null, amount_cents: Money.parse(selected[refKey(i.ref)]) ?? 0,
    })).filter((x) => x.amount_cents > 0)
    setBusy(true)
    if (await app.insert({ type: 'reimbursement', row: r, items: rows }, paid ? 'Reimbursement saved' : 'Reimbursement requested')) {
      await app.attach(files, { kind: 'reimbursement', id })
      onClose()
    }
    setBusy(false)
  }
  return (
    <ModalShell title="Reimbursement" onClose={onClose} onSave={save} saveTitle={paid ? 'Save reimbursement' : 'Request reimbursement'} canSave={!!partner && total > 0} busy={busy}>
      <div className="panel">
        <Field label="Partner"><PartnerSelect value={partner} onChange={(v) => { setPartner(v); setSelected({}) }} /></Field>
        {partner && <div className="card list"><MoneyKV label="LLC owes them" cents={owed} bold /></div>}
      </div>
      {items.length > 0 && (
        <div className="panel">
          <div className="row"><h2>What it covers</h2><span className="spacer" />
            <button type="button" className="btn link" onClick={() => setSelected(Object.fromEntries(items.map((i) => [refKey(i.ref), Money.plain(i.remaining_cents)])))}>Select all</button></div>
          {items.map((i) => {
            const k = refKey(i.ref)
            const on = selected[k] != null
            return (
              <div key={k} className="stack" style={{ gap: 6 }}>
                <label className="check">
                  <input type="checkbox" checked={on} onChange={(e) => {
                    const next = { ...selected }
                    if (e.target.checked) next[k] = Money.plain(i.remaining_cents)
                    else delete next[k]
                    setSelected(next)
                  }} />
                  <span>{i.entry.title}<div className="small muted">{Days.display(i.entry.date)} · {l.project(i.entry.project_id)?.nickname ?? ''} · {Money.format(i.remaining_cents)} open</div></span>
                </label>
                {on && <div style={{ paddingLeft: 28 }}><AmountInput value={selected[k]} onChange={(v) => setSelected({ ...selected, [k]: v })} /></div>}
              </div>
            )
          })}
          <div className="note">Pick one or several expenses. Lower an amount for a partial reimbursement.</div>
        </div>
      )}
      <div className="panel">
        {keys.length === 0 ? <Field label="Amount (or pick items above)"><AmountInput big value={manual} onChange={setManual} /></Field>
          : <div className="card list"><MoneyKV label="Total" cents={total} bold /></div>}
        {partner && total > owed && <div className="callout warn">That's more than the {Money.format(owed)} the LLC owes.</div>}
      </div>
      <div className="panel">
        {review ? <div className="callout info">Review is on: another partner approves this, then it's marked paid.</div>
          : <Segmented value={payNow ? 'paid' : 'req'} onChange={(v) => setPayNow(v === 'paid')} options={[['paid', 'Already paid'], ['req', 'Request']]} />}
        {paid && (
          <div className="form-grid">
            <Field label="Paid on"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Method"><MethodSelect value={method} onChange={setMethod} /></Field>
            <Field label="Reference" className="full"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          </div>
        )}
        <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="note">Records money the LLC paid the partner outside the app. It lowers what's owed and never changes project costs.</div>
      </div>
      <FilePicker files={files} onChange={setFiles} />
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Commitment, change order, sale proceeds
// ---------------------------------------------------------------------------
export function CommitmentForm({ projectId, onClose }: { projectId?: string | null } & Close) {
  const app = useStore()
  const [id] = useState(uuid())
  const [newVendorId] = useState(uuid())
  const [project, setProject] = useState<string | null>(projectId ?? null)
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [newVendor, setNewVendor] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const cents = Money.parse(amount) ?? 0
  const ok = !!project && (!!vendorId || !!newVendor.trim()) && !!category && cents > 0
  const save = async () => {
    const ws = app.workspace?.id
    if (!ws || !project || !category) return
    setBusy(true)
    let vid = vendorId
    if (!vid) {
      const existing = app.ledger.s.vendors.find((v) => v.name.toLowerCase() === newVendor.trim().toLowerCase())
      if (existing) vid = existing.id
      else if (await app.saveVendor({ id: newVendorId, workspace_id: ws, name: newVendor.trim(), kind: 'contractor', contact_name: '', phone: '', email: '', address: '', notes: '' })) vid = newVendorId
    }
    if (vid) {
      setVendorId(vid)
      if (await app.insert({ type: 'commitment', row: { id, workspace_id: ws, project_id: project, vendor_id: vid, category_id: category, description: description.trim(),
        amount_cents: cents, status: 'posted', client_id: id } }, 'Commitment saved')) {
        await app.attach(files, { kind: 'commitment', id })
        onClose()
      }
    }
    setBusy(false)
  }
  return (
    <ModalShell title="Commitment" onClose={onClose} onSave={save} saveTitle="Save commitment" canSave={ok} busy={busy}>
      <div className="panel">
        <div className="form-grid">
          <Field label="Project"><ProjectSelect value={project} onChange={setProject} /></Field>
          <Field label="Budget category"><CategorySelect value={category} onChange={setCategory} /></Field>
          <Field label="Vendor or contractor" className="full"><VendorInput vendorId={vendorId} newName={newVendor} onChange={(i, n) => { setVendorId(i); setNewVendor(n) }} /></Field>
          <Field label="Scope" className="full"><input value={description} placeholder="e.g. Full rough-in plumbing" onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <Field label="Agreed amount"><AmountInput big value={amount} onChange={setAmount} /></Field>
        <div className="note">A contract or quote you've agreed to. It counts toward projected spend as “committed, not billed” until invoices arrive.</div>
      </div>
      <FilePicker files={files} onChange={setFiles} title="Contract or quote" />
    </ModalShell>
  )
}

export function ChangeOrderForm({ commitmentId, onClose }: { commitmentId: string } & Close) {
  const app = useStore()
  const [id] = useState(uuid())
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [reduces, setReduces] = useState(false)
  const [busy, setBusy] = useState(false)
  const c = app.ledger.s.commitments.find((x) => x.id === commitmentId)
  const cents = Money.parse(amount) ?? 0
  const save = async () => {
    const ws = app.workspace?.id
    if (!ws) return
    setBusy(true)
    if (await app.insert({ type: 'changeOrder', row: { id, workspace_id: ws, commitment_id: commitmentId, description: description.trim(),
      amount_cents: reduces ? -cents : cents, status: 'posted', client_id: id } }, 'Change order saved')) onClose()
    setBusy(false)
  }
  return (
    <ModalShell title="Change order" onClose={onClose} onSave={save} saveTitle="Save change order" canSave={cents > 0} busy={busy}>
      <div className="panel">
        {c && <div className="note">Contract: {app.ledger.vendor(c.vendor_id)?.name} · {c.description}</div>}
        <Field label="What changed?"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Amount"><AmountInput big value={amount} onChange={setAmount} /></Field>
        <label className="check"><input type="checkbox" checked={reduces} onChange={(e) => setReduces(e.target.checked)} />This reduces the contract</label>
        <div className="note">{app.workspace?.require_review ? 'Another partner must approve this before it counts.' : "Approved change orders adjust the contract's unbilled amount."}</div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Project, budget, vendor
// ---------------------------------------------------------------------------
export function ProjectForm({ project, onClose }: { project?: Project | null } & Close) {
  const app = useStore()
  const [p, setP] = useState<Project>(project ?? { id: uuid(), workspace_id: app.workspace!.id, nickname: '', address: '', project_type: 'flip', status: 'active',
    start_date: null, target_complete_date: null, target_sale_date: null, notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Project>) => setP({ ...p, ...patch })
  const save = async () => { setBusy(true); if (await app.saveProject({ ...p, nickname: p.nickname.trim() })) onClose(); setBusy(false) }
  return (
    <ModalShell title={project ? 'Edit project' : 'New project'} onClose={onClose} onSave={save} canSave={!!p.nickname.trim()} busy={busy}>
      <div className="panel">
        <div className="form-grid">
          <Field label="Nickname" className="full"><input value={p.nickname} placeholder="e.g. Oak St Flip" onChange={(e) => set({ nickname: e.target.value })} autoFocus /></Field>
          <Field label="Address" className="full"><input value={p.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="Type"><select value={p.project_type} onChange={(e) => set({ project_type: e.target.value })}>{ProjectTypes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Status"><select value={p.status} onChange={(e) => set({ status: e.target.value })}>{ProjectStatuses.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Start date"><input type="date" value={p.start_date ?? ''} onChange={(e) => set({ start_date: e.target.value || null })} /></Field>
          <Field label="Target completion"><input type="date" value={p.target_complete_date ?? ''} onChange={(e) => set({ target_complete_date: e.target.value || null })} /></Field>
          <Field label="Target sale"><input type="date" value={p.target_sale_date ?? ''} onChange={(e) => set({ target_sale_date: e.target.value || null })} /></Field>
          <Field label="Notes" className="full"><textarea value={p.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </div>
    </ModalShell>
  )
}

export function BudgetEditor({ projectId, onClose }: { projectId: string } & Close) {
  const app = useStore()
  const l = app.ledger
  const cats = l.activeCategories
  const existing = new Map(l.s.budgets.filter((b) => b.project_id === projectId).map((b) => [b.category_id, b.amount_cents]))
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries([...existing].map(([k, v]) => [k, Money.plain(v)])))
  const [busy, setBusy] = useState(false)
  const total = cats.reduce((a, c) => a + (Money.parse(amounts[c.id]) ?? 0), 0)
  const save = async () => {
    const ws = app.workspace!.id
    const changed = cats.map((c) => ({ c, v: Math.max(Money.parse(amounts[c.id]) ?? 0, 0) })).filter(({ c, v }) => v !== (existing.get(c.id) ?? 0))
      .map(({ c, v }) => ({ workspace_id: ws, project_id: projectId, category_id: c.id, amount_cents: v }))
    setBusy(true)
    if (await app.saveBudgets(changed)) onClose()
    setBusy(false)
  }
  return (
    <ModalShell title={`Budget · ${l.project(projectId)?.nickname ?? ''}`} onClose={onClose} onSave={save} busy={busy}>
      <div className="card list"><MoneyKV label="Total budget" cents={total} bold /></div>
      <div className="panel">
        {cats.map((c) => (
          <div key={c.id} className="row">
            <span style={{ flex: 1 }}>{c.name}</span>
            <div style={{ width: 180 }}><AmountInput value={amounts[c.id] ?? ''} onChange={(v) => setAmounts({ ...amounts, [c.id]: v })} /></div>
          </div>
        ))}
        <div className="note">Categories are shared by all projects. Rename, add or hide them in Settings.</div>
      </div>
    </ModalShell>
  )
}

export function VendorForm({ vendor, onClose }: { vendor?: Vendor | null } & Close) {
  const app = useStore()
  const [v, setV] = useState<Vendor>(vendor ?? { id: uuid(), workspace_id: app.workspace!.id, name: '', kind: 'contractor', contact_name: '', phone: '', email: '', address: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Vendor>) => setV({ ...v, ...patch })
  const save = async () => { setBusy(true); if (await app.saveVendor({ ...v, name: v.name.trim() })) onClose(); setBusy(false) }
  return (
    <ModalShell title={vendor ? 'Edit vendor' : 'New vendor'} onClose={onClose} onSave={save} canSave={!!v.name.trim()} busy={busy}>
      <div className="panel">
        <div className="form-grid">
          <Field label="Name"><input value={v.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
          <Field label="Kind"><select value={v.kind} onChange={(e) => set({ kind: e.target.value })}>{VendorKinds.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></Field>
          <Field label="Contact name"><input value={v.contact_name} onChange={(e) => set({ contact_name: e.target.value })} /></Field>
          <Field label="Phone"><input type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Email"><input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Address"><input value={v.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="Notes" className="full"><textarea value={v.notes} placeholder="License #, insurance, terms…" onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Void, mark paid, attach
// ---------------------------------------------------------------------------
export function VoidForm({ refx, onClose }: { refx: EntryRef } & Close) {
  const app = useStore()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    try { Rules.checkVoid(refx, reason, app.ledger) } catch (e) { return app.showError(e) }
    setBusy(true)
    if (await app.change(refx, { type: 'void', reason: reason.trim() }, 'Voided')) onClose()
    setBusy(false)
  }
  return (
    <ModalShell title="Void record" onClose={onClose} onSave={save} saveTitle="Void" canSave={!!reason.trim()} busy={busy}>
      <div className="panel">
        <Field label="Reason (required)"><textarea value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice, wrong amount" /></Field>
        <div className="note">Posted records are never deleted. Voiding keeps the record and its history, stops it counting in any total, and logs who did it and why. Enter a corrected record afterwards if needed.</div>
      </div>
    </ModalShell>
  )
}

export function MarkPaidForm({ refx, onClose }: { refx: EntryRef } & Close) {
  const app = useStore()
  const [date, setDate] = useState(Days.today)
  const [method, setMethod] = useState('ach')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const r = app.ledger.s.reimbursements.find((x) => x.id === refx.id)
  const save = async () => {
    setBusy(true)
    if (await app.change(refx, { type: 'markPaid', date, method, reference }, 'Marked paid')) onClose()
    setBusy(false)
  }
  return (
    <ModalShell title="Mark as paid to partner" onClose={onClose} onSave={save} saveTitle="Mark paid" busy={busy}>
      <div className="panel">
        {r && <div className="card list"><MoneyKV label={`Reimburse ${app.ledger.payerName(r.partner_user_id)}`} cents={r.amount_cents} bold /></div>}
        <div className="form-grid">
          <Field label="Paid on"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method"><MethodSelect value={method} onChange={setMethod} /></Field>
          <Field label="Reference" className="full"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
      </div>
    </ModalShell>
  )
}

export function AttachForm({ target, onClose }: { target: AttachTarget } & Close) {
  const app = useStore()
  const l = app.ledger
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const save = async () => { setBusy(true); if (await app.attach(files, target)) onClose(); setBusy(false) }
  const [title, pickerTitle, note] = target.kind === 'project'
    ? [`Add document to ${l.project(target.id)?.nickname ?? 'project'}`, 'Permit, plan, closing papers…',
      "Filed on this project for everyone: permits, plans, closing papers and other documents that aren't a single transaction. Totals don't change."]
    : target.kind === 'vendor'
      ? [`Add document to ${l.vendor(target.id)?.name ?? 'vendor'}`, 'Contract, W-9, license, insurance…',
        "Filed on this vendor for everyone: contracts, W-9s, licenses and insurance certificates. Totals don't change."]
      : ['Attach documents', 'Receipt, invoice or confirmation', 'The document is added to this record for everyone. Amounts and balances stay the same.']
  return (
    <ModalShell title={title} onClose={onClose} onSave={save} saveTitle="Upload" canSave={files.length > 0} busy={busy}>
      <FilePicker files={files} onChange={setFiles} title={pickerTitle} />
      <div className="note">{note} Documents are kept for the record and can't be deleted.</div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Say it: speech (where the browser supports it) or a typed sentence -> prefilled receipt
// ---------------------------------------------------------------------------
type SpeechRec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }

export function VoiceForm({ onClose }: Close) {
  const app = useStore()
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const rec = useRef<SpeechRec | null>(null)
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
  const Speech = w.SpeechRecognition ?? w.webkitSpeechRecognition
  useEffect(() => () => rec.current?.stop(), [])
  const listen = () => {
    if (!Speech) return
    if (listening) { rec.current?.stop(); return }
    const r = new Speech()
    r.lang = 'en-US'
    r.interimResults = true
    r.continuous = false
    r.onresult = (e) => setText(Array.from(e.results).map((x) => x[0].transcript).join(' '))
    r.onend = () => setListening(false)
    r.onerror = (e) => {
      setListening(false)
      if (e.error === 'aborted' || e.error === 'no-speech') return
      const msg = e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? (window.isSecureContext
          ? 'The browser blocked the microphone for this site. Allow it in the site settings (the icon left of the address), or type the sentence instead.'
          : 'Voice needs a secure (https) address. Open the app through its https link, or type the sentence instead.')
        : `Voice didn't work (${e.error}). You can type the sentence instead.`
      app.showError(new Error(msg))
    }
    rec.current = r
    setListening(true)
    r.start()
  }
  const next = () => {
    const l = app.ledger
    const s = parseVoice(text, l.s.projects, l.s.vendors, l.activeCategories)
    const d = newDraft('receipt')
    if (s.total_cents) d.total_text = Money.plain(s.total_cents)
    d.project_id = s.project_id ?? null
    d.vendor_id = s.vendor_id ?? null
    if (!s.vendor_id && s.vendor_name) d.new_vendor_name = s.vendor_name
    if (s.date) d.date = s.date
    if (s.description) d.description = s.description
    if (s.paid_by_me === false) d.payer = 'llc'
    if (s.payment_method) d.payment_method = s.payment_method
    if (s.category_id) d.splits = [{ id: uuid(), category_id: s.category_id, amount_text: '' }]
    app.open({ type: 'transaction', draft: d })
  }
  return (
    <ModalShell title="Say it" onClose={onClose} onSave={next} saveTitle="Continue" canSave={!!text.trim()}>
      <div className="panel">
        <div className="note">Example: “Spent $350 at Home Depot on drywall for Oak Street with my card yesterday.”</div>
        {!window.isSecureContext ? (
          <div className="callout info">Voice needs a secure (https) address, and this page is plain http. Type the sentence below, use your keyboard's dictation button, or open the app through its https link.</div>
        ) : Speech ? (
          <button type="button" className={`btn big ${listening ? 'danger' : 'primary'}`} onClick={listen}>{listening ? 'Stop listening' : 'Tap and speak'}</button>
        ) : <div className="callout info">This browser can't listen. Type the sentence below, or use your keyboard's dictation button.</div>}
        <Field label="Sentence"><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you buy, where, how much, for which project, who paid?" /></Field>
        <div className="note">Next you'll check the suggested amount, vendor, project and category before posting.</div>
      </div>
    </ModalShell>
  )
}
