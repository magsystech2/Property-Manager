import { useState } from 'react'
import { useStore } from '../store'
import { Money, type Cents } from '../core/money'
import { poolSummary } from '../core/settlement'
import type { Ledger } from '../core/ledger'
import { Section, StatStrip } from './common'
import { Days } from '../core/money'
import { loanStatus } from '../core/loans'

const isLoanCategory = (name: string) => /financ|interest|loan|emi|mortgage/i.test(name)

/** Borrowed money for a project (or all): current loan balances, loan/EMI/interest payments, and payoffs at sale. */
export function loanSummary(l: Ledger, pid: string | null) {
  const projects = l.s.projects.filter((p) => !pid || p.id === pid)
  const balance = projects.reduce((a, p) => a + (p.loan_balance_cents ?? 0), 0)
  const rates = projects.filter((p) => (p.loan_balance_cents ?? 0) > 0 && p.loan_rate_bps).map((p) => p.loan_rate_bps! / 100)
  const paid = projects.reduce((a, p) => a + l.categorySummary(p.id).filter((c) => isLoanCategory(c.name)).reduce((b, c) => b + c.paid_cents, 0), 0)
  const payoff = l.s.proceeds.filter((x) => x.status !== 'void' && (!pid || x.project_id === pid)).reduce((a, x) => a + (x.loan_payoff_cents ?? 0), 0)
  const monthly = projects.reduce((a, p) => a + Math.round((p.loan_balance_cents ?? 0) * (p.loan_rate_bps ?? 0) / 10000 / 12), 0)
  return { balance_cents: balance, paid_cents: paid, payoff_cents: payoff, monthly_interest_cents: monthly, rates }
}

