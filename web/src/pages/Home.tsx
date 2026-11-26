import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Money, type Cents } from '../core/money'
import { isActiveProject, projectTypeLabel, projectStatusLabel, type Project } from '../core/models'
import { EntryList, Icon, Section, Tile } from '../ui/common'
import { recordsLink } from './Activity'
import { cashPlan, missingReceipts } from '../core/planning'
import { dueTemplates } from './Reports'
import { poolSummary, profitShares, projectSummary, settlement } from '../core/settlement'
import type { Ledger } from '../core/ledger'

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' }
const firstName = (s: string) => s.split(/\s+/)[0]
const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const fmt = (c: Cents) => Money.format(c, false)

/** One partner's stake in one project: what they put in, their split, and what they can expect back. */
export function myStake(l: Ledger, uid: string, p: Project) {
  const pool = poolSummary(l, p.id).partners.find((x) => x.member.user_id === uid)
  const bps = profitShares(l, p.id).shares.find((x) => x.partner_user_id === uid)?.share_bps ?? 0
  const sum = projectSummary(l, p)
  const sold = sum.profit_is_actual
  const payout = sold ? settlement(l, p.id).partners.find((x) => x.member.user_id === uid) : undefined
  const profitShare = sum.profit_cents != null ? Math.round(sum.profit_cents * bps / 10000) : null
  return {
    put_in_cents: pool?.put_in_cents ?? 0, share_bps: bps, sold,
    profit_cents: sum.profit_cents, my_profit_cents: payout ? payout.profit_share_cents : profitShare,
    due_cents: payout?.due_cents ?? null, paid_out_cents: payout?.distributed_cents ?? 0, still_to_come_cents: payout ? Math.max(payout.remaining_cents, 0) : null,
  }
}

interface Todo { to: string; icon: string; text: string; detail?: string; tone?: 'bad' | 'warn' }

/** What needs this partner, most urgent first. Bookkeeping chores for the whole LLC come last as one line. */
function todos(app: ReturnType<typeof useStore>): Todo[] {
  const l = app.ledger
  const me = app.me
  const h = l.home()
  const out: Todo[] = []
  const approvals = h.needs_review.filter((e) => e.status.text === 'Needs approval' && e.created_by !== me)
  const requests = h.needs_review.filter((e) => e.status.text === 'Requested' && e.partner_id !== me)
  if (h.overdue.length) out.push({ to: recordsLink('Overdue bills', h.overdue.map((e) => e.ref)), icon: 'alert', tone: 'bad',
    text: `${h.overdue.length} overdue bill${h.overdue.length === 1 ? '' : 's'}`, detail: fmt(h.overdue.reduce((a, e) => a + l.balance(e.ref.id).outstanding_cents, 0)) })
  if (approvals.length) out.push({ to: recordsLink('Waiting for your approval', approvals.map((e) => e.ref)), icon: 'check', tone: 'warn',
    text: `${approvals.length} item${approvals.length === 1 ? '' : 's'} waiting for your approval`, detail: fmt(approvals.reduce((a, e) => a + e.amount_cents, 0)) })
  if (requests.length) out.push({ to: recordsLink('Reimbursement requests', requests.map((e) => e.ref)), icon: 'users', tone: 'warn',
    text: `${requests.map((e) => l.payerName(e.partner_id ?? null)).join(', ')} asked to be paid back`, detail: fmt(requests.reduce((a, e) => a + e.amount_cents, 0)) })
  const missing = missingReceipts(l).filter((m) => m.owner === me).length
  if (missing) out.push({ to: '/missing', icon: 'receipt', tone: 'warn', text: `${missing} of your receipts need a photo or match` })
  const plan = cashPlan(l)
  if (plan.shortfall) out.push({ to: '/cash', icon: 'cash', tone: 'bad',
    text: `LLC account short ${fmt(plan.shortfall.short_by_cents)} by ${new Date(plan.shortfall.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` })
  const openIssues = (l.s.issue_reports ?? []).filter((r) => r.status === 'open').length
  if (openIssues) out.push({ to: '/issues', icon: 'alert', text: `${openIssues} reported issue${openIssues === 1 ? '' : 's'} to look at` })
  if (app.draftList.length) out.push({ to: '/drafts', icon: 'tray', text: `${app.draftList.length} unfinished draft${app.draftList.length === 1 ? '' : 's'} in this browser` })
  const inbox = l.s.inbox_items.filter((i) => i.status === 'new').length
  const unmatched = l.s.statement_lines.filter((x) => x.status === 'unmatched').length
  const due = dueTemplates(l.s.entry_templates, l.today).length
  const chores = [inbox && `${inbox} in inbox`, unmatched && `${unmatched} card charges to match`, due && `${due} recurring due`].filter(Boolean)
  if (chores.length) out.push({ to: '/books', icon: 'list', text: 'Bookkeeping', detail: chores.join(' · ') })
  return out
}

