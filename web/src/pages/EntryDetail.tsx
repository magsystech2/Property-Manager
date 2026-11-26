import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { kindLabel, methodLabel, paymentKindLabel, type Allocation, type EntryKind, type EntryRef } from '../core/models'
import { newDraft } from '../drafts'
import type { CorrectionPatch } from '../core/correction'
import { uuid } from '../core/money'
import { AttachmentRow, EditCell, EntryList, EntryRow, Icon, KV, MoneyKV, MoneyText, PageHead, Section, StatusBadge, recordPath } from '../ui/common'

export function EntryDetailPage() {
  const { kind = '', id = '' } = useParams()
  const app = useStore()
  const ref: EntryRef = { kind: kind as EntryKind, id }
  const l = app.ledger
  const entry = l.entry(ref)
  if (!entry) return <PageHead title="Record not found" back="/activity" />
  return (
    <div className="stack">
      <PageHead title={entry.title} sub={kindLabel[ref.kind]} back="/activity" />
      <ReviewBanner refx={ref} />
      <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 30, letterSpacing: '-0.01em' }}><MoneyText cents={entry.amount_cents} bold /></span>
        <StatusBadge status={entry.status} />
        <span className="spacer" />
        <Actions refx={ref} />
      </div>
      <div className="grid2">
        <div className="stack"><Details refx={ref} /></div>
        <div className="stack">
          {ref.kind !== 'proceeds' && ref.kind !== 'distribution' && (
            <Section title="Documents" footer="Adding a document never changes amounts or balances."
              action={<button className="btn link" onClick={() => app.open({ type: 'attach', target: { kind: 'record', ref } })}><Icon name="clip" size={14} /> Attach</button>}>
              {l.attachmentsFor(ref).length === 0 && <div className="empty">No documents yet.</div>}
              {l.attachmentsFor(ref).map((a) => <AttachmentRow key={a.id} a={a} />)}
            </Section>
          )}
          <History refx={ref} />
        </div>
      </div>
    </div>
  )
}

function Actions({ refx: ref }: { refx: EntryRef }) {
  const app = useStore()
  const l = app.ledger
  const rec = l.record(ref)
  const entry = l.entry(ref)!
  if (!rec) return null
  const status = rec.status
  const needsApproval = status === 'pending_review' || status === 'requested'
  const partner = ref.kind === 'reimbursement' ? entry.partner_id : null
  const iCreated = entry.created_by === app.me || partner === app.me
  return (
    <div className="row wrap">
      {needsApproval && (iCreated
        ? <span className="badge warning"><Icon name="clock" size={12} />Waiting for another partner to approve</span>
        : <button className="btn primary" onClick={() => app.change(ref, { type: 'approve' }, 'Approved')}><Icon name="check" />Approve</button>)}
      {ref.kind === 'reimbursement' && (status === 'approved' || (status === 'requested' && !app.workspace?.require_review)) && (
        <button className="btn primary" onClick={() => app.open({ type: 'markPaid', ref })}><Icon name="cash" />Mark as paid to partner</button>
      )}
      {ref.kind === 'bill' && status === 'posted' && l.balance(ref.id).outstanding_cents > 0 && (
        <button className="btn primary" onClick={() => app.open({ type: 'payment', billId: ref.id })}><Icon name="cash" />Record payment</button>
      )}
      {(ref.kind === 'expense' || ref.kind === 'bill') && <button className="btn" onClick={() => { const d = app.againDraft(ref); if (d) app.open({ type: 'transaction', draft: d }) }} title="A new one with the same vendor, project, amount and categories, dated today">Add again</button>}
      {(ref.kind === 'expense' || ref.kind === 'bill') && <button className="btn" onClick={() => app.open({ type: 'template', from: ref })} title="Save it as a template, optionally repeating">Save as template</button>}
      {l.reviewFlagsFor(ref).length === 0 && <button className="btn" onClick={() => app.open({ type: 'report', ref, review: true })} title="Put it on the Needs review list, with a note on what to check">Needs review</button>}
      <button className="btn" onClick={() => app.open({ type: 'report', ref })} title="Flag a wrong amount, duplicate or other problem for the partners to fix"><Icon name="alert" />Report issue</button>
      {status !== 'void' && <button className="btn danger" onClick={() => app.open({ type: 'void', ref })}>Void…</button>}
    </div>
  )
}

