import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import type { ClaimKind } from '../core/models'
import { missingReceipts, weeklyReview, type MissingReceipt, type ReviewItem } from '../core/planning'
import { Icon, MoneyText, PageHead, Section, Segmented } from '../ui/common'

/** "I'll take it": one partner claims an item so two don't both handle it. Shows who has it otherwise. */
export function ClaimButton({ kind, id }: { kind: ClaimKind; id: string }) {
  const app = useStore()
  const c = app.ledger.s.claims.find((x) => x.item_kind === kind && x.item_id === id)
  if (!c) return <button className="btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); app.claim(kind, id) }} title="Let the other partners know you'll handle this">I'll take it</button>
  const mine = c.claimed_by === app.me
  return (
    <span className="row" style={{ gap: 4 }}>
      <span className={`badge ${mine ? 'good' : 'neutral'}`}><Icon name="users" size={12} />{mine ? 'You have it' : `${app.ledger.payerName(c.claimed_by)} has it`}</span>
      <button className="btn link" onClick={(e) => { e.preventDefault(); e.stopPropagation(); app.releaseClaim(c) }} title={mine ? 'Give it back' : 'Release their claim'}>{mine ? 'Release' : 'Unclaim'}</button>
    </span>
  )
}

function ReviewRow({ r }: { r: ReviewItem }) {
  return (
    <div className="item" style={{ flexWrap: 'wrap' }}>
      <Link to={r.link} className="grow" style={{ color: 'inherit', textDecoration: 'none', minWidth: 180 }}>
        <div className="title">{r.title}</div>
        <div className="subtitle">{r.subtitle}</div>
      </Link>
      {r.amount_cents !== 0 && <MoneyText cents={r.amount_cents} bold />}
      <ClaimButton kind={r.claimKind} id={r.id} />
    </div>
  )
}

function Group({ title, items, empty, footer, total }: { title: string; items: ReviewItem[]; empty: string; footer?: string; total?: boolean }) {
  const sum = items.reduce((a, r) => a + r.amount_cents, 0)
  return (
    <Section title={`${title} (${items.length})`} footer={footer} action={total && items.length ? <span className="small muted">{Money.format(sum)}</span> : undefined}>
      {items.length === 0 ? <div className="empty">{empty}</div> : items.map((r) => <ReviewRow key={`${r.claimKind}:${r.id}`} r={r} />)}
    </Section>
  )
}

export function ReviewPage() {
  const app = useStore()
  const l = app.ledger
  const r = weeklyReview(l)
  const mineOnly = r.missing.filter((m) => m.owner === app.me).length
  const claimed = l.s.claims.filter((c) => c.claimed_by === app.me).length
  return (
    <div className="stack">
      <PageHead title="Weekly review" sub={`Everything the three of you need to look at this week, as of ${Days.display(l.today)}. Tap “I'll take it” so two partners don't handle the same item.`} />
      <div className="tiles">
        <div className="card tile"><div className="small muted">Bills due in 7 days</div><div className="big">{Money.format(r.billsDue.reduce((a, x) => a + x.amount_cents, 0))}</div><div className="small muted">{r.billsDue.length} bills</div></div>
        <div className="card tile"><div className="small muted">Waiting for approval</div><div className="big">{r.approvals.length}</div></div>
        <div className="card tile"><div className="small muted">Missing receipts</div><div className="big">{r.missing.length}</div><div className="small muted">{mineOnly} yours</div></div>
        <div className="card tile"><div className="small muted">Claimed by you</div><div className="big">{claimed}</div></div>
      </div>
      <div className="grid2">
        <div className="stack">
          <Group title="Bills due this week" items={r.billsDue} total empty="No bills due in the next 7 days." footer="Overdue bills are included. Amounts are what's still owed." />
          <Group title="Reimbursements ready to pay" items={r.reimbursementsToPay} total empty="No reimbursements waiting to be paid." />
          <Group title="Waiting for approval" items={r.approvals} empty="Nothing waiting for a second partner." />
        </div>
        <div className="stack">
          <Group title="Inbox to file" items={r.inbox} empty="The receipt inbox is empty." />
          <Group title="Statement lines to match" items={r.unmatched} total empty="Every imported statement line is matched or ignored." />
          <Section title={`Missing receipts (${r.missing.length})`} action={<Link className="btn link" to="/missing">Open the list</Link>}>
            {r.missing.length === 0 ? <div className="empty">Every receipt has a document and every charge has a receipt.</div>
              : r.missing.slice(0, 5).map((m) => <MissingRow key={m.key} m={m} />)}
          </Section>
        </div>
      </div>
    </div>
  )
}

export function MissingRow({ m }: { m: MissingReceipt }) {
  const app = useStore()
  return (
    <div className="item" style={{ flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 180 }}>
        <div className="title">{m.title}</div>
        <div className="subtitle">{Days.display(m.date)} · {m.subtitle}{m.owner ? ` · ${m.owner === app.me ? 'yours' : app.ledger.payerName(m.owner)}` : ''}</div>
      </div>
      <MoneyText cents={m.amount_cents} bold />
      {m.expense && <button className="btn primary" onClick={() => app.open({ type: 'attach', target: { kind: 'record', ref: { kind: 'expense', id: m.expense!.id } } })}>Attach receipt</button>}
      {m.line && <button className="btn primary" onClick={() => app.open({ type: 'transaction', draft: app.lineDraft(m.line!), link: { line: m.line! } })}>Enter receipt</button>}
      {m.line && <Link className="btn" to={`/statements?line=${m.line.id}`}>Match</Link>}
    </div>
  )
}

export function MissingPage() {
  const app = useStore()
  const all = missingReceipts(app.ledger)
  const [who, setWho] = useState<'mine' | 'all'>(all.some((m) => m.owner === app.me) ? 'mine' : 'all')
  const list = who === 'mine' ? all.filter((m) => m.owner === app.me) : all
  return (
    <div className="stack">
      <PageHead title="Missing receipts" sub="Receipts entered without a photo or PDF, and card charges with no receipt entered yet. Clear yours before the weekly review." back="/review" />
      <Segmented value={who} onChange={setWho} options={[['mine', `Mine (${all.filter((m) => m.owner === app.me).length})`], ['all', `Everyone (${all.length})`]]} />
      <Section footer="“Mine” means you paid it, it was on your card, or you entered it.">
        {list.length === 0 ? <div className="empty">Nothing missing. Nice.</div> : list.map((m) => <MissingRow key={m.key} m={m} />)}
      </Section>
    </div>
  )
}
