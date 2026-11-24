import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Money } from '../core/money'
import { isActiveProject, projectTypeLabel, projectStatusLabel, type Project } from '../core/models'
import { EntryList, Icon, MoneyText, PageHead, Section, Tile } from '../ui/common'
import { recordsLink } from './Activity'
import { cashPlan, missingReceipts } from '../core/planning'
import { dueTemplates } from './Reports'

/** Chips for the work waiting this week, so phone users reach the review screens from Home. */
function ThisWeek() {
  const app = useStore()
  const l = app.ledger
  const inbox = l.s.inbox_items.filter((i) => i.status === 'new').length
  const unmatched = l.s.statement_lines.filter((x) => x.status === 'unmatched').length
  const missing = missingReceipts(l).filter((m) => m.owner === app.me).length
  const plan = cashPlan(l)
  const due = dueTemplates(l.s.entry_templates, l.today).length
  const chips: [string, string, string, boolean][] = [
    ['/review', 'check', 'Weekly review', false],
    ['/inbox', 'tray', `${inbox} in the inbox`, inbox > 0],
    ['/statements', 'bank', `${unmatched} charges to match`, unmatched > 0],
    ['/missing', 'receipt', `${missing} missing receipts of yours`, missing > 0],
    ['/cash', 'cash', plan.shortfall ? `Cash short ${Money.format(plan.shortfall.short_by_cents, false)} by ${new Date(plan.shortfall.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `${Money.format(plan.total_cents, false)} due in 30 days`, !!plan.shortfall],
    ['/recurring', 'repeat', due ? `${due} recurring cost${due === 1 ? '' : 's'} due` : 'Recurring', due > 0],
    ['/reports', 'chart', 'Reports', false],
  ]
  return (
    <div className="chips">
      {chips.map(([to, icon, label, hot]) => <Link key={to} to={to} className={`chip ${hot ? 'hot' : ''}`}><Icon name={icon} size={14} />{label}</Link>)}
    </div>
  )
}

export function HomePage() {
  const app = useStore()
  const l = app.ledger
  const h = l.home()
  const open = l.openCommitments().filter(([c]) => { const p = l.project(c.project_id); return p ? isActiveProject(p) : false })
  const unbilled = open.reduce((a, [, st]) => a + st.unbilled_cents, 0)
  const projects = l.s.projects.filter(isActiveProject).sort((a, b) => a.nickname.localeCompare(b.nickname))
  return (
    <div className="stack">
      <PageHead title={app.workspace?.name ?? 'Home'} sub={app.lastSynced ? `Updated ${app.lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : undefined}>
        <button className="btn" onClick={() => app.reload()} disabled={app.syncing}><Icon name="refresh" />{app.syncing ? 'Refreshing…' : 'Refresh'}</button>
      </PageHead>

      <ThisWeek />

      {h.overdue.length > 0 && (
        <Section title={<span className="bad row" style={{ gap: 6 }}><Icon name="alert" size={14} />Overdue bills</span>}>
          <EntryList entries={h.overdue} showDue />
        </Section>
      )}
      {h.needs_review.length > 0 && (
        <Section title="Needs review or payment"
          footer={app.workspace?.require_review ? 'Review is on: another partner must approve bills, change orders and reimbursement requests.' : undefined}>
          <EntryList entries={h.needs_review} />
        </Section>
      )}
      {app.draftList.length > 0 && (
        <Section title="Drafts in this browser" footer="Drafts aren't visible to partners until you post them.">
          <Link className="item" to="/drafts"><Icon name="tray" /><span className="grow">{app.draftList.length} draft{app.draftList.length === 1 ? '' : 's'}</span><Icon name="chevron" /></Link>
        </Section>
      )}

      <div className="tiles">
        <Tile title="Paid, active projects" cents={h.paid_active_cents} icon="check"
          to={recordsLink('Paid on active projects', h.paid_active_sources, 'Receipts and bill payments on projects that aren’t sold yet. Reimbursements to partners are not project costs and aren’t included.')} />
        <Tile title="Unpaid bills" cents={h.unpaid_bills_cents} icon="doc" detail={`${h.unpaid_bills.length} bills`}
          to={recordsLink('Unpaid bills', h.unpaid_bills.map((e) => e.ref), 'Bills with a balance still owed to the vendor, after payments and credits.')} />
        <Tile title="Owed to partners" cents={h.owed_to_partners_cents} icon="users"
          to={recordsLink('Owed to partners', h.partner_balances.flatMap((b) => l.reimbursableItems(b.member.user_id).map((i) => i.ref)), 'Costs partners paid personally that the LLC hasn’t reimbursed yet. Owed = paid personally minus reimbursements received.')} />
        <Tile title="Committed, not billed" cents={unbilled} icon="sign"
          to={recordsLink('Committed, not billed', open.map(([c]) => ({ kind: 'commitment' as const, id: c.id })), 'Contractor and supplier agreements (with approved change orders) that haven’t been invoiced yet.')} />
      </div>

      <div className="grid2">
        <Section title="Due in the next 14 days">
          <EntryList entries={h.due_soon} showDue empty="No bills due in the next 14 days." />
        </Section>
        <Section title="Owed to each partner">
          {h.partner_balances.map((b) => (
            <Link key={b.member.user_id} className="item" to={`/partners/${b.member.user_id}`}>
              <span className="grow">{b.member.display_name}{b.member.user_id === app.me ? ' (me)' : ''}</span>
              <MoneyText cents={b.owed_cents} bold />
              <Icon name="chevron" size={14} />
            </Link>
          ))}
        </Section>
      </div>

      <Section title="Active projects" action={<Link to="/projects" className="small">All projects</Link>}>
        {projects.length === 0 && <div className="empty">No active projects. <button className="btn link" onClick={() => app.open({ type: 'project' })}>Add one</button></div>}
        {projects.map((p) => <ProjectRow key={p.id} project={p} />)}
      </Section>
    </div>
  )
}

export function ProjectRow({ project }: { project: Project }) {
  const app = useStore()
  const t = app.ledger.totals(project.id)
  const pct = t.budget_cents > 0 ? Math.min(100, (t.projected_cents / t.budget_cents) * 100) : 0
  return (
    <Link className="item" to={`/projects/${project.id}`} style={{ alignItems: 'stretch' }}>
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="row">
          <span className="title">{project.nickname}</span>
          <span className="spacer" />
          <span className="small muted">{projectTypeLabel(project)} · {projectStatusLabel(project)}</span>
        </div>
        {project.address && <div className="subtitle">{project.address}</div>}
        {t.budget_cents > 0 && <div className={`progress ${t.remaining_cents < 0 ? 'over' : ''}`}><div style={{ width: `${pct}%` }} /></div>}
        <div className="row small">
          <span className="num">Projected {Money.format(t.projected_cents, false)} of {Money.format(t.budget_cents, false)} budget</span>
          <span className="spacer" />
          {t.remaining_cents < 0 && <span className="bad bold row" style={{ gap: 4 }}><Icon name="alert" size={13} />Over by {Money.format(-t.remaining_cents, false)}</span>}
        </div>
      </div>
    </Link>
  )
}