export function HomePage() {
  const app = useStore()
  const l = app.ledger
  const me = app.me ?? ''
  const name = app.myMember?.display_name ?? 'Partner'
  const pool = poolSummary(l, null)
  const mine = pool.partners.find((p) => p.member.user_id === me)
  const bal = l.partnerBalance(me)
  const projects = [...l.s.projects].sort((a, b) => Number(!isActiveProject(a)) - Number(!isActiveProject(b)) || a.nickname.localeCompare(b.nickname))
  const stakes = projects.map((p) => ({ p, s: myStake(l, me, p) }))
  // Everything I put in comes back first, plus my profit share on each project, less what's already been paid out to me.
  const expected = Math.max((mine?.put_in_cents ?? 0) + stakes.reduce((a, { s }) => a + (s.my_profit_cents ?? 0), 0) - bal.distributions_cents, 0)
  const list = todos(app)
  const over = mine?.over_share_cents ?? 0
  return (
    <div className="stack home">
      <div className="hello">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="small muted">{app.workspace?.name}{app.lastSynced ? ` · updated ${app.lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</div>
          <h1>{greeting()}, {firstName(name)}</h1>
        </div>
        <Link className="btn icon" to="/activity" aria-label="Search records" title="Search"><Icon name="search" /></Link>
        <button className="btn icon" onClick={() => app.reload()} disabled={app.syncing} aria-label="Refresh" title="Refresh"><Icon name="refresh" /></button>
      </div>

      <section className="card hero" aria-label="My position">
        <div className="hero-head"><h2>My position</h2><span className="spacer" /><Link className="small" to={`/partners/${me}`}>Details</Link></div>
        <div className="hero-grid">
          <Stat label="I've put in" cents={mine?.put_in_cents ?? 0} note={`${fmt(mine?.contributed_cents ?? 0)} to the LLC · ${fmt(mine?.paid_personally_cents ?? 0)} from my pocket`} big />
          <Stat label="LLC owes me" cents={bal.owed_cents} note={bal.pending_reimbursement_cents ? `${fmt(bal.pending_reimbursement_cents)} requested` : 'for receipts I paid'}
            action={bal.owed_cents > 0 ? <button className="btn link" onClick={() => app.open({ type: 'reimbursement', partnerId: me })}>Request it</button> : undefined} />
          <Stat label="vs my share" cents={over} signed tone={over < 0 ? 'bad' : over > 0 ? 'good' : undefined}
            note={over > 0 ? 'more than my share' : over < 0 ? 'behind my share' : 'even with partners'} />
          <Stat label="Expected back" cents={expected} note={bal.distributions_cents ? `${fmt(bal.distributions_cents)} already paid out` : 'what I put in + my profit share'} tone="good" />
        </div>
      </section>

      {list.length > 0 ? (
        <Section title="Needs you">
          {list.map((t) => (
            <Link key={t.text} className="item todo" to={t.to}>
              <span className={`todo-icon ${t.tone ?? ''}`}><Icon name={t.icon} size={16} /></span>
              <span className="grow"><span className="title">{t.text}</span>{t.detail && <span className="subtitle"> {t.detail}</span>}</span>
              <Icon name="chevron" size={14} />
            </Link>
          ))}
        </Section>
      ) : <div className="card empty" style={{ textAlign: 'center' }}><Icon name="check" /> All caught up. Nothing needs you right now.</div>}

      <Section title="My projects" action={<Link to="/projects" className="small">All projects</Link>} plain>
        <div className="proj-cards">
          {stakes.map(({ p, s }) => <StakeCard key={p.id} project={p} stake={s} />)}
          {stakes.length === 0 && <div className="card empty">No projects yet. <button className="btn link" onClick={() => app.open({ type: 'project' })}>Add one</button></div>}
        </div>
      </Section>

      <Section title="Partners" action={<Link to="/partners" className="small">Who put in what</Link>} plain>
        <div className="partner-strip">
          {pool.partners.map((p) => (
            <Link key={p.member.user_id} className={`card partner-chip ${p.member.user_id === me ? 'me' : ''}`} to={`/partners/${p.member.user_id}`}>
              <span className="avatar">{initials(p.member.display_name)}</span>
              <span className="grow">
                <span className="title">{p.member.display_name}</span>
                <span className="subtitle num">Put in {fmt(p.put_in_cents)}</span>
              </span>
              <span className={`num bold ${p.over_share_cents < 0 ? 'bad' : p.over_share_cents > 0 ? 'good' : ''}`} title="Compared with their share of costs">
                {p.over_share_cents > 0 ? '+' : ''}{fmt(p.over_share_cents)}
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <LLCOverview />
    </div>
  )
}

function Stat({ label, cents, note, tone, signed, big, action }: { label: string; cents: Cents; note?: string; tone?: 'good' | 'bad'; signed?: boolean; big?: boolean; action?: ReactNode }) {
  return (
    <div className={`stat ${big ? 'big' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value num ${tone ?? ''}`}>{signed && cents > 0 ? '+' : ''}{fmt(cents)}</div>
      {note && <div className="stat-note">{note}</div>}
      {action}
    </div>
  )
}

function StakeCard({ project: p, stake: s }: { project: Project; stake: ReturnType<typeof myStake> }) {
  const app = useStore()
  const t = app.ledger.totals(p.id)
  const pct = t.budget_cents > 0 ? Math.min(100, (t.projected_cents / t.budget_cents) * 100) : 0
  return (
    <Link className="card stake" to={`/projects/${p.id}`}>
      <div className="row">
        <span className="title">{p.nickname}</span>
        <span className="spacer" />
        <span className={`badge ${s.sold ? 'good' : 'neutral'}`}>{projectStatusLabel(p)}</span>
      </div>
      <div className="small muted">{projectTypeLabel(p)}{p.address ? ` · ${p.address}` : ''}</div>
      <div className="stake-nums">
        <div><div className="stat-label">I put in</div><div className="num bold">{fmt(s.put_in_cents)}</div></div>
        <div><div className="stat-label">My split</div><div className="num bold">{s.share_bps / 100}%</div></div>
        <div>
          <div className="stat-label">{s.sold ? 'My profit' : 'Est. profit'}</div>
          <div className={`num bold ${(s.my_profit_cents ?? 0) < 0 ? 'bad' : 'good'}`}>{s.my_profit_cents == null ? '—' : fmt(s.my_profit_cents)}</div>
        </div>
      </div>
      {s.sold ? (
        <div className="small">{s.still_to_come_cents ? <span className="warn bold">{fmt(s.still_to_come_cents)} still to be paid to me</span> : <span className="good bold">Paid out {fmt(s.paid_out_cents)}</span>}</div>
      ) : (
        <>
          {t.budget_cents > 0 && <div className={`progress ${t.remaining_cents < 0 ? 'over' : ''}`}><div style={{ width: `${pct}%` }} /></div>}
          <div className="small muted num">{t.budget_cents > 0 ? `${fmt(t.projected_cents)} of ${fmt(t.budget_cents)} budget` : `${fmt(t.projected_cents)} spent and committed`}
            {s.my_profit_cents == null && ' · add an expected sale price to see profit'}</div>
        </>
      )}
    </Link>
  )
}

/** The whole LLC's numbers, folded away by default: most partners only need their own position. */
function LLCOverview() {
  const app = useStore()
  const l = app.ledger
  const h = l.home()
  const open = l.openCommitments().filter(([c]) => { const p = l.project(c.project_id); return p ? isActiveProject(p) : false })
  const unbilled = open.reduce((a, [, st]) => a + st.unbilled_cents, 0)
  return (
    <details className="fold">
      <summary><h2>Whole LLC</h2><span className="small muted">Paid, unpaid bills, owed to partners, due soon</span></summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="tiles">
          <Tile title="Paid, active projects" cents={h.paid_active_cents} icon="check"
            to={recordsLink('Paid on active projects', h.paid_active_sources, 'Receipts and bill payments on projects that aren’t sold yet. Reimbursements to partners are not project costs and aren’t included.')} />
          <Tile title="Unpaid bills" cents={h.unpaid_bills_cents} icon="doc" detail={`${h.unpaid_bills.length} bills`}
            to={recordsLink('Unpaid bills', h.unpaid_bills.map((e) => e.ref), 'Bills with a balance still owed to the vendor, after payments and credits.')} />
          <Tile title="Owed to partners" cents={h.owed_to_partners_cents} icon="users"
            to={recordsLink('Owed to partners', h.partner_balances.flatMap((b) => l.reimbursableItems(b.member.user_id).map((i) => i.ref)), 'Costs partners paid personally that the LLC hasn’t reimbursed yet.')} />
          <Tile title="Committed, not billed" cents={unbilled} icon="sign"
            to={recordsLink('Committed, not billed', open.map(([c]) => ({ kind: 'commitment' as const, id: c.id })), 'Contractor and supplier agreements that haven’t been invoiced yet.')} />
        </div>
        <Section title="Bills due in the next 14 days">
          <EntryList entries={h.due_soon} showDue empty="No bills due in the next 14 days." />
        </Section>
        {h.needs_review.length > 0 && <Section title="Waiting on review or payment"><EntryList entries={h.needs_review} /></Section>}
      </div>
    </details>
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

/** Bookkeeping hub: the chores and tools that used to fill the sidebar, in one place. Also the phone's "More" tab. */
export function BooksPage() {
  const app = useStore()
  const l = app.ledger
  const inbox = l.s.inbox_items.filter((i) => i.status === 'new').length
  const unmatched = l.s.statement_lines.filter((x) => x.status === 'unmatched').length
  const due = dueTemplates(l.s.entry_templates, l.today).length
  const issues = (l.s.issue_reports ?? []).filter((r) => r.status === 'open').length
  const groups: [string, [string, string, string, string?][]][] = [
    ['To do', [
      ['/review', 'check', 'Weekly review', 'Approve, match and file the week'],
      ['/inbox', 'tray', 'Inbox', inbox ? `${inbox} waiting to be filed` : 'Receipts and invoices to file later'],
      ['/statements', 'bank', 'Match card statements', unmatched ? `${unmatched} charges to match` : 'Upload a statement CSV'],
      ['/missing', 'receipt', 'Missing receipts', 'Charges with no photo or receipt'],
      ['/recurring', 'repeat', 'Recurring costs', due ? `${due} due now` : 'Insurance, utilities, dumpster'],
      ['/issues', 'alert', 'Issues', issues ? `${issues} open` : 'Problems partners reported'],
    ]],
    ['Look up', [
      ['/activity', 'list', 'All activity', 'Every receipt, bill and payment, with search'],
      ['/cash', 'cash', 'Cash needed', 'What the LLC account must cover in 30 days'],
      ['/reports', 'chart', 'Reports', 'By project, category and partner'],
      ['/vendors', 'store', 'Vendors', 'Contractors and suppliers'],
    ]],
    ['Data', [
      ['/import', 'list', 'Bulk upload', 'Many records from a spreadsheet'],
      ['/export', 'download', 'Export CSV', 'For your accountant'],
      ['/settings', 'settings', 'Settings', 'Members, invites, sign out'],
    ]],
  ]
  return (
    <div className="stack">
      <div className="hello"><h1 style={{ flex: 1 }}>Books</h1></div>
      {groups.map(([title, rows]) => (
        <Section key={title} title={title}>
          {rows.map(([to, icon, label, desc]) => (
            <Link key={to} className="item" to={to}>
              <span className="todo-icon"><Icon name={icon} size={16} /></span>
              <span className="grow"><div className="title">{label}</div>{desc && <div className="subtitle">{desc}</div>}</span>
              <Icon name="chevron" size={14} />
            </Link>
          ))}
        </Section>
      ))}
    </div>
  )
}