/** One place to check who paid what, each partner's share, and what was borrowed, for one project or all. */
export function MoneyAtAGlance({ projectId, title = 'Who paid what' }: { projectId?: string; title?: string }) {
  const app = useStore()
  const l = app.ledger
  const [sel, setSel] = useState('')
  const pid = projectId ?? (sel || null)
  const s = poolSummary(l, pid)
  const loan = loanSummary(l, pid)
  const dist = (uid: string) => l.s.distributions.filter((d) => d.status !== 'void' && d.partner_user_id === uid && (!pid || d.project_id === pid)).reduce((a, d) => a + d.amount_cents, 0)
  const f = (c: Cents) => Money.format(c, false)
  const loans = (l.s.partner_loans ?? []).filter((x) => !pid || x.project_id === pid).map((x) => loanStatus(x, l.s.partner_loan_payments ?? [], l.today))
  const borrowed = { owed: loans.reduce((a, x) => a + x.owed_now_cents, 0), count: loans.filter((x) => x.loan.status !== 'closed').length }
  const totals = s.partners.reduce((a, p) => ({ c: a.c + p.contributed_cents, p: a.p + p.paid_personally_cents, r: a.r + p.reimbursed_cents, i: a.i + p.put_in_cents, sh: a.sh + p.share_of_spending_cents, d: a.d + dist(p.member.user_id) }), { c: 0, p: 0, r: 0, i: 0, sh: 0, d: 0 })
  return (
    <>
    <Section title={title} plain
      action={projectId ? undefined : (
        <select className="compact-select" value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {l.s.projects.map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}
        </select>
      )}>
      <StatStrip items={[
        { label: 'Total spent', value: f(s.total_spent_cents), note: `${f(s.paid_by_llc_cents)} from LLC account · ${f(s.paid_personally_cents)} by partners` },
        { label: 'Partners put in', value: f(totals.i), note: `${f(s.contributed_cents)} into the LLC account` },
        { label: 'Project loan (balance)', value: f(loan.balance_cents), note: [loan.balance_cents ? `${loan.rates.map((r) => `${r}%`).join(', ')} · ~${f(loan.monthly_interest_cents)}/mo` : loan.payoff_cents ? `${f(loan.payoff_cents)} paid off at sale` : 'No project loan', loan.paid_cents ? `${f(loan.paid_cents)} EMI/interest paid` : ''].filter(Boolean).join(' · ') },
        { label: 'Borrowed by partners', value: f(borrowed.owed), tone: borrowed.owed ? 'bad' : undefined, note: borrowed.count ? `Owed now on ${borrowed.count} personal loan${borrowed.count === 1 ? '' : 's'} · see below` : 'No personal loans recorded' },
      ]} />
      <div className="table-wrap glance-table-wrap">
        <table className="table glance">
          <thead><tr><th>Partner</th><th className="num">Into LLC account</th><th className="num">Paid personally</th><th className="num">Paid back to them</th><th className="num">Total put in</th><th className="num">Split</th><th className="num">Share of costs</th><th className="num">Over / under</th><th className="num">Paid out from sales</th></tr></thead>
          <tbody>
            {s.partners.map((p) => (
              <tr key={p.member.user_id} className={p.member.user_id === app.me ? 'me' : ''}>
                <td className="bold">{p.member.display_name}{p.member.user_id === app.me ? <span className="muted"> · me</span> : null}</td>
                <td className="num">{f(p.contributed_cents)}</td>
                <td className="num">{f(p.paid_personally_cents)}</td>
                <td className="num">{p.reimbursed_cents ? `−${f(p.reimbursed_cents)}` : f(0)}</td>
                <td className="num bold">{f(p.put_in_cents)}</td>
                <td className="num">{p.share_bps ? `${p.share_bps / 100}%` : '—'}</td>
                <td className="num">{f(p.share_of_spending_cents)}</td>
                <td className={`num bold ${p.over_share_cents < 0 ? 'bad' : p.over_share_cents > 0 ? 'good' : ''}`}>{p.over_share_cents > 0 ? '+' : ''}{f(p.over_share_cents)}</td>
                <td className="num">{f(dist(p.member.user_id))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>Total</td><td className="num">{f(totals.c)}</td><td className="num">{f(totals.p)}</td><td className="num">{totals.r ? `−${f(totals.r)}` : f(0)}</td><td className="num">{f(totals.i)}</td><td className="num">100%</td><td className="num">{f(totals.sh)}</td><td /><td className="num">{f(totals.d)}</td></tr></tfoot>
        </table>
      </div>
      <div className="glance-cards">
        {s.partners.map((p) => (
          <div key={p.member.user_id} className="glance-card">
            <div className="row"><span className="bold">{p.member.display_name}{p.member.user_id === app.me ? ' · me' : ''}</span><span className="spacer" />
              <span className={`num bold ${p.over_share_cents < 0 ? 'bad' : p.over_share_cents > 0 ? 'good' : ''}`}>{p.over_share_cents > 0 ? '+' : ''}{f(p.over_share_cents)} vs share</span></div>
            <div className="gc-grid">
              <span>Into LLC account</span><span>{f(p.contributed_cents)}</span>
              <span>Paid personally</span><span>{f(p.paid_personally_cents)}</span>
              <span>Paid back to them</span><span>{f(p.reimbursed_cents)}</span>
              <span className="bold">Total put in</span><span className="bold">{f(p.put_in_cents)}</span>
              <span>Split · share of costs</span><span>{p.share_bps / 100}% · {f(p.share_of_spending_cents)}</span>
              <span>Paid out from sales</span><span>{f(dist(p.member.user_id))}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="section-foot">
        Total put in = into the LLC account + paid personally − paid back. Over / under compares that with each partner’s split of the total spent; a negative number means that partner has covered less than their share so far.
        Left in the LLC account: <b className="num">{f(s.pot_balance_cents)}</b>.{pid ? ' Paid-back amounts aren’t tied to a project, so they only show under All projects.' : ''}
      </div>
    </Section>
    <BorrowedSection projectId={pid} />
    </>
  )
}

/** Personal loans partners took to fund their part: lender, initial amount, rate, interest built up and paid, and what's owed now. */
function BorrowedSection({ projectId }: { projectId: string | null }) {
  const app = useStore()
  const l = app.ledger
  const f = (c: Cents) => Money.format(c, false)
  const rows = (l.s.partner_loans ?? []).filter((x) => !projectId || x.project_id === projectId)
    .map((x) => loanStatus(x, l.s.partner_loan_payments ?? [], l.today))
    .sort((a, b) => l.payerName(a.loan.partner_user_id).localeCompare(l.payerName(b.loan.partner_user_id)) || a.loan.start_date.localeCompare(b.loan.start_date))
  const sum = (k: 'principal_cents' | 'interest_accrued_cents' | 'interest_paid_cents' | 'principal_repaid_cents' | 'owed_now_cents' | 'monthly_interest_cents') =>
    rows.reduce((a, r) => a + (k === 'principal_cents' ? r.loan.principal_cents : r[k]), 0)
  const open = (loan?: typeof rows[number]['loan']) => app.open({ type: 'loan', loan: loan ?? null, projectId })
  return (
    <Section title="Borrowed money" plain action={<button className="btn" onClick={() => open()}>+ Add loan</button>}>
      {rows.length === 0 ? <div className="empty" style={{ borderTop: '2px solid var(--ink)' }}>No personal loans recorded{projectId ? ' for this project' : ''}. Add one when a partner borrows to fund their part.</div> : (
        <>
          <div className="table-wrap glance-table-wrap" style={{ marginTop: 0 }}>
            <table className="table glance">
              <thead><tr><th>Partner</th><th>Lender</th><th>Used for</th><th>Since</th><th className="num">Initial amount</th><th className="num">Rate</th><th className="num">Interest so far</th><th className="num">Interest paid</th><th className="num">Principal paid back</th><th className="num">Owed now</th><th className="num">Per month</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.loan.id} className="clickable" onClick={() => open(r.loan)}>
                    <td className="bold">{l.payerName(r.loan.partner_user_id)}</td>
                    <td>{r.loan.lender}{r.loan.status === 'closed' ? <span className="badge neutral" style={{ marginLeft: 6 }}>Paid off</span> : null}</td>
                    <td>{l.project(r.loan.project_id)?.nickname ?? 'LLC'}</td>
                    <td className="num">{Days.display(r.loan.start_date)}</td>
                    <td className="num">{f(r.loan.principal_cents)}</td>
                    <td className="num">{r.loan.rate_bps / 100}%</td>
                    <td className="num">{f(r.interest_accrued_cents)}</td>
                    <td className="num">{f(r.interest_paid_cents)}</td>
                    <td className="num">{f(r.principal_repaid_cents)}</td>
                    <td className="num bold">{f(r.owed_now_cents)}</td>
                    <td className="num">{f(r.monthly_interest_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td /><td /><td /><td className="num">{f(sum('principal_cents'))}</td><td /><td className="num">{f(sum('interest_accrued_cents'))}</td><td className="num">{f(sum('interest_paid_cents'))}</td><td className="num">{f(sum('principal_repaid_cents'))}</td><td className="num">{f(sum('owed_now_cents'))}</td><td className="num">{f(sum('monthly_interest_cents'))}</td></tr></tfoot>
            </table>
          </div>
          <div className="glance-cards" style={{ marginTop: 0 }}>
            {rows.map((r) => (
              <button key={r.loan.id} className="glance-card plain-btn" onClick={() => open(r.loan)}>
                <div className="row"><span className="bold">{l.payerName(r.loan.partner_user_id)} · {r.loan.lender}</span><span className="spacer" /><span className="num bold">{f(r.owed_now_cents)} owed</span></div>
                <div className="gc-grid">
                  <span>Initial amount</span><span>{f(r.loan.principal_cents)} at {r.loan.rate_bps / 100}%</span>
                  <span>Since · used for</span><span>{Days.display(r.loan.start_date)} · {l.project(r.loan.project_id)?.nickname ?? 'LLC'}</span>
                  <span>Interest so far</span><span>{f(r.interest_accrued_cents)}</span>
                  <span>Interest paid</span><span>{f(r.interest_paid_cents)}</span>
                  <span>Principal paid back</span><span>{f(r.principal_repaid_cents)}</span>
                  <span>Per month now</span><span>{f(r.monthly_interest_cents)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="section-foot">For reference only: this money is already counted as the partner’s contribution or personal payment above, so loans don’t change anyone’s balance or payout. Interest is simple yearly interest from the date borrowed; tap a loan to record interest or principal payments.</div>
    </Section>
  )
}
