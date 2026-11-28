import { newDraft } from '../drafts'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { ReviewAlert } from '../ui/ReviewAlert'
import { Days, Money, type Cents, splitPct } from '../core/money'
import { dedupe } from '../core/ledger'
import { isActiveProject, projectStatusLabel, projectTypeLabel, type EntryRef } from '../core/models'
import { AttachmentRow, EditCell, EntryList, Icon, viewLabel, StatStrip, KV, MoneyKV, MoneyText, PageHead, Section, Segmented, recordPath } from '../ui/common'
import { StakeRow, groupStake, myStake } from './Home'
import { MoneyAtAGlance } from '../ui/Glance'
import { ProjectForecast } from './Forecast'
import { CostBasisCard, ProjectMaterials, ProjectSale } from './Sale'
import { recordsLink } from './Activity'

export function ProjectsPage() {
  const app = useStore()
  const ps = [...app.ledger.s.projects].sort((a, b) => a.nickname.localeCompare(b.nickname))
  const sold = ps.filter((p) => !isActiveProject(p))
  const ids = app.viewingIds
  const other = ids.length === 1 && ids[0] === app.me ? undefined : viewLabel(app)
  return (
    <div className="stack">
      <PageHead title="Projects">
        <button className="btn primary" onClick={() => app.open({ type: 'project' })}><Icon name="plus" />New project</button>
      </PageHead>
      <Section title="Active">
        {ps.filter(isActiveProject).map((p) => <StakeRow key={p.id} project={p} stake={groupStake(app.ledger, ids, p)} other={other} />)}
        {ps.filter(isActiveProject).length === 0 && <div className="empty">No active projects yet.</div>}
      </Section>
      {sold.length > 0 && <Section title="Sold">{sold.map((p) => <StakeRow key={p.id} project={p} stake={groupStake(app.ledger, ids, p)} other={other} />)}</Section>}
      <Section>
        <Link className="item" to="/vendors"><Icon name="store" /><span className="grow">Vendors and contractors</span><Icon name="chevron" /></Link>
      </Section>
    </div>
  )
}

type Tab = 'overview' | 'budget' | 'forecast' | 'sale' | 'materials' | 'activity' | 'vendors' | 'files'

export function ProjectDetailPage() {
  const { id = '' } = useParams()
  const app = useStore()
  const [tab, setTab] = useState<Tab>('overview')
  const l = app.ledger
  const p = l.project(id)
  if (!p) return <PageHead title="Project not found" back="/projects" />
  return (
    <div className="stack">
      <PageHead title={p.nickname} sub={[p.address, `${projectTypeLabel(p)} · ${projectStatusLabel(p)}`].filter(Boolean).join(' · ')} back="/projects">
        <div className="row wrap">
          <button className="btn" onClick={() => app.open({ type: 'project', project: p })}>Edit project</button>
          <button className="btn" onClick={() => app.open({ type: 'budget', projectId: p.id })}>Edit budget</button>
          <Link className="btn" to={`/export?project=${p.id}`}><Icon name="download" />CSV</Link>
        </div>
      </PageHead>
      <ReviewAlert projectId={p.id} compact />
      <ProjectHero pid={p.id} />
      <MoneyAtAGlance projectId={p.id} title="Who paid what on this project" />
      <Segmented value={tab} onChange={setTab} options={[['overview', 'Overview'], ['budget', 'Budget'], ['forecast', 'Forecast'], ['sale', 'Sale and split'], ['materials', 'Materials'], ['activity', 'Activity'], ['vendors', 'Vendors'], ['files', 'Files']]} />
      {tab === 'overview' && <Overview pid={p.id} />}
      {tab === 'budget' && <Budget pid={p.id} />}
      {tab === 'forecast' && <ProjectForecast pid={p.id} />}
      {tab === 'sale' && <ProjectSale pid={p.id} />}
      {tab === 'materials' && <ProjectMaterials pid={p.id} />}
      {tab === 'activity' && <Section><EntryList entries={l.entries().filter((e) => e.project_id === p.id)} empty="No transactions yet." /></Section>}
      {tab === 'vendors' && <ProjectVendors pid={p.id} />}
      {tab === 'files' && <ProjectFiles pid={p.id} />}
    </div>
  )
}

