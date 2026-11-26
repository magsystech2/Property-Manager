import { useState } from 'react'
import { useStore } from '../store'
import { Days, Money, uuid } from '../core/money'
import type { PartnerLoan, PartnerLoanPayment } from '../core/models'
import { loanStatus } from '../core/loans'
import { AmountInput, Field, ModalShell, MoneyKV, PartnerSelect, ProjectSelect, Segmented } from '../ui/common'

/** Add or edit a partner's personal loan, and record what's been paid on it. Reference only: balances don't change. */
export function LoanForm({ loan, projectId, onClose }: { loan?: PartnerLoan | null; projectId?: string | null; onClose: () => void }) {
  const app = useStore()
  const l = app.ledger
  const ws = app.workspace?.id ?? ''
  const l0: PartnerLoan = loan ?? { id: uuid(), workspace_id: ws, partner_user_id: app.me ?? '', project_id: projectId ?? null, lender: '', principal_cents: 0, rate_bps: 0, start_date: Days.today, status: 'open', notes: '' }
  const [f, setF] = useState({ partner: l0.partner_user_id, project: l0.project_id ?? null, lender: l0.lender, amount: l0.principal_cents ? Money.plain(l0.principal_cents) : '',
    rate: l0.rate_bps ? String(l0.rate_bps / 100) : '', start: l0.start_date, status: l0.status, notes: l0.notes })
  const [busy, setBusy] = useState(false)
  const rate = Number(f.rate || 0)
  const row: PartnerLoan = { ...l0, partner_user_id: f.partner, project_id: f.project, lender: f.lender.trim(), principal_cents: Money.parse(f.amount) ?? 0,
    rate_bps: Math.round(rate * 100), start_date: f.start, status: f.status, notes: f.notes }
  const problem = !row.partner_user_id ? 'Pick the partner who borrowed.' : !row.lender ? 'Who lent the money?' : !(row.principal_cents > 0) ? 'Enter the amount borrowed.'
    : !(rate >= 0 && rate <= 100) ? 'Enter a yearly rate between 0 and 100%.' : !row.start_date ? 'Pick the date it was borrowed.' : null
  const save = async () => { setBusy(true); if (await app.saveLoan(row)) onClose(); setBusy(false) }
  const st = loan ? loanStatus(row, l.s.partner_loan_payments ?? [], l.today) : null
  return (
    <ModalShell title={loan ? 'Edit loan' : 'Add borrowed money'} onClose={onClose} onSave={save} saveTitle="Save" canSave={!problem} busy={busy}
      secondary={loan ? <button type="button" className="btn link danger" onClick={async () => { if (await app.deleteLoan(row.id)) onClose() }}>Remove</button> : undefined}>
      <div className="panel">
        <div className="form-grid">
          <Field label="Partner who borrowed"><PartnerSelect value={f.partner} onChange={(v) => setF({ ...f, partner: v ?? '' })} /></Field>
          <Field label="Lender"><input value={f.lender} onChange={(e) => setF({ ...f, lender: e.target.value })} placeholder="Friends, Kaka, bank…" autoFocus={!loan} /></Field>
          <Field label="Initial amount borrowed"><AmountInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Interest rate (% a year)"><input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="10" /></Field>
          <Field label="Borrowed on"><input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="Used for"><ProjectSelect value={f.project} onChange={(v) => setF({ ...f, project: v })} allowNone noneLabel="The LLC in general" /></Field>
          <Field label="Status"><Segmented value={f.status as 'open' | 'closed'} onChange={(v) => setF({ ...f, status: v })} options={[['open', 'Still owed'], ['closed', 'Paid off']]} /></Field>
          <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Terms, check number…" /></Field>
        </div>
        <div className="note">{problem ?? 'For reference only. The money is already in the books as this partner’s contribution or personal payment, so this doesn’t change any balance.'}</div>
      </div>
      {st && (
        <>
          <div className="panel" style={{ gap: 0, padding: 0 }}>
            <MoneyKV label="Initial amount" cents={row.principal_cents} />
            <MoneyKV label="Interest built up so far" cents={st.interest_accrued_cents} />
            <MoneyKV label="Interest paid" cents={st.interest_paid_cents} />
            <MoneyKV label="Principal paid back" cents={st.principal_repaid_cents} />
            <MoneyKV label="Owed now" cents={st.owed_now_cents} bold />
          </div>
          <LoanPayments loan={row} />
        </>
      )}
    </ModalShell>
  )
}

function LoanPayments({ loan }: { loan: PartnerLoan }) {
  const app = useStore()
  const list = (app.ledger.s.partner_loan_payments ?? []).filter((p) => p.loan_id === loan.id).sort((a, b) => b.paid_on.localeCompare(a.paid_on))
  const [p, setP] = useState({ date: Days.today, amount: '', kind: 'interest' as 'interest' | 'principal', note: '' })
  const amount = Money.parse(p.amount) ?? 0
  const add = async () => {
    const row: PartnerLoanPayment = { id: uuid(), workspace_id: loan.workspace_id, loan_id: loan.id, paid_on: p.date, amount_cents: amount, kind: p.kind, note: p.note.trim() }
    if (await app.saveLoanPayment(row)) setP({ ...p, amount: '', note: '' })
  }
  return (
    <div className="panel">
      <div className="bold">Payments to the lender</div>
      {list.length === 0 && <div className="note">No payments recorded yet.</div>}
      {list.map((x) => (
        <div key={x.id} className="row small">
          <span className="num">{Days.display(x.paid_on)}</span>
          <span className="muted">{x.kind === 'principal' ? 'Principal' : 'Interest'}{x.note ? ` · ${x.note}` : ''}</span>
          <span className="spacer" />
          <span className="num bold">{Money.format(x.amount_cents)}</span>
          <button type="button" className="btn link danger" onClick={() => app.deleteLoanPayment(x.id)}>Remove</button>
        </div>
      ))}
      <div className="form-grid">
        <Field label="Paid on"><input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
        <Field label="Amount"><AmountInput value={p.amount} onChange={(v) => setP({ ...p, amount: v })} /></Field>
        <Field label="Type"><Segmented value={p.kind} onChange={(v) => setP({ ...p, kind: v })} options={[['interest', 'Interest'], ['principal', 'Principal']]} /></Field>
        <Field label="Note"><input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} placeholder="Optional" /></Field>
      </div>
      <button type="button" className="btn" disabled={!(amount > 0) || !p.date} onClick={add}>Add payment</button>
    </div>
  )
}
