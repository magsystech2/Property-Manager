import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Money, type Cents } from '../core/money'
import { isActiveProject, projectTypeLabel, projectStatusLabel, type Project } from '../core/models'
import { EntryList, Hero, Icon, Section, StatStrip, Tile } from '../ui/common'
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

interface Todo { to: string; kicker: string; title: string; sub?: string; amount?: string; status?: string; tone?: 'bad' | 'warn' }

const shortDay = (d?: string | null) => d ? new Date(d + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

/** What needs this partner, most urgent first. Bookkeeping chores for the whole LLC come last as one line. */
function todos(app: ReturnType<typeof useStore>): Todo[] {
  const l = app.ledger
  const me = app.me
  const h = l.home()
  const out: Todo[] = []
  for (const e of h.overdue) out.push({ to: `/records/bill/${e.ref.id}`, kicker: 'Overdue bill', title: e.title, tone: 'bad',
    sub: [l.project(e.project_id)?.nickname, `due ${shortDay(e.due_date)}`].filter(Boolean).join(' · '), amount: fmt(l.balance(e.ref.id).outstanding_cents), status: 'Overdue' })
  for (const e of h.needs_review.filter((x) => x.status.text === 'Needs approval' && x.created_by !== me))
    out.push({ to: `/records/${e.ref.kind}/${e.ref.id}`, kicker: 'Waiting for your approval', title: e.subtitle.split(' · ').slice(-1)[0] || e.title, sub: e.title, amount: fmt(e.amount_cents), status: 'Needs approval', tone: 'warn' })
  for (const e of h.needs_review.filter((x) => x.status.text === 'Requested' && x.partner_id !== me))
    out.push({ to: `/records/${e.ref.kind}/${e.ref.id}`, kicker: 'Reimbursement request', title: `${l.payerName(e.partner_id ?? null)} asked to be paid back`, sub: `Requested ${shortDay(e.date)}`, amount: fmt(e.amount_cents), status: 'Requested', tone: 'warn' })
  const missing = missingReceipts(l).filter((m) => m.owner === me).length
  if (missing) out.push({ to: '/missing', kicker: 'Missing receipts', title: 'Missing receipts', sub: 'Assigned to you', amount: `${missing} receipt${missing === 1 ? '' : 's'}`, status: 'View records →', tone: 'warn' })
  const plan = cashPlan(l)
  if (plan.shortfall) out.push({ to: '/cash', kicker: 'Cash short', title: 'LLC account will run short', sub: `by ${shortDay(plan.shortfall.date)}`, amount: fmt(plan.shortfall.short_by_cents), status: 'Open cash plan', tone: 'bad' })
  const flagged = new Set(l.reviewFlags.map((r) => r.record_id)).size
  if (flagged) out.push({ to: '/needs-review', kicker: 'Needs review', title: `${flagged} ${flagged === 1 ? 'entry needs' : 'entries need'} review`, sub: l.reviewFlags[0]?.note ?? 'Flagged by partners', amount: String(flagged), status: 'Review →', tone: 'warn' })
  const openIssues = l.openIssues.length
  if (openIssues) out.push({ to: '/issues', kicker: 'Reported issues', title: 'Reported issues', sub: 'From partners', amount: String(openIssues), status: 'Open' })
  if (app.draftList.length) out.push({ to: '/drafts', kicker: 'Drafts', title: 'Unfinished drafts', sub: 'In this browser only', amount: String(app.draftList.length) })
  const inbox = l.s.inbox_items.filter((i) => i.status === 'new').length
  const unmatched = l.s.statement_lines.filter((x) => x.status === 'unmatched').length
  const due = dueTemplates(l.s.entry_templates, l.today).length
  const chores = [inbox && `${inbox} in inbox`, unmatched && `${unmatched} charges to match`, due && `${due} recurring due`].filter(Boolean)
  if (chores.length) out.push({ to: '/review', kicker: 'Bookkeeping', title: 'Bookkeeping', sub: chores.join(' · '), status: 'Weekly review →' })
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
  const top = list[0]
  const over = mine?.over_share_cents ?? 0
  const h = l.home()
  const plan = cashPlan(l)
  return (
    <div className="stack home">
      <div className="page-title">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{greeting()}, {firstName(name)}</h1>
          <div className="sub">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}{app.lastSynced ? ` · updated ${app.lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</div>
        </div>
        <button className="btn" onClick={() => app.reload()} disabled={app.syncing} aria-label="Refresh"><Icon name="refresh" /></button>
        <Link className="btn primary" to="/review">Open weekly review ↗</Link>
      </div>

      <Hero label="What I’ve put in" cents={mine?.put_in_cents ?? 0}
        side={top ? (
          <>
            <div className="kicker">{top.kicker}</div>
            <div className="side-title">{top.title}</div>
            <div className="side-sub">{[top.amount, top.sub].filter(Boolean).join(' · ')}</div>
            <Link className="side-link" to={top.to}>Review ↗</Link>
          </>
        ) : (<><div className="kicker">All caught up</div><div className="side-title">Nothing needs you</div><div className="side-sub">New bills and requests show up here.</div></>)}>
        <div className="hero-foot">{fmt(mine?.contributed_cents ?? 0)} to the LLC account · {fmt(mine?.paid_personally_cents ?? 0)} paid from my pocket{mine?.reimbursed_cents ? ` · ${fmt(mine.reimbursed_cents)} paid back` : ''}</div>
        <Link className="hero-link" to={`/partners/${me}`}>Open my ledger ↗</Link>
      </Hero>

      <StatStrip items={[
        { label: 'LLC owes me', value: Money.format(bal.owed_cents), note: bal.pending_reimbursement_cents ? `${fmt(bal.pending_reimbursement_cents)} requested` : 'For receipts I paid personally', to: `/partners/${me}` },
        { label: 'Vs my share of costs', value: `${over > 0 ? '+' : ''}${Money.format(over)}`, tone: over < 0 ? 'bad' : over > 0 ? 'good' : undefined, note: over > 0 ? 'I’ve covered more than my share' : over < 0 ? 'Behind my share' : 'Even with partners', to: '/partners' },
        { label: 'Expected back', value: Money.format(expected), tone: 'good', note: bal.distributions_cents ? `${fmt(bal.distributions_cents)} already paid out` : 'Put in + my profit share' },
        { label: 'LLC cash due, 30 days', value: Money.format(plan.total_cents), tone: plan.shortfall ? 'bad' : undefined, note: plan.shortfall ? `Short ${fmt(plan.shortfall.short_by_cents)} by ${shortDay(plan.shortfall.date)}` : 'Covered by the LLC account', to: '/cash' },
      ]} />

      <div className="grid2">
        <Section title="My projects" action={<Link to="/projects" className="small bold">All projects ↗</Link>}>
          {stakes.map(({ p, s }) => <StakeRow key={p.id} project={p} stake={s} />)}
          {stakes.length === 0 && <div className="empty">No projects yet. <button className="btn link" onClick={() => app.open({ type: 'project' })}>Add one</button></div>}
        </Section>
        <Section title="Needs attention" action={list.length ? <span className="count-pill">{list.length}</span> : undefined}>
          {list.length === 0 && <div className="empty">All caught up.</div>}
          {list.map((t) => (
            <Link key={t.kicker + t.title + t.to} className="item dot-row" to={t.to}>
              <span className={`dot ${t.tone ?? ''}`} />
              <span className="grow"><div className="title">{t.title}</div>{t.sub && <div className="subtitle">{t.sub}</div>}</span>
              <span className="right">{t.amount && <div className="bold num">{t.amount}</div>}{t.status && <div className={`small ${t.tone ?? 'muted'}`}>{t.status}</div>}</span>
            </Link>
          ))}
        </Section>
      </div>

      <div className="grid2">
        <Section title="Due in the next 14 days">
          {h.due_soon.length === 0 && <div className="empty">No bills due in the next 14 days.</div>}
          {h.due_soon.map((e) => (
            <Link key={e.ref.id} className="item dot-row" to={`/records/${e.ref.kind}/${e.ref.id}`}>
              <span className="dot warn" />
              <span className="grow"><div className="title">{e.title}</div><div className="subtitle">{l.project(e.project_id)?.nickname} · Due {shortDay(e.due_date)}</div></span>
              <span className="right"><div className="bold num">{Money.format(l.balance(e.ref.id).outstanding_cents)} due</div><div className="small muted">{e.status.text}</div></span>
            </Link>
          ))}
        </Section>
        <Section title="Partner balances" action={<Link to="/partners" className="small bold">View partners ↗</Link>}>
          {pool.partners.map((p) => (
            <Link key={p.member.user_id} className={`item ${p.member.user_id === me ? 'me' : ''}`} to={`/partners/${p.member.user_id}`}>
              <span className="avatar sm">{initials(p.member.display_name)}</span>
              <span className="grow"><div className="title">{p.member.display_name}{p.member.user_id === me ? ' · me' : ''}</div><div className="subtitle num">Put in {fmt(p.put_in_cents)} · owed {fmt(l.partnerBalance(p.member.user_id).owed_cents)}</div></span>
              <span className="right"><div className={`bold num ${p.over_share_cents < 0 ? 'bad' : p.over_share_cents > 0 ? 'good' : ''}`}>{p.over_share_cents > 0 ? '+' : ''}{fmt(p.over_share_cents)}</div><div className="small muted">vs share</div></span>
            </Link>
          ))}
        </Section>
      </div>

      <LLCOverview />
    </div>
  )
}

export function StakeRow({ project: p, stake: s }: { project: Project; stake: ReturnType<typeof myStake> }) {
  const app = useStore()
  const t = app.ledger.totals(p.id)
  const pct = t.budget_cents > 0 ? Math.min(100, (t.projected_cents / t.budget_cents) * 100) : 0
  const overCats = app.ledger.categorySummary(p.id).filter((c) => c.budget_cents > 0 && c.remaining_cents < 0).length
  return (
    <Link className="item stake-row" to={`/projects/${p.id}`}>
      <div className="row">
        <span className={`house ${s.sold ? 'sold' : ''}`}><Icon name="home" size={16} /></span>
        <span className="grow"><div className="title">{p.nickname}</div><div className="subtitle">{[p.address, projectTypeLabel(p)].filter(Boolean).join(' · ')}</div></span>
        {overCats > 0 ? <span className="badge warn">{overCats} categor{overCats === 1 ? 'y' : 'ies'} over</span> : <span className={`badge ${s.sold ? 'neutral' : 'good'}`}>{projectStatusLabel(p)}</span>}
      </div>
      <div className="stake-nums">
        <div><div className="strip-label">I put in</div><div className="num bold">{fmt(s.put_in_cents)}</div></div>
        <div><div className="strip-label">My split</div><div className="num bold">{s.share_bps / 100}%</div></div>
        <div><div className="strip-label">{s.sold ? 'My profit' : 'Est. profit'}</div><div className={`num bold ${(s.my_profit_cents ?? 0) < 0 ? 'bad' : 'good'}`}>{s.my_profit_cents == null ? '—' : fmt(s.my_profit_cents)}</div></div>
      </div>
      {s.sold ? (
        <div className="small">{s.still_to_come_cents ? <span className="warn bold">{fmt(s.still_to_come_cents)} still to be paid to me</span> : <span className="good bold">Paid out {fmt(s.paid_out_cents)}</span>}</div>
      ) : (
        <>
          <div className="row small"><span className="muted">Projected spend</span><span className="spacer" /><span className="num bold">{fmt(t.projected_cents)}{t.budget_cents > 0 ? ` / ${fmt(t.budget_cents)}` : ''}</span></div>
          {t.budget_cents > 0 && <div className={`progress ${t.remaining_cents < 0 ? 'over' : ''}`}><div style={{ width: `${pct}%` }} /></div>}
          <div className="row small"><span className="muted num">{t.budget_cents > 0 ? `${fmt(t.remaining_cents)} remaining` : 'No budget set'}</span><span className="spacer" /><span className="bold link-text">View project ↗</span></div>
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

/** Bookkeeping hub: the chores and tools that used to fill the sidebar, in one place. Also the phone's "More" tab. */
export function BooksPage() {
  const app = useStore()
  const l = app.ledger
  const inbox = l.s.inbox_items.filter((i) => i.status === 'new').length
  const unmatched = l.s.statement_lines.filter((x) => x.status === 'unmatched').length
  const due = dueTemplates(l.s.entry_templates, l.today).length
  const issues = l.openIssues.length
  const flagged = new Set(l.reviewFlags.map((r) => r.record_id)).size
  const groups: [string, [string, string, string, string?][]][] = [
    ['To do', [
      ['/review', 'check', 'Weekly review', 'Approve, match and file the week'],
      ['/inbox', 'tray', 'Inbox', inbox ? `${inbox} waiting to be filed` : 'Receipts and invoices to file later'],
      ['/statements', 'bank', 'Match card statements', unmatched ? `${unmatched} charges to match` : 'Upload a statement CSV'],
      ['/missing', 'receipt', 'Missing receipts', 'Charges with no photo or receipt'],
      ['/recurring', 'repeat', 'Recurring costs', due ? `${due} due now` : 'Insurance, utilities, dumpster'],
      ['/needs-review', 'alert', 'Needs review', flagged ? `${flagged} to review` : 'Entries partners marked to double-check'],
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
      <div className="page-title"><h1 style={{ flex: 1 }}>More tools</h1></div>
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