function Splits({ allocations }: { allocations: Allocation[] }) {
  const app = useStore()
  if (allocations.length === 0) return null
  return (
    <Section title="Budget categories">
      {allocations.map((a) => <MoneyKV key={a.id} label={app.ledger.category(a.category_id)?.name ?? 'Category'} cents={a.amount_cents} />)}
    </Section>
  )
}

function Details({ refx: ref }: { refx: EntryRef }) {
  const app = useStore()
  const nav = useNavigate()
  const l = app.ledger
  const s = l.s
  // Receipts and bills: values are click-to-edit. A change voids this one and posts a corrected copy (see store.correct).
  const rec = l.record(ref)
  const canFix = (ref.kind === 'expense' || ref.kind === 'bill') && rec?.status !== 'void' && !app.correctionBlocker(ref)
  const fix = async (patch: CorrectionPatch) => { const r = await app.correct(ref, patch); if (r) nav(recordPath(r), { replace: true }); return !!r }
  const ed = (kind: 'text' | 'money' | 'date' | 'select', value: string | number | null, display: React.ReactNode, patch: (v: string | number | null) => CorrectionPatch | null, options?: [string, string][]) =>
    canFix ? <EditCell as="span" kind={kind} value={value} display={display} options={options} title="Click to correct: the original is voided and a fixed copy posted"
      onSave={(v) => { const p = patch(v); return p ? fix(p) : false }} /> : display
  const vendorOpts = (): [string, string][] => [...s.vendors].sort((a, b) => a.name.localeCompare(b.name)).map((v) => [v.id, v.name])
  const projectOpts = (): [string, string][] => s.projects.map((p) => [p.id, p.nickname])
  const payerOpts = (): [string, string][] => [['', 'LLC account'], ...s.members.map((m): [string, string] => [m.user_id, m.display_name])]
  const fixFooter = canFix ? 'Click any value to correct it. The original is voided with a note saying what changed, and a fixed copy is posted with the same documents.'
    : (ref.kind === 'expense' || ref.kind === 'bill') && rec?.status !== 'void' ? app.correctionBlocker(ref) ?? undefined : undefined
  const projectRow = (pid?: string | null) => pid ? <KV k="Project" to={`/projects/${pid}`}>{l.project(pid)?.nickname ?? '-'}</KV> : null
  const vendorRow = (vid?: string | null) => vid ? <KV k="Vendor" to={`/vendors/${vid}`}>{l.vendor(vid)?.name ?? '-'}</KV> : null
  const voidNote = (r: { status: string; void_reason?: string | null; voided_by?: string | null }) =>
    r.status === 'void' ? <div className="callout bad">Voided by {l.payerName(r.voided_by)}: {r.void_reason}</div> : null

  switch (ref.kind) {
    case 'expense': {
      const e = s.expenses.find((x) => x.id === ref.id)
      if (!e) return null
      return <>
        {voidNote(e)}
        <Section footer={[e.paid_by_user_id && e.status !== 'void' ? `Paid personally: counted once as a project cost, and added to what the LLC owes ${l.payerName(e.paid_by_user_id)}.` : '', fixFooter ?? ''].filter(Boolean).join(' ') || undefined}>
          {canFix ? <>
            <KV k="Amount">{ed('money', e.total_cents, Money.format(e.total_cents), (v) => (Number(v) > 0 ? { total_cents: Number(v) } : null))}</KV>
            <KV k="Project">{ed('select', e.project_id, l.project(e.project_id)?.nickname ?? '-', (v) => ({ project_id: String(v) }), projectOpts())}</KV>
            <KV k="Vendor">{ed('select', e.vendor_id, l.vendor(e.vendor_id)?.name ?? '-', (v) => ({ vendor_id: String(v) }), vendorOpts())}</KV>
            <CategoryKV allocations={l.allocationsForExpense(e.id)} ed={ed} />
          </> : <>{projectRow(e.project_id)}{vendorRow(e.vendor_id)}</>}
          <KV k="Date">{ed('date', e.expense_date, Days.display(e.expense_date), (v) => ({ expense_date: String(v) }))}</KV>
          {(e.description || canFix) && <KV k="Description">{ed('text', e.description, e.description || '-', (v) => ({ description: String(v ?? '') }))}</KV>}
          {e.is_refund && <KV k="Type">Refund from the vendor (reduces project cost)</KV>}
          <KV k="Paid by">{ed('select', e.paid_by_user_id ?? '', l.payerName(e.paid_by_user_id), (v) => ({ paid_by_user_id: v ? String(v) : null }), payerOpts())}</KV>
          <KV k="Method">{methodLabel(e.payment_method)}</KV>
          {e.reference && <KV k="Reference">{e.reference}</KV>}
          {e.tax_cents > 0 && <MoneyKV label="Tax (included)" cents={e.tax_cents} />}
        </Section>
        <NotesSection refx={ref} notes={e.notes ?? ''} locked={e.status === 'void'} />
        <Splits allocations={l.allocationsForExpense(e.id)} />
      </>
    }
    case 'bill': {
      const b = l.bill(ref.id)
      if (!b) return null
      const bal = l.balance(b.id)
      const c = b.commitment_id ? s.commitments.find((x) => x.id === b.commitment_id) : undefined
      return <>
        {voidNote(b)}
        <Section footer={fixFooter}>
          {canFix && !b.commitment_id ? <>
            <KV k="Amount">{ed('money', b.total_cents, Money.format(b.total_cents), (v) => (Number(v) > 0 ? { total_cents: Number(v) } : null))}</KV>
            <KV k="Project">{ed('select', b.project_id, l.project(b.project_id)?.nickname ?? '-', (v) => ({ project_id: String(v) }), projectOpts())}</KV>
            <KV k="Vendor">{ed('select', b.vendor_id, l.vendor(b.vendor_id)?.name ?? '-', (v) => ({ vendor_id: String(v) }), vendorOpts())}</KV>
          </> : <>
            {canFix && <KV k="Amount">{ed('money', b.total_cents, Money.format(b.total_cents), (v) => (Number(v) > 0 ? { total_cents: Number(v) } : null))}</KV>}
            {projectRow(b.project_id)}{vendorRow(b.vendor_id)}
          </>}
          {canFix && <CategoryKV allocations={l.allocationsForBill(b.id)} ed={ed} />}
          {(b.invoice_number || canFix) && <KV k="Invoice #">{ed('text', b.invoice_number, b.invoice_number || '-', (v) => ({ invoice_number: String(v ?? '').trim() }))}</KV>}
          <KV k="Bill date">{ed('date', b.bill_date, Days.display(b.bill_date), (v) => ({ bill_date: String(v) }))}</KV>
          <KV k="Due">{ed('date', b.due_date ?? '', Days.display(b.due_date), (v) => ({ due_date: v ? String(v) : null }))}</KV>
          {(b.description || canFix) && <KV k="Description">{ed('text', b.description, b.description || '-', (v) => ({ description: String(v ?? '') }))}</KV>}
          {c && <KV k="Against contract" to={recordPath({ kind: 'commitment', id: c.id })}>{c.description || 'Contract'}</KV>}
          {b.approved_by && <KV k="Approved by">{l.payerName(b.approved_by)}</KV>}
        </Section>
        <NotesSection refx={ref} notes={b.notes ?? ''} locked={b.status === 'void'} />
        <Section title="Balance">
          <MoneyKV label="Invoice total" cents={bal.total_cents} />
          {bal.credits_cents > 0 && <MoneyKV label="Vendor credits" cents={-bal.credits_cents} />}
          <MoneyKV label="Paid" cents={bal.paid_cents} />
          <MoneyKV label="Still owed" cents={bal.outstanding_cents} bold />
        </Section>
        <Splits allocations={l.allocationsForBill(b.id)} />
        <Section title="Payments, credits and refunds">
          <EntryList entries={l.paymentsForBill(b.id).map((p) => l.entry({ kind: 'payment', id: p.id })!).filter(Boolean)} empty="No payments yet." />
        </Section>
      </>
    }
    case 'payment': {
      const p = s.payments.find((x) => x.id === ref.id)
      if (!p) return null
      const b = l.bill(p.bill_id)
      return <>
        {voidNote(p)}
        <Section>
          <KV k="Type">{paymentKindLabel(p.kind)}</KV>
          {b && <KV k="Bill" to={recordPath({ kind: 'bill', id: b.id })}>{[l.vendor(b.vendor_id)?.name, b.invoice_number ? `#${b.invoice_number}` : null].filter(Boolean).join(' ')}</KV>}
          {b && projectRow(b.project_id)}
          <KV k="Date">{Days.display(p.payment_date)}</KV>
          {p.kind !== 'credit' && <KV k="Paid by">{l.payerName(p.paid_by_user_id)}</KV>}
          <KV k="Method">{methodLabel(p.payment_method)}</KV>
          {p.reference && <KV k="Reference">{p.reference}</KV>}
        </Section>
      </>
    }
    case 'reimbursement': {
      const r = s.reimbursements.find((x) => x.id === ref.id)
      if (!r) return null
      const items = s.reimbursement_items.filter((i) => i.reimbursement_id === r.id)
      return <>
        {voidNote(r)}
        <Section footer="Reimbursements reduce what the LLC owes the partner. They are not project costs.">
          <KV k="Partner" to={`/partners/${r.partner_user_id}`}>{l.payerName(r.partner_user_id)}</KV>
          <KV k="Requested">{Days.display(r.request_date)}</KV>
          {r.paid_date && <KV k="Paid">{Days.display(r.paid_date)}</KV>}
          {r.status === 'paid' && <KV k="Method">{methodLabel(r.payment_method)}</KV>}
          {r.reference && <KV k="Reference">{r.reference}</KV>}
          {r.notes && <KV k="Notes">{r.notes}</KV>}
          {r.approved_by && <KV k="Approved by">{l.payerName(r.approved_by)}</KV>}
        </Section>
        {items.length > 0 && (
          <Section title="Covers">
            {items.map((i) => {
              const iref: EntryRef = i.expense_id ? { kind: 'expense', id: i.expense_id } : { kind: 'payment', id: i.bill_payment_id! }
              const e = l.entry(iref)
              return e ? <Link key={i.id} className="item" to={recordPath(iref)}><div className="grow"><div className="title">{e.title}</div><div className="subtitle">{Days.display(e.date)}</div></div><MoneyText cents={i.amount_cents} bold /></Link> : null
            })}
          </Section>
        )}
      </>
    }
    case 'contribution': {
      const c = s.contributions.find((x) => x.id === ref.id)
      if (!c) return null
      return <>
        {voidNote(c)}
        <Section footer="Capital put into the LLC. Recorded separately from reimbursements and doesn't change what the LLC owes for expenses.">
          <KV k="Partner" to={`/partners/${c.partner_user_id}`}>{l.payerName(c.partner_user_id)}</KV>
          {c.project_id ? projectRow(c.project_id) : <KV k="Project">LLC-wide</KV>}
          <KV k="Date">{Days.display(c.contribution_date)}</KV>
          <KV k="Method">{methodLabel(c.payment_method)}</KV>
          {c.reference && <KV k="Reference">{c.reference}</KV>}
          {c.notes && <KV k="Notes">{c.notes}</KV>}
        </Section>
      </>
    }
    case 'proceeds': {
      const p = s.proceeds.find((x) => x.id === ref.id)
      if (!p) return null
      return <>{voidNote(p)}<Section footer="Net proceeds = sale price − selling costs. The split and payouts are on the project's Sale and split tab.">
        {projectRow(p.project_id)}<KV k="Sale date">{Days.display(p.sale_date)}</KV>
        {p.gross_price_cents != null && <MoneyKV label="Sale price" cents={p.gross_price_cents} />}
        {p.selling_costs_cents != null && <MoneyKV label="Selling costs" cents={p.selling_costs_cents} />}
        {p.loan_payoff_cents != null && <MoneyKV label="Loan paid off at closing" cents={p.loan_payoff_cents} />}
        {p.notes && <KV k="Notes">{p.notes}</KV>}</Section></>
    }
    case 'distribution': {
      const d = s.distributions.find((x) => x.id === ref.id)
      if (!d) return null
      return <>
        {voidNote(d)}
        <Section footer="Paid out to a partner from a sale (capital back and profit). Doesn't change what the LLC owes for receipts.">
          <KV k="Partner" to={`/partners/${d.partner_user_id}`}>{l.payerName(d.partner_user_id)}</KV>
          {d.project_id ? projectRow(d.project_id) : <KV k="Project">LLC-wide</KV>}
          <KV k="Date">{Days.display(d.distribution_date)}</KV>
          <KV k="Method">{methodLabel(d.payment_method)}</KV>
          {d.reference && <KV k="Reference">{d.reference}</KV>}
          {d.notes && <KV k="Notes">{d.notes}</KV>}
        </Section>
      </>
    }
    case 'commitment': {
      const c = s.commitments.find((x) => x.id === ref.id)
      if (!c) return null
      const st = l.commitmentStatus(c)
      const cos = s.change_orders.filter((x) => x.commitment_id === c.id)
      const bills = l.entries().filter((e) => e.ref.kind === 'bill' && l.bill(e.ref.id)?.commitment_id === c.id)
      return <>
        {voidNote(c)}
        <Section>
          {projectRow(c.project_id)}{vendorRow(c.vendor_id)}
          <KV k="Category">{l.category(c.category_id)?.name ?? '-'}</KV>
          {c.description && <KV k="Scope">{c.description}</KV>}
        </Section>
        <Section title="Contract" footer="When the contractor invoices against this contract, the amount moves from “not billed” to the bill, so projected spend isn’t counted twice.">
          <MoneyKV label="Original amount" cents={st.original_cents} />
          <MoneyKV label="Approved change orders" cents={st.approved_change_orders_cents} />
          {st.pending_change_orders_cents !== 0 && <MoneyKV label="Change orders awaiting approval" cents={st.pending_change_orders_cents} />}
          <MoneyKV label="Revised amount" cents={st.revised_cents} bold />
          <MoneyKV label="Billed so far" cents={st.billed_cents} />
          <MoneyKV label="Not billed yet" cents={st.unbilled_cents} bold />
        </Section>
        <Section title="Change orders" action={c.status !== 'void' ? <button className="btn link" onClick={() => app.open({ type: 'changeOrder', commitmentId: c.id })}>+ Add change order</button> : undefined}>
          {cos.length === 0 && <div className="empty">None</div>}
          {cos.map((co) => { const e = l.entry({ kind: 'changeOrder', id: co.id }); return e ? <EntryRow key={co.id} entry={e} /> : null })}
        </Section>
        <Section title="Scheduled draws" footer="Expected payment dates for the cash forecast. They don't change any totals."
          action={c.status !== 'void' ? <button className="btn link" onClick={() => app.open({ type: 'draw', commitmentId: c.id })}>+ Schedule a draw</button> : undefined}>
          {s.scheduled_draws.filter((d) => d.commitment_id === c.id).length === 0 && <div className="empty">None</div>}
          {s.scheduled_draws.filter((d) => d.commitment_id === c.id).sort((a, b) => a.due_date.localeCompare(b.due_date)).map((d) => (
            <div key={d.id} className="item">
              <span className="grow"><span className="title">{Days.display(d.due_date)}</span>{d.description && <span className="subtitle"> · {d.description}</span>}</span>
              <MoneyText cents={d.amount_cents} />
              <button className="btn link danger" onClick={() => app.deleteDraw(d.id)}>Remove</button>
            </div>
          ))}
        </Section>
        <Section title="Bills against this contract" action={c.status !== 'void' ? (
          <button className="btn link" onClick={() => {
            const d = newDraft('bill')
            d.project_id = c.project_id; d.vendor_id = c.vendor_id; d.commitment_id = c.id
            d.splits = [{ id: uuid(), category_id: c.category_id, amount_text: '' }]
            app.open({ type: 'transaction', draft: d })
          }}>+ Add bill for this contract</button>) : undefined}>
          <EntryList entries={bills} empty="No bills yet." />
        </Section>
      </>
    }
    case 'changeOrder': {
      const co = s.change_orders.find((x) => x.id === ref.id)
      if (!co) return null
      return <>
        {voidNote(co)}
        <Section>
          <KV k="Contract" to={recordPath({ kind: 'commitment', id: co.commitment_id })}>{s.commitments.find((c) => c.id === co.commitment_id)?.description || 'Contract'}</KV>
          {co.description && <KV k="Description">{co.description}</KV>}
          {co.approved_by && <KV k="Approved by">{l.payerName(co.approved_by)}</KV>}
        </Section>
      </>
    }
  }
}

