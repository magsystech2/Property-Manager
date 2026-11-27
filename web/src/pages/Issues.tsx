import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { isReviewFlag, issueCategoryLabel, kindLabel, type EntryRef, type IssueReport } from '../core/models'
import { Icon, PageHead, Section, Segmented, recordPath } from '../ui/common'
import type { Ledger } from '../core/ledger'

const refOf = (r: IssueReport): EntryRef | null => (r.record_kind && r.record_id ? { kind: r.record_kind, id: r.record_id } : null)
const catLabel = (c: string) => issueCategoryLabel[c as keyof typeof issueCategoryLabel] ?? c
const when = (iso?: string | null) => (iso ? Days.display(iso.slice(0, 10)) : '')

/** Plain-text list of open reports, to paste into a message or a chat when fixing them in one go. */
function summaryText(list: IssueReport[], l: Ledger): string {
  const lines = list.map((r, i) => {
    const ref = refOf(r)
    const entry = ref ? l.entry(ref) : undefined
    const about = entry ? `${kindLabel[entry.ref.kind]} "${entry.title}" ${Money.format(entry.amount_cents)} (${entry.ref.kind}/${entry.ref.id})` : ref ? `${ref.kind}/${ref.id}` : 'App'
    return [
      `${i + 1}. [${catLabel(r.category)}] ${r.note}`,
      `   About: ${about}`,
      `   Reported by ${l.payerName(r.created_by)} on ${when(r.created_at)}${r.page ? `, page ${r.page}` : ''}`,
      r.error_text ? `   Error shown: ${r.error_text}` : '',
      r.screenshot_path ? '   Screenshot attached in the app' : '',
    ].filter(Boolean).join('\n')
  })
  return `Open issues (${list.length})\n\n${lines.join('\n\n')}`
}

export function IssuesPage() {
  const app = useStore()
  const l = app.ledger
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const all = (l.s.issue_reports ?? []).filter((r) => !isReviewFlag(r))
  const open = all.filter((r) => r.status === 'open').sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  const resolved = all.filter((r) => r.status !== 'open').sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? ''))

  // Reports about the same record sit together, so a record flagged twice is fixed once.
  const groups: { key: string; ref: EntryRef | null; items: IssueReport[] }[] = []
  for (const r of open) {
    const ref = refOf(r)
    const key = ref ? `${ref.kind}:${ref.id}` : `app:${r.id}`
    const g = groups.find((x) => x.key === key)
    if (g) g.items.push(r); else groups.push({ key, ref, items: [r] })
  }
  const byCategory = Object.entries(open.reduce<Record<string, number>>((acc, r) => { acc[r.category] = (acc[r.category] ?? 0) + 1; return acc }, {}))
    .sort((a, b) => b[1] - a[1])

  const copy = async () => {
    try { await navigator.clipboard.writeText(summaryText(open, l)); app.showToast('Open issues copied') } catch { app.showError(new Error('Couldn’t copy. Your browser blocked the clipboard.')) }
  }

  return (
    <div className="stack">
      <PageHead title="Issues" sub="Problems partners flagged with a record or the app. Fix them, then mark them resolved with what you did.">
        <button className="btn primary" onClick={() => app.open({ type: 'report' })}><Icon name="alert" />Report an issue</button>
      </PageHead>

      {open.length > 0 && (
        <div className="card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600 }}>{open.length} open{groups.length !== open.length ? ` · ${groups.length} ${groups.length === 1 ? 'thing' : 'things'} to fix` : ''}</div>
            <div className="small muted">{byCategory.map(([c, n]) => `${catLabel(c)} ${n}`).join(' · ')}</div>
          </div>
          <button className="btn" onClick={copy} title="A plain-text list of every open issue, to paste into a message">Copy all open</button>
        </div>
      )}

      <Segmented value={tab} onChange={setTab} options={[['open', `Open (${open.length})`], ['resolved', `Resolved (${resolved.length})`]]} />
      {tab === 'open' ? (
        groups.length === 0 ? <Section><div className="empty">No open issues. Nice.</div></Section>
          : groups.map((g) => <Group key={g.key} refx={g.ref} items={g.items} />)
      ) : (
        <Section>
          {resolved.length === 0 && <div className="empty">Nothing resolved yet.</div>}
          {resolved.map((r) => <IssueRow key={r.id} r={r} showRecord />)}
        </Section>
      )}
    </div>
  )
}

function Group({ refx, items }: { refx: EntryRef | null; items: IssueReport[] }) {
  const app = useStore()
  const entry = refx ? app.ledger.entry(refx) : undefined
  const title = entry ? <Link to={recordPath(entry.ref)}>{kindLabel[entry.ref.kind]}: {entry.title} · {Money.format(entry.amount_cents)}</Link>
    : refx ? `${kindLabel[refx.kind]} (not found)` : 'App'
  return (
    <Section title={<>{title}{items.length > 1 && <span className="badge warning" style={{ marginLeft: 8 }}>{items.length} reports</span>}</>}>
      {items.map((r) => <IssueRow key={r.id} r={r} />)}
    </Section>
  )
}

function IssueRow({ r, showRecord }: { r: IssueReport; showRecord?: boolean }) {
  const app = useStore()
  const l = app.ledger
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')
  const [opening, setOpening] = useState(false)
  const ref = refOf(r)
  const entry = showRecord && ref ? l.entry(ref) : undefined
  const viewShot = async () => {
    if (!r.screenshot_path) return
    setOpening(true)
    const url = await app.fileURL({ id: r.id, workspace_id: r.workspace_id, storage_path: r.screenshot_path, filename: r.screenshot_name ?? 'screenshot.png', mime_type: 'image/png', size_bytes: 0 })
    setOpening(false)
    if (url) window.open(url, '_blank', 'noopener')
  }
  return (
    <div className="item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <span className="thumb"><Icon name={r.status === 'open' ? 'alert' : 'check'} /></span>
      <div className="grow" style={{ minWidth: 220 }}>
        <div className="title" style={{ whiteSpace: 'normal' }}><span className="badge neutral" style={{ marginRight: 6 }}>{catLabel(r.category)}</span>{r.note}</div>
        <div className="subtitle">
          {l.payerName(r.created_by)} · {when(r.created_at)}{r.page && !/^\/(records\/|issues$|$)/.test(r.page) ? ` · on ${r.page}` : ''}
          {entry && <> · <Link to={recordPath(entry.ref)}>{entry.title}</Link></>}
        </div>
        {r.error_text && <div className="small" style={{ color: 'var(--bad)' }}>Error shown: {r.error_text}</div>}
        {r.status !== 'open' && (
          <div className="small" style={{ color: 'var(--good)' }}>
            Resolved by {l.payerName(r.resolved_by)} · {when(r.resolved_at)}{r.resolution ? `: ${r.resolution}` : ''}
          </div>
        )}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {r.screenshot_path && <button className="btn" disabled={opening} onClick={viewShot}>{opening ? 'Opening…' : 'Screenshot'}</button>}
        {r.status === 'open'
          ? <button className="btn primary" onClick={() => setResolving(!resolving)}>Resolve</button>
          : <button className="btn" onClick={() => app.reopenIssue(r)}>Reopen</button>}
      </div>
      {resolving && (
        <form className="row" style={{ width: '100%', gap: 8, marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await app.resolveIssue(r, resolution)) setResolving(false) }}>
          <input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done? e.g. Voided and re-entered at $412.50" autoFocus style={{ flex: 1 }} />
          <button className="btn primary">Mark resolved</button>
        </form>
      )}
    </div>
  )
}
