import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { RepeatOptions, isActiveProject, type EntryTemplate } from '../core/models'
import { advance, projectSummary } from '../core/settlement'
import { Icon, MoneyText, PageHead, Section, Segmented } from '../ui/common'

// ---------------------------------------------------------------------------
// Recurring costs and templates
// ---------------------------------------------------------------------------
export function dueTemplates(ts: EntryTemplate[], today: string, withinDays = 7) {
  const limit = Days.adding(withinDays, today)
  return ts.filter((t) => t.active && t.repeat !== 'none' && t.next_due && t.next_due <= limit).sort((a, b) => (a.next_due ?? '').localeCompare(b.next_due ?? ''))
}

export function RecurringPage() {
  const app = useStore()
  const l = app.ledger
  const all = [...l.s.entry_templates].sort((a, b) => a.name.localeCompare(b.name))
  const due = dueTemplates(all, l.today)
  const repeating = all.filter((t) => t.repeat !== 'none' && !due.includes(t))
  const plain = all.filter((t) => t.repeat === 'none')
  const row = (t: EntryTemplate) => {
    const overdue = t.next_due && t.next_due < l.today
    return (
      <div key={t.id} className="item" style={{ flexWrap: 'wrap' }}>
        <button className="grow" onClick={() => app.open({ type: 'template', template: t })} style={{ textAlign: 'left', background: 'none', border: 0, padding: 0, color: 'inherit', minWidth: 180, cursor: 'pointer' }}>
          <div className="title">{t.name}{!t.active && t.repeat !== 'none' ? ' (paused)' : ''}</div>
          <div className="subtitle">{[t.kind === 'bill' ? 'Bill' : 'Receipt', RepeatOptions.find(([k]) => k === t.repeat)?.[1], l.project(t.project_id)?.nickname, l.vendor(t.vendor_id)?.name,
            t.next_due && t.repeat !== 'none' ? `${overdue ? 'was due' : 'next'} ${Days.display(t.next_due)}` : null].filter(Boolean).join(' · ')}</div>
        </button>
        {t.amount_cents ? <MoneyText cents={t.amount_cents} /> : <span className="small muted">amount varies</span>}
        <button className="btn primary" onClick={() => app.open({ type: 'transaction', draft: app.templateDraft(t), link: { template: t } })}>Add now</button>
        {t.repeat !== 'none' && t.next_due && due.includes(t) && <button className="btn link" title="Skip this one and move to the next due date"
          onClick={() => app.saveTemplate({ ...t, next_due: nextAfter(t) }, true)}>Skip</button>}
      </div>
    )
  }
  return (
    <div className="stack">
      <PageHead title="Recurring and templates" sub="Costs you enter again and again: insurance, utilities, dumpster swaps, a supplier you use every week. Nothing posts by itself; a partner adds it and checks the amount." >
        <button className="btn primary" onClick={() => app.open({ type: 'template' })}><Icon name="plus" />New template</button>
      </PageHead>
      <Section title={`Due this week (${due.length})`}>{due.length ? due.map(row) : <div className="empty">Nothing due in the next 7 days.</div>}</Section>
      <Section title="Repeating">{repeating.length ? repeating.map(row) : <div className="empty">No repeating costs yet. Open a receipt or bill and tap “Save as template”.</div>}</Section>
      {plain.length > 0 && <Section title="Templates">{plain.map(row)}</Section>}
    </div>
  )
}
const nextAfter = (t: EntryTemplate) => advance(t.next_due!, t.repeat)

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
type ReportTab = 'pl' | 'partners' | 'budget'

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('pl')
  return (
    <div className="stack">
      <PageHead title="Reports" sub="Profit by project, partner activity, and budget against actual. Everything is worked out from the records you've entered." />
      <Segmented value={tab} onChange={setTab} options={[['pl', 'Project P&L'], ['partners', 'Partners'], ['budget', 'Budget vs actual']]} />
      {tab === 'pl' && <ProjectPL />}
      {tab === 'partners' && <PartnerReport />}
      {tab === 'budget' && <BudgetReport />}
    </div>
  )
}