const actionLabel = (a: string) => ({ insert: 'Entered', update: 'Updated', approve: 'Approved', void: 'Voided', paid: 'Marked paid' } as Record<string, string>)[a] ?? a

function History({ refx: ref }: { refx: EntryRef }) {
  const app = useStore()
  const l = app.ledger
  const events = l.s.audit.filter((a) => a.record_id === ref.id).sort((a, b) => a.at.localeCompare(b.at))
  const entry = l.entry(ref)
  return (
    <Section title="History">
      {events.length === 0 && entry?.created_by && <KV k="Entered by">{l.payerName(entry.created_by)}</KV>}
      {events.map((a) => (
        <div key={a.id} className="item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span className="bold">{actionLabel(a.action)} by {a.actor ? l.payerName(a.actor) : 'system'}</span>
          <span className="small muted">{new Date(a.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
          {a.reason && <span className="small">Reason: {a.reason}</span>}
        </div>
      ))}
    </Section>
  )
}

/** Notes on a receipt or bill. They never change amounts, so they stay editable after posting (every change is audited). */
function NotesSection({ refx, notes, locked }: { refx: EntryRef; notes: string; locked: boolean }) {
  const app = useStore()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(notes)
  const [busy, setBusy] = useState(false)
  if (!editing && !notes && locked) return null
  const save = async () => {
    setBusy(true)
    const ok = await app.change(refx, { type: 'notes', notes: text.trim() }, 'Notes saved')
    setBusy(false)
    if (ok) setEditing(false)
  }
  return (
    <Section title="Notes" footer={editing ? 'Notes don’t change any amounts. Every edit is kept in the activity log.' : undefined}
      action={!editing && !locked ? <button className="btn link" onClick={() => { setText(notes); setEditing(true) }}>{notes ? 'Edit' : '+ Add'}</button> : undefined}>
      {editing ? (
        <div className="stack" style={{ padding: 12 }}>
          <textarea value={text} autoFocus onChange={(ev) => setText(ev.target.value)} placeholder="e.g. Rent deducted for renovation work" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={busy || text.trim() === notes} onClick={save}>Save</button>
            <button className="btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : notes ? <div style={{ padding: '10px 14px', whiteSpace: 'pre-wrap' }}>{notes}</div>
        : <div className="small muted" style={{ padding: '10px 14px' }}>No notes.</div>}
    </Section>
  )
}

/** Category row for a receipt or bill: editable when it's in one category; a split shows "Split" (change it with Void and enter again). */
function CategoryKV({ allocations, ed }: { allocations: Allocation[]; ed: (kind: 'select', value: string, display: React.ReactNode, patch: (v: string | number | null) => CorrectionPatch | null, options: [string, string][]) => React.ReactNode }) {
  const app = useStore()
  const l = app.ledger
  if (allocations.length > 1) return <KV k="Category">Split across {allocations.length} (below)</KV>
  const cid = allocations[0]?.category_id ?? ''
  const opts: [string, string][] = l.activeCategories.map((c) => [c.id, c.name])
  if (cid && !opts.some(([k]) => k === cid)) opts.unshift([cid, l.category(cid)?.name ?? 'Category'])
  return <KV k="Category">{ed('select', cid, l.category(cid)?.name ?? 'None', (v) => (v ? { category_id: String(v) } : null), opts)}</KV>
}

/** Open "needs review" flags on this record, with a button to mark it reviewed. */
function ReviewBanner({ refx }: { refx: EntryRef }) {
  const app = useStore()
  const l = app.ledger
  const flags = l.reviewFlagsFor(refx)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  if (flags.length === 0) return null
  const done = async () => { for (const r of flags) if (!(await app.markReviewed(r, note))) return; setOpen(false); setNote('') }
  return (
    <div className="callout warn" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontWeight: 650 }}>Needs review</div>
        {flags.map((r) => <div key={r.id} className="small">{r.note} <span className="muted">· {r.created_by ? l.payerName(r.created_by) : 'Import'} · {r.created_at ? Days.display(r.created_at.slice(0, 10)) : ''}</span></div>)}
      </div>
      <button className="btn primary" onClick={() => setOpen(!open)}><Icon name="check" />Mark reviewed</button>
      {open && (
        <form className="row" style={{ width: '100%', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void done() }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: what you found" autoFocus style={{ flex: 1 }} />
          <button className="btn primary">Done</button>
        </form>
      )}
    </div>
  )
}
