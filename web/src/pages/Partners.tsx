import { poolSummary, profitShares } from '../core/settlement'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { EntryList, Icon, MoneyKV, MoneyText, PageHead, Section, recordPath } from '../ui/common'
import { recordsLink } from './Activity'

export function PartnersPage() {
  const app = useStore()
  const balances = app.ledger.partnerBalances()
  const split = profitShares(app.ledger, null)
  const splitText = split.source === 'equal' ? 'Equal' : split.shares.map((x) => `${app.ledger.payerName(x.partner_user_id)} ${x.share_bps / 100}%`).join(', ')
  return (
    <div className="stack">
      <PageHead title="Partners" sub="Every balance comes from recorded transactions only. The profit split is used only when a project is sold." />
      <div className="grid2">
        <Section title="Across the LLC">
          <MoneyKV label="LLC owes partners" cents={balances.reduce((a, b) => a + Math.max(b.owed_cents, 0), 0)} bold />
          <MoneyKV label="Capital contributed" cents={balances.reduce((a, b) => a + b.contributions_cents, 0)} />
          <MoneyKV label="Reimbursement requests pending" cents={balances.reduce((a, b) => a + b.pending_reimbursement_cents, 0)} />
          <MoneyKV label="Distributed from sales" cents={balances.reduce((a, b) => a + b.distributions_cents, 0)} />
        </Section>
        <Section title="Actions">
          <button className="item" onClick={() => app.open({ type: 'reimbursement' })}><Icon name="users" /><span className="grow">Reimburse a partner</span></button>
          <button className="item" onClick={() => app.open({ type: 'contribution', partnerId: app.me })}><Icon name="bank" /><span className="grow">Add contribution</span></button>
          <button className="item" onClick={() => app.open({ type: 'shares', projectId: null })}><Icon name="chart" /><span className="grow">Default profit split</span><span className="small muted">{splitText}</span></button>
          <Link className="item" to="/reports"><Icon name="chart" /><span className="grow">Partner reports</span></Link>
          <Link className="item" to="/export"><Icon name="download" /><span className="grow">Export CSV</span></Link>
          <Link className="item" to="/settings"><Icon name="settings" /><span className="grow">Settings, members and invites</span></Link>
        </Section>
      </div>
      <PoolSection />
      <Section title="Partners">
        {balances.map((b) => (
          <Link key={b.member.user_id} className="item" to={`/partners/${b.member.user_id}`} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="row">
                <span className="title">{b.member.display_name}{b.member.user_id === app.me ? ' (me)' : ''}</span>
                {b.member.role === 'owner' && <span className="pill">Owner</span>}
                {b.member.access_revoked_at && <span className="badge bad"><Icon name="lock" size={12} />No access</span>}
              </div>
              <div className="subtitle num">Paid personally {Money.format(b.out_of_pocket_cents)} · Reimbursed {Money.format(b.reimbursed_cents)} · Contributed {Money.format(b.contributions_cents)}</div>
              {b.pending_reimbursement_cents > 0 && <div className="small warn bold">{Money.format(b.pending_reimbursement_cents)} reimbursement pending</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="small muted">LLC owes</div>
              <MoneyText cents={b.owed_cents} bold />
            </div>
          </Link>
        ))}
      </Section>
    </div>
  )
}

export function PartnerDetailPage() {
  const { id = '' } = useParams()
  const app = useStore()
  const l = app.ledger
  const b = l.partnerBalance(id)
  const entries = l.partnerEntries(id)
  const open = l.reimbursableItems(id)
  const name = b.member.display_name
  const llcWide = l.s.contributions.filter((c) => c.partner_user_id === id && !c.project_id && c.status !== 'void').reduce((a, c) => a + c.amount_cents, 0)
  return (
    <div className="stack">
      <PageHead title={name} sub={[b.member.email, b.member.access_revoked_at ? 'Access removed: still in the books, but can’t see this LLC' : null].filter(Boolean).join(' · ') || undefined} back="/partners">
        <div className="row wrap">
          <button className="btn primary" disabled={b.owed_cents <= 0} onClick={() => app.open({ type: 'reimbursement', partnerId: id })}>
            {id === app.me ? 'Request reimbursement' : `Reimburse ${name}`}
          </button>
          <button className="btn" onClick={() => app.open({ type: 'contribution', partnerId: id })}>Add contribution</button>
          <Link className="btn" to={`/export?partner=${id}`}><Icon name="download" />CSV</Link>
        </div>
      </PageHead>
      <div className="grid2">
        <Section title="Balance" footer="Still owes = paid personally − reimbursed. Contributions are tracked separately and don't change this.">
          <MoneyKV label="Paid personally for projects" cents={b.out_of_pocket_cents} />
          <MoneyKV label="Reimbursed by the LLC" cents={b.reimbursed_cents} />
          <MoneyKV label="LLC still owes" cents={b.owed_cents} bold />
          <MoneyKV label="Pending reimbursement requests" cents={b.pending_reimbursement_cents} />
          <MoneyKV label="Capital contributions" cents={b.contributions_cents} />
          {b.distributions_cents > 0 && <MoneyKV label="Distributions from sales" cents={b.distributions_cents} />}
        </Section>
        <Section title="By property">
          {l.s.projects.slice().sort((x, y) => x.nickname.localeCompare(y.nickname)).map((p) => {
            const pb = l.partnerBalance(id, p.id)
            if (pb.out_of_pocket_cents === 0 && pb.contributions_cents === 0) return null
            return (
              <Link key={p.id} className="item" to={recordsLink(`${name} · ${p.nickname}`, entries.filter((e) => e.project_id === p.id).map((e) => e.ref))}>
                <div className="grow">
                  <div className="title">{p.nickname}</div>
                  <div className="subtitle num">Paid personally {Money.format(pb.out_of_pocket_cents)} · Contributed {Money.format(pb.contributions_cents)}</div>
                </div>
                <Icon name="chevron" size={14} />
              </Link>
            )
          })}
          {llcWide > 0 && <MoneyKV label="LLC-wide contributions" cents={llcWide} />}
          {entries.length === 0 && <div className="empty">No personal payments or contributions yet.</div>}
        </Section>
      </div>
      {open.length > 0 && (
        <Section title="Not reimbursed yet">
          {open.map((i) => (
            <Link key={`${i.ref.kind}:${i.ref.id}`} className="item" to={recordPath(i.ref)}>
              <div className="grow">
                <div className="title">{i.entry.title}</div>
                <div className="subtitle">{Days.display(i.entry.date)} · {l.project(i.entry.project_id)?.nickname ?? ''}</div>
              </div>
              <MoneyText cents={i.remaining_cents} bold />
            </Link>
          ))}
        </Section>
      )}
      <Section title="All transactions">
        <EntryList entries={entries} empty="No personal payments, reimbursements or contributions yet." limit={100} />
      </Section>
    </div>
  )
}

/** Shared pot: what each partner put in (lump sums + personal payments), total spent, and each one against their share. */
function PoolSection() {
  const app = useStore()
  const l = app.ledger
  const [pid, setPid] = useState<string>('')
  const s = poolSummary(l, pid || null)
  const basis = s.share_source === 'equal' ? 'an equal share' : s.share_source === 'project' ? 'this project’s split' : 'the default split'
  return (
    <Section title="Who put in what"
      action={<select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Project">
        <option value="">All projects</option>
        {l.s.projects.map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}
      </select>}
      footer={`Put in = contributions to the LLC account + paid personally − reimbursed. Each partner is compared with ${basis} of the total spent. Loans aren't anyone's money in, so they're left out.${pid ? ' Reimbursements aren’t tied to a project, so they only count under All projects.' : ''}`}>
      <MoneyKV label="Total spent" cents={s.total_spent_cents} bold />
          <MoneyKV label="Paid from the LLC account" cents={s.paid_by_llc_cents} />
          <MoneyKV label="Paid personally by partners" cents={s.paid_personally_cents} />
          <MoneyKV label="Contributed to the LLC account" cents={s.contributed_cents} />
          {s.proceeds_cents !== 0 && <MoneyKV label="Sale proceeds in" cents={s.proceeds_cents} />}
          {s.reimbursed_cents !== 0 && <MoneyKV label="Reimbursed to partners" cents={-s.reimbursed_cents} />}
          {s.distributed_cents !== 0 && <MoneyKV label="Distributed to partners" cents={-s.distributed_cents} />}
          <MoneyKV label="Left in the LLC account" cents={s.pot_balance_cents} bold />
          {s.pot_balance_cents < 0 && <div className="item small warn">The LLC paid more than was put in. Add the missing contribution, or check whether a partner really made that payment.</div>}
      <div style={{ overflowX: 'auto', padding: '4px 8px' }}>
        <table className="table">
          <thead><tr><th>Partner</th><th className="num">Contributed</th><th className="num">Paid personally</th><th className="num">Reimbursed</th><th className="num">Put in</th><th className="num">Share of spending</th><th className="num">Over / under share</th></tr></thead>
          <tbody>
            {s.partners.map((p) => (
              <tr key={p.member.user_id}>
                <td>{p.member.display_name}{p.share_bps ? <span className="small muted"> · {p.share_bps / 100}%</span> : null}</td>
                <td className="num">{Money.format(p.contributed_cents)}</td>
                <td className="num">{Money.format(p.paid_personally_cents)}</td>
                <td className="num">{Money.format(p.reimbursed_cents)}</td>
                <td className="num bold">{Money.format(p.put_in_cents)}</td>
                <td className="num">{Money.format(p.share_of_spending_cents)}</td>
                <td className="num bold" style={{ color: p.over_share_cents < 0 ? 'var(--bad)' : p.over_share_cents > 0 ? 'var(--good)' : undefined }}>
                  {p.over_share_cents > 0 ? '+' : ''}{Money.format(p.over_share_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
