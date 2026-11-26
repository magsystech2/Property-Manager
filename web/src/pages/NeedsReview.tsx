import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { isReviewFlag, kindLabel, type EntryRef, type IssueReport } from '../core/models'
import { Icon, PageHead, Section, Segmented, recordPath } from '../ui/common'

const when = (iso?: string | null) => (iso ? Days.display(iso.slice(0, 10)) : '')
const refOf = (r: IssueReport): EntryRef | null => (r.record_kind && r.record_id ? { kind: r.record_kind, id: r.record_id } : null)

/** Records a partner marked "needs review", in one place. Open one to check or correct it, then mark it reviewed. */
export function NeedsReviewPage() {
  const app = useStore()
  const l = app.ledger
  const [tab, setTab] = useState<'open' | 'done'>('open')
  const [pid, setPid] = useState('')
  const inProject = (r: IssueReport) => { const ref = refOf(r); return !pid || (ref ? l.entry(ref)?.project_id === pid : false) }
  const open = l.reviewFlags.filter(inProject)
  const done = (l.s.issue_reports ?? []).filter((r) => isReviewFlag(r) && r.status !== 'open' && inProject(r))
    .sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? ''))
  // Flags on the same record sit together.
  const groups: { key: string; ref: EntryRef | null; items: IssueReport[] }[] = []
  for (const r of open) {
    const ref = refOf(r)
    const key = ref ? `${ref.kind}:${ref.id}` : r.id
    const g = groups.find((x) => x.key === key)
    if (g) g.items.push(r); else groups.push({ key, ref, items: [r] })
  }
  const total = groups.reduce((a, g) => a + (g.ref ? l.entry(g.ref)?.amount_cents ?? 0 : 0), 0)
  return (
    <div className="stack">
      <PageHead title="Needs review" sub="Entries a partner marked to double-check. Open one to check or correct it, then mark it reviewed.">
        <select value={pid} onChange={(e) => setPid(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All projects</option>
          {l.s.projects.map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}
        </select>
      </PageHead>
      {groups.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600 }}>{groups.length} {groups.length === 1 ? 'entry' : 'entries'} to review · {Money.format(total)}</div>
          <div className="small muted">To flag another one, open it and press “Needs review”.</div>
        </div>
      )}
      <Segmented value={tab} onChange={setTab} options={[['open', `To review (${groups.length})`], ['done', `Reviewed (${done.length})`]]} />
      {tab === 'open' ? (
        groups.length === 0 ? <Section><div className="empty">Nothing waiting for review.</div></Section>
          : <Section>{groups.map((g) => <ReviewGroup key={g.key} refx={g.ref} items={g.items} />)}</Section>
      ) : (
        <Section>
          {done.length === 0 && <div className="empty">Nothing reviewed yet.</div>}
          {done.map((r) => <DoneRow key={r.id} r={r} />)}
        </Section>
      )}
    </div>
  )
}

function ReviewGroup({ refx, items }: { refx: EntryRef | null; items: IssueReport[] }) {
  const app = useStore()
  const l = app.ledger
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const entry = refx ? l.entry(refx) : undefined
  const markAll = async () => { for (const r of items) if (!(await app.markReviewed(r, note))) return; setOpen(false) }
  return (
    <div className="item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span className="thumb"><Icon name="alert" /></span>
      <div className="grow" style={{ minWidth: 220 }}>
        <div className="title" style={{ whiteSpace: 'normal' }}>
          {entry ? <Link to={recordPath(entry.ref)}>{entry.title}</Link> : refx ? `${kindLabel[refx.kind]} (not found)` : 'Record'}
          {entry && <span className="muted" style={{ fontWeight: 400 }}> · {kindLabel[entry.ref.kind]} · {Days.display(entry.date)}{entry.project_id ? ` · ${l.project(entry.project_id)?.nickname ?? ''}` : ''}</span>}
        </div>
        {items.map((r) => (
          <div key={r.id} className="small" style={{ marginTop: 3 }}>
            <span style={{ fontWeight: 600 }}>{r.note}</span> <span className="muted">· {r.created_by ? l.payerName(r.created_by) : 'Import'} · {when(r.created_at)}</span>
          </div>
        ))}
      </div>
      <div className="amount" style={{ textAlign: 'right' }}>
        {entry && <div className="bold num">{Money.format(entry.amount_cents)}</div>}
        {entry?.status.text === 'Void' && <span className="badge neutral">Void</span>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {entry && <Link className="btn" to={recordPath(entry.ref)}>Open</Link>}
        <button className="btn primary" onClick={() => setOpen(!open)}><Icon name="check" />Mark reviewed</button>
      </div>
      {open && (
        <form className="row" style={{ width: '100%', gap: 8, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void markAll() }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: what you found, e.g. Matches the bank statement" autoFocus style={{ flex: 1 }} />
          <button className="btn primary">Done</button>
        </form>
      )}
    </div>
  )
}

function DoneRow({ r }: { r: IssueReport }) {
  const app = useStore()
  const l = app.ledger
  const ref = refOf(r)
  const entry = ref ? l.entry(ref) : undefined
  return (
    <div className="item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span className="thumb"><Icon name="check" /></span>
      <div className="grow" style={{ minWidth: 220 }}>
        <div className="title" style={{ whiteSpace: 'normal' }}>{entry ? <Link to={recordPath(entry.ref)}>{entry.title}</Link> : 'Record'}{entry && <span className="muted" style={{ fontWeight: 400 }}> · {Money.format(entry.amount_cents)}</span>}</div>
        <div className="small">{r.note}</div>
        <div className="small" style={{ color: 'var(--good)' }}>Reviewed by {l.payerName(r.resolved_by)} · {when(r.resolved_at)}{r.resolution && r.resolution !== 'Reviewed' ? `: ${r.resolution}` : ''}</div>
      </div>
      <button className="btn" onClick={() => app.reopenIssue(r)}>Reopen</button>
    </div>
  )
}
