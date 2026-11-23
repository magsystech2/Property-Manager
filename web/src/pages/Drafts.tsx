import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { Icon, PageHead, Section } from '../ui/common'

export function DraftsPage() {
  const app = useStore()
  const drafts = [...app.draftList].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return (
    <div className="stack">
      <PageHead title="Drafts" sub="Kept in this browser until you post them. Partners can't see drafts." />
      <Section footer="Documents picked for a draft aren't kept with it. Attach them again when you post.">
        {drafts.length === 0 && <div className="empty">No drafts.</div>}
        {drafts.map((d) => (
          <div key={d.id} className="item">
            <button className="item" style={{ padding: 0 }} onClick={() => app.open({ type: 'transaction', draft: d })}>
              <Icon name={d.kind === 'bill' ? 'doc' : 'receipt'} />
              <div className="grow">
                <div className="title">{(d.vendor_id ? app.ledger.vendor(d.vendor_id)?.name : d.new_vendor_name) || 'No vendor yet'}</div>
                <div className="subtitle">{d.kind === 'bill' ? 'Bill' : 'Receipt'} · {Days.display(d.date)} · {app.ledger.project(d.project_id)?.nickname ?? 'No project'}{d.error ? ` · ${d.error}` : ''}</div>
              </div>
              <span className="num bold">{Money.parse(d.total_text) != null ? Money.format(Money.parse(d.total_text)!) : '-'}</span>
            </button>
            <button className="btn link danger" onClick={() => { if (confirm('Delete this draft?')) app.deleteDraft(d.id) }}>Delete</button>
          </div>
        ))}
      </Section>
    </div>
  )
}
