import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Money } from '../core/money'
import { Icon } from './common'

/** A bright banner while entries are flagged "needs review" (all of them, or one project's). Hidden when there are none. */
export function ReviewAlert({ projectId, compact }: { projectId?: string; compact?: boolean }) {
  const app = useStore()
  const l = app.ledger
  const seen = new Set<string>()
  const items = l.reviewFlags.flatMap((r) => {
    if (!r.record_kind || !r.record_id || seen.has(r.record_id)) return []
    seen.add(r.record_id)
    const e = l.entry({ kind: r.record_kind, id: r.record_id })
    if (!e || (projectId && e.project_id !== projectId)) return []
    return [{ e, note: r.note }]
  })
  if (items.length === 0) return null
  const total = items.reduce((a, x) => a + x.e.amount_cents, 0)
  const names = [...new Set(items.map((x) => (projectId ? x.e.title : l.project(x.e.project_id)?.nickname ?? x.e.title)))]
  return (
    <Link to="/needs-review" className={compact ? 'review-alert compact' : 'review-alert'} role="alert">
      <span className="ra-icon"><Icon name="alert" size={20} /></span>
      <span className="ra-body">
        <span className="ra-title">{items.length} {items.length === 1 ? 'entry needs' : 'entries need'} review</span>
        <span className="ra-sub">{Money.format(total)} · {names.slice(0, 3).join(', ')}{names.length > 3 ? ` and ${names.length - 3} more` : ''}</span>
      </span>
      <span className="ra-cta">Review now →</span>
    </Link>
  )
}
