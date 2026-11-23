import { Link, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { Days } from '../core/money'
import { kindLabel, methodLabel, paymentKindLabel, type Allocation, type EntryKind, type EntryRef } from '../core/models'
import { newDraft } from '../drafts'
import { uuid } from '../core/money'
import { AttachmentRow, EntryList, EntryRow, Icon, KV, MoneyKV, MoneyText, PageHead, Section, StatusBadge, recordPath } from '../ui/common'

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
      <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 30, letterSpacing: '-0.01em' }}><MoneyText cents={entry.amount_cents} bold /></span>
        <StatusBadge status={entry.status} />
        <span className="spacer" />
        <Actions refx={ref} />
      </div>
      <div className="grid2">
        <div className="stack"><Details refx={ref} /></div>
        <div className="stack">
          <Section title="Documents" footer="Adding a document never changes amounts or balances."
            action={<button className="btn link" onClick={() => app.open({ type: 'attach', target: { kind: 'record', ref } })}><Icon name="clip" size={14} /> Attach</button>}>
            {l.attachmentsFor(ref).length === 0 && <div className="empty">No documents yet.</div>}
            {l.attachmentsFor(ref).map((a) => <AttachmentRow key={a.id} a={a} />)}
          </Section>
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
  const l = app.ledger
  const s = l.s
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
        <Section footer={e.paid_by_user_id && e.status !== 'void' ? `Paid personally: counted once as a project cost, and added to what the LLC owes ${l.payerName(e.paid_by_user_id)}.` : undefined}>
          {projectRow(e.project_id)}{vendorRow(e.vendor_id)}
          <KV k="Date">{Days.display(e.expense_date)}</KV>
          {e.description && <KV k="Description">{e.description}</KV>}
          {e.is_refund && <KV k="Type">Refund from the vendor (reduces project cost)</KV>}
          <KV k="Paid by">{l.payerName(e.paid_by_user_id)}</KV>
          <KV k="Method">{methodLabel(e.payment_method)}</KV>
          {e.reference && <KV k="Reference">{e.reference}</KV>}
          {e.tax_cents > 0 && <MoneyKV label="Tax (included)" cents={e.tax_cents} />}
        </Section>
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
        <Section>
          {projectRow(b.project_id)}{vendorRow(b.vendor_id)}
          {b.invoice_number && <KV k="Invoice #">{b.invoice_number}</KV>}
          <KV k="Bill date">{Days.display(b.bill_date)}</KV>
          <KV k="Due">{Days.display(b.due_date)}</KV>
          {b.description && <KV k="Description">{b.description}</KV>}
          {c && <KV k="Against contract" to={recordPath({ kind: 'commitment', id: c.id })}>{c.description || 'Contract'}</KV>}
          {b.approved_by && <KV k="Approved by">{l.payerName(b.approved_by)}</KV>}
        </Section>
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
      return <>{voidNote(p)}<Section>{projectRow(p.project_id)}<KV k="Sale date">{Days.display(p.sale_date)}</KV>{p.notes && <KV k="Notes">{p.notes}</KV>}</Section></>
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
