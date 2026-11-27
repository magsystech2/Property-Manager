import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { leftover, methodLabel } from '../core/models'
import { basisLabel, profitShares, projectSummary, settlement, type BasisGroup } from '../core/settlement'
import { Icon, MoneyKV, MoneyText, Section, recordPath } from '../ui/common'

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`
const groups: BasisGroup[] = ['purchase', 'closing', 'rehab', 'holding']

/** Project overview card: cost basis by group, ARV, and profit at a glance. */
export function CostBasisCard({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const p = l.project(pid)!
  const s = projectSummary(l, p)
  const committed = s.basis.projected_total - s.basis.spent_total
  return (
    <Section title="Cost basis and profit" footer="Purchase price and closing costs come from the Acquisition and Closing Costs categories; holding covers Financing, Insurance and Utilities; everything else is rehab. Spent = paid + billed.">
      {groups.map((g) => <MoneyKV key={g} label={basisLabel[g]} cents={s.basis.spent[g]} />)}
      <MoneyKV label="Total cost basis so far" cents={s.basis.spent_total} bold />
      {committed > 0 && <MoneyKV label="Plus committed, not billed yet" cents={committed} />}
      {s.sold_net_cents != null
        ? <MoneyKV label="Sale, net proceeds" cents={s.sold_net_cents} />
        : <div className="kv"><span className="grow">ARV / expected sale price</span>{s.arv_cents ? <span className="num">{Money.format(s.arv_cents)}</span> : <span className="muted small">Not set (Forecast tab)</span>}</div>}
      {s.profit_cents != null && (
        <div className="item">
          <span className="grow bold">{s.profit_is_actual ? 'Profit' : 'Projected profit'}</span>
          <span className="num bold" style={{ fontSize: 18, color: s.profit_cents < 0 ? 'var(--bad)' : 'var(--good)' }}>{Money.format(s.profit_cents)}</span>
        </div>
      )}
      {s.roi_bps != null && <div className="kv"><span className="grow muted">Return on cost</span><span className="num">{(s.roi_bps / 100).toFixed(1)}%</span></div>}
      {!s.profit_is_actual && s.profit_cents == null && s.arv_cents != null && <div className="kv"><span className="grow muted">Add a target sale date on the Forecast tab to see projected profit.</span></div>}
    </Section>
  )
}

/** Sale and split tab: record the sale, then who gets what and what's been paid out. */
export function ProjectSale({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const p = l.project(pid)!
  const st = settlement(l, pid)
  const split = profitShares(l, pid)
  const sales = l.s.proceeds.filter((x) => x.project_id === pid && x.status !== 'void')
  const dists = l.s.distributions.filter((x) => x.project_id === pid).sort((a, b) => b.distribution_date.localeCompare(a.distribution_date))
  const splitNote = split.source === 'project' ? 'This project has its own split.' : split.source === 'default' ? 'Using the LLC default split.' : 'No split set, so profit is shared equally.'
  return (
    <div className="grid2">
      <div className="stack">
        <Section title="Sale" action={<button className="btn link" onClick={() => app.open({ type: 'proceeds', projectId: pid })}>{sales.length ? '+ Add another' : 'Record the sale'}</button>}>
          {!st.sold && <div className="empty">Not sold yet. When it closes, record the sale price, selling costs and loan payoff from the closing statement.{p.expected_sale_cents ? ` Expected: ${Money.format(p.expected_sale_cents)}.` : ''}</div>}
          {st.sold && (
            <>
              {st.gross_cents != null && <MoneyKV label="Sale price" cents={st.gross_cents} />}
              {st.selling_costs_cents != null && <MoneyKV label="Selling costs" cents={-st.selling_costs_cents} />}
              <MoneyKV label="Net proceeds" cents={st.net_proceeds_cents} bold />
              <MoneyKV label="Project costs (paid, billed and committed)" cents={-st.costs_cents} />
              <div className="item">
                <span className="grow bold">Profit</span>
                <span className="num bold" style={{ fontSize: 18, color: st.profit_cents < 0 ? 'var(--bad)' : 'var(--good)' }}>{Money.format(st.profit_cents)}</span>
              </div>
              {sales.map((x) => (
                <Link key={x.id} className="item small" to={recordPath({ kind: 'proceeds', id: x.id })} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span className="grow muted">Sold {Days.display(x.sale_date)}{x.notes ? ` · ${x.notes}` : ''}</span><Icon name="chevron" size={14} />
                </Link>
              ))}
            </>
          )}
        </Section>
        {st.sold && (
          <Section title="Cash from the sale" footer="What the LLC can pay out now: net proceeds, minus the loan payoff, bills and contracts still to pay, and distributions already made.">
            <MoneyKV label="Net proceeds" cents={st.net_proceeds_cents} />
            {st.loan_payoff_cents > 0 && <MoneyKV label="Loan paid off at closing" cents={-st.loan_payoff_cents} />}
            {st.still_to_pay_cents > 0 && <MoneyKV label="Bills and contracts still to pay" cents={-st.still_to_pay_cents} />}
            <MoneyKV label="Already distributed" cents={-st.partners.reduce((a, x) => a + x.distributed_cents, 0)} />
            <MoneyKV label="Cash left to distribute" cents={st.cash_left_cents} bold tone={st.cash_left_cents < 0 ? 'bad' : undefined} />
            {st.remaining_total_cents > st.cash_left_cents + 100 && (
              <div className="item"><span className="grow small" style={{ color: 'var(--warn)' }}>Partners are owed {Money.format(st.remaining_total_cents)} but only {Money.format(Math.max(st.cash_left_cents, 0))} is left from this sale. The rest can come from the next sale or the LLC account.</span></div>
            )}
          </Section>
        )}
      </div>
      <div className="stack">
        <Section title={st.sold ? 'Who gets what' : 'Profit split'} action={<button className="btn link" onClick={() => app.open({ type: 'shares', projectId: pid })}>Change split</button>}
          footer={`${splitNote} Capital each partner put in is returned first${st.returns_llc_capital ? ', including LLC-wide contributions (they come back at the LLC’s first sale)' : ''}; the profit or loss is shared by the split. Receipts a partner paid personally are reimbursed separately.`}>
          {st.partners.length === 0 && <div className="empty">No partners yet.</div>}
          {st.partners.map((x) => (
            <div key={x.member.user_id} className="item" style={{ display: 'block' }}>
              <div className="row" style={{ gap: 8 }}>
                <strong className="grow">{x.member.display_name} · {st.share_source === 'equal' && x.share_bps ? 'equal share' : pct(x.share_bps)}</strong>
                {st.sold && <MoneyText cents={x.remaining_cents} bold />}
              </div>
              {st.sold ? (
                <>
                  <div className="small muted num">Capital back {Money.format(x.capital_cents)} · {x.profit_share_cents < 0 ? 'share of loss' : 'profit share'} {Money.format(x.profit_share_cents)} · paid out {Money.format(x.distributed_cents)}</div>
                  {x.owed_for_receipts_cents > 0 && <div className="small" style={{ color: 'var(--warn)' }}>Also owed {Money.format(x.owed_for_receipts_cents)} for receipts they paid. <Link to={`/partners/${x.member.user_id}`}>Reimburse</Link></div>}
                  {x.remaining_cents > 0 && (
                    <button className="btn primary" style={{ marginTop: 6 }} onClick={() => app.open({ type: 'distribution', projectId: pid, partnerId: x.member.user_id, amountCents: x.remaining_cents })}>
                      Pay {Money.format(x.remaining_cents)}
                    </button>
                  )}
                </>
              ) : <div className="small muted num">Capital so far {Money.format(x.capital_cents)}</div>}
            </div>
          ))}
        </Section>
        <Section title="Distributions" action={<button className="btn link" onClick={() => app.open({ type: 'distribution', projectId: pid })}>+ Record one</button>}>
          {dists.length === 0 && <div className="empty">Nothing paid out yet.</div>}
          {dists.map((d) => (
            <Link key={d.id} className="item" to={recordPath({ kind: 'distribution', id: d.id })} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="grow">
                <div className="title" style={d.status === 'void' ? { textDecoration: 'line-through' } : undefined}>{l.payerName(d.partner_user_id)}</div>
                <div className="subtitle">{Days.display(d.distribution_date)} · {methodLabel(d.payment_method)}{d.reference ? ` · ${d.reference}` : ''}{d.status === 'void' ? ' · void' : ''}</div>
              </div>
              <MoneyText cents={d.amount_cents} />
            </Link>
          ))}
        </Section>
      </div>
    </div>
  )
}

/** Materials tab: bought vs used vs leftover, to catch returns and reuse leftovers on the next house. */
export function ProjectMaterials({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const ms = l.s.materials.filter((m) => m.project_id === pid).sort((a, b) => a.name.localeCompare(b.name))
  const leftValue = ms.reduce((a, m) => a + Math.max(Math.round(leftover(m) * m.unit_cost_cents), 0), 0)
  const elsewhere = l.s.materials.filter((m) => m.project_id !== pid && leftover(m) > 0)
  return (
    <div className="stack">
      <Section title={`Materials (${ms.length})`} action={<button className="btn link" onClick={() => app.open({ type: 'material', projectId: pid })}>+ Add material</button>}
        footer="Not an inventory system: just enough to catch returns before the deadline and reuse leftovers. Receipts stay the money record.">
        {ms.length === 0 ? <div className="empty">Nothing tracked yet. Add big-ticket items like flooring, tile, cabinets or lumber.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Bought</th><th className="num">Used</th><th className="num">Returned</th><th className="num">Leftover</th><th className="num">Left value</th></tr></thead>
              <tbody>
                {ms.map((m) => {
                  const left = leftover(m)
                  return (
                    <tr key={m.id} onClick={() => app.open({ type: 'material', projectId: pid, material: m })} style={{ cursor: 'pointer' }}>
                      <td><div>{m.name}</div><div className="small muted">{[m.unit, m.location].filter(Boolean).join(' · ')}</div></td>
                      <td className="num">{m.qty_bought}</td><td className="num">{m.qty_used}</td><td className="num">{m.qty_returned}</td>
                      <td className="num" style={left > 0 ? { color: 'var(--warn)', fontWeight: 600 } : undefined}>{left}</td>
                      <td className="num">{m.unit_cost_cents ? Money.format(Math.round(left * m.unit_cost_cents)) : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {ms.length > 0 && <MoneyKV label="Leftover value on this project" cents={leftValue} bold />}
      </Section>
      {elsewhere.length > 0 && (
        <Section title="Leftovers on other projects">
          {elsewhere.map((m) => (
            <Link key={m.id} className="item" to={`/projects/${m.project_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="grow">{m.name} · {leftover(m)} {m.unit}{m.location ? ` · ${m.location}` : ''}</span>
              <span className="small muted">{l.project(m.project_id)?.nickname}</span>
            </Link>
          ))}
        </Section>
      )}
    </div>
  )
}