function ProjectPL() {
  const app = useStore()
  const l = app.ledger
  const ps = [...l.s.projects].sort((a, b) => Number(isActiveProject(b)) - Number(isActiveProject(a)) || a.nickname.localeCompare(b.nickname))
  const rows = ps.map((p) => ({ p, s: projectSummary(l, p) }))
  const tone = (c: number | null) => (c == null ? undefined : { color: c < 0 ? 'var(--bad)' : 'var(--good)' })
  return (
    <Section footer="Cost basis = paid + billed (plus committed for projected). Sold projects show actual profit from net proceeds; others show the forecast from ARV and the target sale date.">
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Project</th><th className="num">Purchase + closing</th><th className="num">Rehab</th><th className="num">Holding</th><th className="num">Cost basis</th><th className="num">Sale / ARV</th><th className="num">Profit</th><th className="num">Return</th></tr></thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`}>{p.nickname}</Link><div className="small muted">{s.profit_is_actual ? 'Sold' : isActiveProject(p) ? 'Projected' : 'Sold, no sale recorded'}</div></td>
                <td className="num">{Money.format(s.basis.spent.purchase + s.basis.spent.closing, false)}</td>
                <td className="num">{Money.format(s.basis.spent.rehab, false)}</td>
                <td className="num">{Money.format(s.basis.spent.holding, false)}</td>
                <td className="num bold">{Money.format(s.basis.spent_total, false)}</td>
                <td className="num">{s.sold_net_cents != null ? Money.format(s.sold_net_cents, false) : s.arv_cents ? Money.format(s.arv_cents, false) : '-'}</td>
                <td className="num bold" style={tone(s.profit_cents)}>{s.profit_cents != null ? Money.format(s.profit_cents, false) : '-'}</td>
                <td className="num">{s.roi_bps != null ? `${(s.roi_bps / 100).toFixed(1)}%` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function PartnerReport() {
  const app = useStore()
  const l = app.ledger
  const bs = l.partnerBalances()
  const ps = [...l.s.projects].sort((a, b) => a.nickname.localeCompare(b.nickname))
  return (
    <div className="stack">
      <Section title="Partner activity" footer="Balance = paid personally − reimbursed: what the LLC still owes each partner for receipts. Contributions and distributions are capital in and out, tracked separately.">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Partner</th><th className="num">Paid personally</th><th className="num">Reimbursed</th><th className="num">LLC owes them</th><th className="num">Contributed</th><th className="num">Distributed</th></tr></thead>
            <tbody>
              {bs.map((b) => (
                <tr key={b.member.user_id}>
                  <td><Link to={`/partners/${b.member.user_id}`}>{b.member.display_name}</Link></td>
                  <td className="num">{Money.format(b.out_of_pocket_cents, false)}</td>
                  <td className="num">{Money.format(b.reimbursed_cents, false)}</td>
                  <td className="num bold">{Money.format(b.owed_cents, false)}</td>
                  <td className="num">{Money.format(b.contributions_cents, false)}</td>
                  <td className="num">{Money.format(b.distributions_cents, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Paid personally, by project" footer="Receipts and bill payments each partner paid with their own money, net of refunds.">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Partner</th>{ps.map((p) => <th key={p.id} className="num">{p.nickname}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {bs.map((b) => (
                <tr key={b.member.user_id}>
                  <td>{b.member.display_name}</td>
                  {ps.map((p) => <td key={p.id} className="num">{Money.format(l.partnerBalance(b.member.user_id, p.id).out_of_pocket_cents, false)}</td>)}
                  <td className="num bold">{Money.format(b.out_of_pocket_cents, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function BudgetReport() {
  const app = useStore()
  const l = app.ledger
  const active = l.s.projects.filter(isActiveProject)
  const [pid, setPid] = useState(active[0]?.id ?? l.s.projects[0]?.id ?? '')
  const lines = pid ? l.categorySummary(pid).filter((x) => x.budget_cents > 0 || x.projected_cents > 0) : []
  const max = Math.max(1, ...lines.map((x) => Math.max(x.budget_cents, x.projected_cents)))
  const w = (c: number) => `${Math.max(c, 0) / max * 100}%`
  return (
    <Section title="Budget vs actual" action={<select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Project" style={{ maxWidth: 240 }}>{l.s.projects.map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}</select>}
      footer="Bars: spent (paid + billed) and committed but not billed. The tick is the budget.">
      <div className="legend row small muted" style={{ gap: 14, padding: '8px 12px 0' }}>
        <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: 'var(--accent)' }} />Spent</span>
        <span className="row" style={{ gap: 6 }}><span className="swatch committed" />Committed</span>
        <span className="row" style={{ gap: 6 }}><span className="swatch tick" />Budget</span>
      </div>
      {lines.length === 0 && <div className="empty">No budget or costs on this project yet.</div>}
      {lines.map((x) => {
        const spent = x.paid_cents + x.unpaid_billed_cents
        const over = x.budget_cents > 0 && x.projected_cents > x.budget_cents
        return (
          <div key={x.category_id} className="item bar-row" title={`${x.name}: spent ${Money.format(spent)}, committed ${Money.format(x.unbilled_committed_cents)}, budget ${Money.format(x.budget_cents)}`}>
            <div className="row" style={{ gap: 8 }}>
              <span className="grow">{x.name}</span>
              <span className="small num muted">{Money.format(x.projected_cents, false)} of {x.budget_cents ? Money.format(x.budget_cents, false) : 'no budget'}</span>
              {over && <span className="small num" style={{ color: 'var(--bad)', fontWeight: 600 }}>▲ over {Money.format(x.projected_cents - x.budget_cents, false)}</span>}
            </div>
            <div className="bar-track">
              <span className="bar-fill" style={{ width: w(spent) }} />
              {x.unbilled_committed_cents > 0 && <span className="bar-fill committed" style={{ width: w(x.unbilled_committed_cents) }} />}
              {x.budget_cents > 0 && <span className="bar-tick" style={{ left: w(x.budget_cents) }} />}
            </div>
          </div>
        )
      })}
    </Section>
  )
}