function Overview({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const p = l.project(pid)!
  const t = l.totals(pid)
  const lines = l.categorySummary(pid)
  const sources = lines.flatMap((x) => x.sources)
  const link = (label: string, cents: Cents, refs: EntryRef[], why: string) => <MoneyKV label={label} cents={cents} to={recordsLink(`${p.nickname}: ${label}`, dedupe(refs), why)} />
  const commitments = l.s.commitments.filter((c) => c.project_id === pid && c.status !== 'void')
  return (
    <div className="stack">
    <div className="grid2">
      <div className="stack">
        <Section title="Spending" footer="Projected spend = paid + unpaid billed + committed not billed. Remaining = budget − projected spend.">
          <MoneyKV label="Approved budget" cents={t.budget_cents} />
          {link('Paid costs', t.paid_cents, sources.filter((r) => r.kind === 'expense' || r.kind === 'payment'), 'Receipts and bill payments, net of refunds.')}
          {link('Unpaid billed', t.unpaid_billed_cents, sources.filter((r) => r.kind === 'bill'), 'Balances still owed on bills, after payments and vendor credits.')}
          {link('Committed, not billed', t.unbilled_committed_cents, sources.filter((r) => r.kind === 'commitment'), 'Contract amounts plus approved change orders, minus what has been invoiced.')}
          <MoneyKV label="Projected spend" cents={t.projected_cents} bold />
          <MoneyKV label={t.remaining_cents < 0 ? 'Over budget' : 'Remaining budget'} cents={t.remaining_cents} bold tone={t.remaining_cents < 0 ? 'bad' : undefined} />
        </Section>
        <CostBasisCard pid={pid} />
        <Section title="Details">
          <KV k="Type">{projectTypeLabel(p)}</KV>
          <KV k="Status">{projectStatusLabel(p)}</KV>
          {p.start_date && <KV k="Start">{Days.display(p.start_date)}</KV>}
          {p.target_complete_date && <KV k="Target completion">{Days.display(p.target_complete_date)}</KV>}
          {p.target_sale_date && <KV k="Target sale">{Days.display(p.target_sale_date)}</KV>}
          {p.notes && <KV k="Notes">{p.notes}</KV>}
        </Section>
      </div>
      <div className="stack">
        <Section title="Contracts and commitments" action={<button className="btn link" onClick={() => app.open({ type: 'commitment', projectId: pid })}>+ Add commitment</button>}>
          {commitments.length === 0 && <div className="empty">No contracts recorded.</div>}
          {commitments.map((c) => {
            const st = l.commitmentStatus(c)
            return (
              <Link key={c.id} className="item" to={recordPath({ kind: 'commitment', id: c.id })}>
                <div className="grow">
                  <div className="title">{l.vendor(c.vendor_id)?.name ?? 'Vendor'}</div>
                  <div className="subtitle">{c.description}</div>
                  <div className="small num">{Money.format(st.revised_cents)} agreed · {Money.format(st.billed_cents)} billed · {Money.format(st.unbilled_cents)} not billed</div>
                </div>
                <Icon name="chevron" size={14} />
              </Link>
            )
          })}
        </Section>
        <Section title="Quick actions">
          <button className="item" onClick={() => app.open({ type: 'transaction', draft: newDraft('receipt', pid) })}><Icon name="receipt" /><span className="grow">Add expense for this project</span></button>
          <button className="item" onClick={() => app.open({ type: 'transaction', draft: newDraft('bill', pid) })}><Icon name="doc" /><span className="grow">Add bill for this project</span></button>
          <button className="item" onClick={() => app.open({ type: 'proceeds', projectId: pid })}><Icon name="cash" /><span className="grow">Record the sale</span></button>
          <button className="item" onClick={() => app.open({ type: 'contribution', projectId: pid, partnerId: app.me })}><Icon name="bank" /><span className="grow">Add contribution for this project</span></button>
        </Section>
      </div>
    </div>
    </div>
  )
}

/** Headline for a project: budget left (or sale result), the worst over-budget category, and this partner's stake. */
function ProjectHero({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const p = l.project(pid)!
  const t = l.totals(pid)
  const s = myStake(l, app.me ?? '', p)
  const pct = t.budget_cents > 0 ? (t.projected_cents / t.budget_cents) * 100 : 0
  const f = (c: Cents) => Money.format(c, false)
  const noBudget = t.budget_cents === 0
  // One compact row of the project's own numbers, so "who paid what" fits right under it without scrolling.
  return (
    <StatStrip items={[
      s.sold
        ? { label: 'Profit on the sale', value: f(s.profit_cents ?? 0), tone: (s.profit_cents ?? 0) < 0 ? 'bad' : 'good' }
        : noBudget
          ? { label: 'Spent so far', value: f(t.projected_cents), note: <>incl. unpaid bills · <button className="link-btn" onClick={() => app.open({ type: 'budget', projectId: pid })}>set a budget</button></> }
          : { label: t.remaining_cents < 0 ? 'Over budget' : 'Budget left', value: f(Math.abs(t.remaining_cents)), tone: t.remaining_cents < 0 ? 'bad' : 'good', note: `${f(t.projected_cents)} of ${f(t.budget_cents)} projected (${pct.toFixed(0)}%)` },
      { label: 'I put in', value: f(s.put_in_cents), note: `${splitPct(s.share_bps)} split` },
      { label: s.sold ? 'My profit' : 'My est. profit', value: s.my_profit_cents == null ? '—' : f(s.my_profit_cents), tone: (s.my_profit_cents ?? 0) < 0 ? 'bad' : 'good',
        note: s.sold ? (s.still_to_come_cents ? `${f(s.still_to_come_cents)} still to be paid to me` : undefined) : s.my_profit_cents == null ? 'add an expected sale price' : undefined },
      s.sold
        ? { label: 'Sale proceeds', value: f(t.proceeds_cents) }
        : { label: 'Expected sale', value: p.expected_sale_cents ? f(p.expected_sale_cents) : '—', note: p.expected_sale_cents ? undefined : 'set it in Sale and split' },
    ]} />
  )
}

function Budget({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const p = l.project(pid)!
  const lines = l.categorySummary(pid)
  return (
    <div className="stack">
      <div className="row">
        <span className="note">Projected = paid + unpaid billed + committed not billed. Click a budget figure to change it; click any other amount to see the records behind it.</span>
        <span className="spacer" />
        <button className="btn" onClick={() => app.open({ type: 'budget', projectId: pid })}>Edit budget by category</button>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="num" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>
              {['Category', 'Budget', 'Paid', 'Unpaid billed', 'Committed, not billed', 'Projected', 'Remaining'].map((h, i) => (
                <th key={h} style={{ padding: '10px 12px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={7} className="empty">No budget or spending yet.</td></tr>}
            {lines.map((x) => {
              const cell = (cents: Cents, refs: EntryRef[], label: string) => (
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  {refs.length ? <Link to={recordsLink(`${p.nickname} · ${x.name}: ${label}`, refs)}>{Money.format(cents)}</Link> : Money.format(cents)}
                </td>
              )
              return (
                <tr key={x.category_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, fontVariantNumeric: 'normal' }}>{x.name}</td>
                  {l.category(x.category_id)
                    ? <EditCell kind="money" style={{ padding: '10px 12px', textAlign: 'right' }} value={x.budget_cents} display={Money.format(x.budget_cents)} title="Click to change this category's budget"
                        onSave={(v) => app.saveBudgets([{ workspace_id: app.workspace!.id, project_id: pid, category_id: x.category_id, amount_cents: Number(v) }])} />
                    : <td style={{ padding: '10px 12px', textAlign: 'right' }}>{Money.format(x.budget_cents)}</td>}
                  {cell(x.paid_cents, x.sources.filter((r) => r.kind === 'expense' || r.kind === 'payment'), 'paid')}
                  {cell(x.unpaid_billed_cents, x.sources.filter((r) => r.kind === 'bill'), 'unpaid billed')}
                  {cell(x.unbilled_committed_cents, x.sources.filter((r) => r.kind === 'commitment'), 'committed, not billed')}
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 650 }}>{Money.format(x.projected_cents)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 650 }} className={x.remaining_cents < 0 ? 'bad' : ''}>
                    {x.remaining_cents < 0 && <span title="Over budget">▲ </span>}{Money.format(x.remaining_cents)}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {lines.length > 0 && (() => {
            const t = l.totals(pid)
            return (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ padding: '10px 12px' }}>Total</td>
                  {[t.budget_cents, t.paid_cents, t.unpaid_billed_cents, t.unbilled_committed_cents, t.projected_cents].map((c, i) => <td key={i} style={{ padding: '10px 12px', textAlign: 'right' }}>{Money.format(c)}</td>)}
                  <td style={{ padding: '10px 12px', textAlign: 'right' }} className={t.remaining_cents < 0 ? 'bad' : ''}>{Money.format(t.remaining_cents)}</td>
                </tr>
              </tfoot>
            )
          })()}
        </table>
      </div>
    </div>
  )
}

function ProjectVendors({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const vs = l.vendorsForProject(pid)
  return (
    <Section>
      {vs.length === 0 && <div className="empty">No vendors yet.</div>}
      {vs.map((v) => {
        const bal = l.s.bills.filter((b) => b.project_id === pid && b.vendor_id === v.id && b.status !== 'void').reduce((a, b) => a + l.balance(b.id).outstanding_cents, 0)
        return (
          <Link key={v.id} className="item" to={`/vendors/${v.id}`}>
            <div className="grow"><div className="title">{v.name}</div><div className="subtitle" style={{ textTransform: 'capitalize' }}>{v.kind}</div></div>
            {bal > 0 && <span className="small">owes <MoneyText cents={bal} bold /></span>}
            <Icon name="chevron" size={14} />
          </Link>
        )
      })}
    </Section>
  )
}

function ProjectFiles({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const refs = l.entries().filter((e) => e.project_id === pid).map((e) => e.ref)
  const ids = new Set(refs.flatMap((r) => l.attachmentsFor(r).map((a) => a.id)))
  const files = l.s.attachments.filter((a) => a.project_id === pid || ids.has(a.id))
  return (
    <Section footer="Receipts and invoices attached to this project's transactions show here too. Adding a document never changes amounts."
      action={<button className="btn link" onClick={() => app.open({ type: 'attach', target: { kind: 'project', id: pid } })}><Icon name="plus" size={14} /> Add project document</button>}>
      {files.length === 0 && <div className="empty">No documents yet. Add one here, or attach it to a transaction.</div>}
      {files.map((a) => <AttachmentRow key={a.id} a={a} showRecord />)}
    </Section>
  )
}
