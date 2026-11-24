import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { cashPlan } from '../core/planning'
import { AmountInput, Field, MoneyText, PageHead, Section, Segmented } from '../ui/common'

export function CashPage() {
  const app = useStore()
  const l = app.ledger
  const [days, setDays] = useState<'14' | '30' | '60'>('30')
  const plan = cashPlan(l, Number(days))
  const [editing, setEditing] = useState(plan.cash_on_hand_cents == null)
  const [amount, setAmount] = useState(plan.cash_on_hand_cents != null ? Money.plain(plan.cash_on_hand_cents) : '')
  const [asOf, setAsOf] = useState(Days.today)
  const cents = Money.parse(amount)
  const end = plan.cash_on_hand_cents != null ? plan.cash_on_hand_cents - plan.total_cents : null
  return (
    <div className="stack">
      <PageHead title="Cash needed" sub="What the LLC is expected to pay out soon: unpaid bills by due date, reimbursements ready to pay, and scheduled contractor draws." />
      <div className="row wrap" style={{ gap: 8 }}>
        <Segmented value={days} onChange={setDays} options={[['14', 'Next 14 days'], ['30', 'Next 30 days'], ['60', 'Next 60 days']]} />
      </div>
      <div className="tiles">
        <div className="card tile">
          <div className="small muted">Cash on hand</div>
          <div className="big">{plan.cash_on_hand_cents != null ? Money.format(plan.cash_on_hand_cents) : 'Not set'}</div>
          <div className="small muted">{plan.as_of ? `as of ${Days.display(plan.as_of)}` : 'Enter the LLC bank balance'} · <button className="btn link" style={{ padding: 0 }} onClick={() => setEditing(!editing)}>Update</button></div>
        </div>
        <div className="card tile"><div className="small muted">Going out, next {days} days</div><div className="big">{Money.format(plan.total_cents)}</div><div className="small muted">{plan.events.length} payments</div></div>
        <div className="card tile">
          <div className="small muted">Left after that</div>
          <div className="big" style={end != null && end < 0 ? { color: 'var(--bad)' } : undefined}>{end != null ? Money.format(end) : '-'}</div>
          {plan.shortfall && <div className="small" style={{ color: 'var(--bad)' }}>Short by {Money.format(plan.shortfall.short_by_cents)} on {Days.display(plan.shortfall.date)}</div>}
        </div>
      </div>
      {editing && (
        <Section title="Cash on hand" footer="The LLC's bank balance today. Each update is kept, so you can see how it changed.">
          <form className="form-grid" style={{ padding: 12, alignItems: 'end' }} onSubmit={async (e) => { e.preventDefault(); if (cents != null && await app.setCash(cents, asOf, 'LLC accounts')) setEditing(false) }}>
            <Field label="Balance"><AmountInput value={amount} onChange={setAmount} /></Field>
            <Field label="As of"><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
            <button className="btn primary" disabled={cents == null}>Save</button>
          </form>
        </Section>
      )}
      {plan.shortfall && (
        <div className="callout bad" role="alert">
          Expected payments exceed the cash on hand starting {Days.display(plan.shortfall.date)}, short by {Money.format(plan.shortfall.short_by_cents)}. Plan a partner contribution or move a payment date.
        </div>
      )}
      <div className="grid2">
        <Section title="Day by day" footer="Overdue bills, bills with no due date and reimbursements ready to pay count today. Draws never count more than what's still unbilled on the agreement.">
          {plan.days.length === 0 && <div className="empty">Nothing due in the next {days} days.</div>}
          {plan.days.map((d) => (
            <div key={d.date} className="item" style={{ display: 'block' }}>
              <div className="row" style={{ gap: 8 }}>
                <strong className="grow">{d.date === l.today ? 'Today' : Days.display(d.date)}</strong>
                <span className="small muted">out {Money.format(d.out_cents)}</span>
                {d.balance_cents != null && <span className="num small" style={{ minWidth: 100, textAlign: 'right', color: d.balance_cents < 0 ? 'var(--bad)' : undefined, fontWeight: 600 }}>{Money.format(d.balance_cents)} left</span>}
              </div>
              {d.events.map((e, i) => (
                <Link key={i} to={e.link} className="row small" style={{ gap: 8, color: 'inherit', textDecoration: 'none', padding: '3px 0 0 10px' }}>
                  <span className={`badge ${e.kind === 'draw' ? 'neutral' : e.kind === 'reimbursement' ? 'warn' : 'neutral'}`}>{e.kind === 'bill' ? 'Bill' : e.kind === 'draw' ? 'Draw' : 'Reimburse'}</span>
                  <span className="grow">{e.title} · {e.subtitle}{e.project_id ? ` · ${l.project(e.project_id)?.nickname}` : ''}</span>
                  <MoneyText cents={e.amount_cents} />
                </Link>
              ))}
            </div>
          ))}
        </Section>
        <div className="stack">
          <Section title="By property">
            {plan.byProject.length === 0 && <div className="empty">Nothing going out.</div>}
            {plan.byProject.map((p) => (
              <div key={p.project_id ?? 'llc'} className="item">
                <span className="grow">{p.project_id ? <Link to={`/projects/${p.project_id}`}>{l.project(p.project_id)?.nickname}</Link> : 'Partner reimbursements'}</span>
                <MoneyText cents={p.total_cents} bold />
              </div>
            ))}
          </Section>
          <Section title="Scheduled draws" footer="Add draws from a contractor agreement's page (Activity → the commitment → Schedule a draw).">
            {l.s.scheduled_draws.length === 0 && <div className="empty">No draws scheduled.</div>}
            {[...l.s.scheduled_draws].sort((a, b) => a.due_date.localeCompare(b.due_date)).map((d) => {
              const c = l.s.commitments.find((x) => x.id === d.commitment_id)
              return (
                <div key={d.id} className="item">
                  <Link className="grow" to={`/records/commitment/${d.commitment_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    <div className="title">{l.vendor(c?.vendor_id)?.name ?? 'Draw'} · {Days.display(d.due_date)}</div>
                    <div className="subtitle">{l.project(c?.project_id)?.nickname}{d.description ? ` · ${d.description}` : ''}</div>
                  </Link>
                  <MoneyText cents={d.amount_cents} />
                </div>
              )
            })}
          </Section>
        </div>
      </div>
    </div>
  )
}
