import { useState } from 'react'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import { forecast } from '../core/planning'
import { AmountInput, Field, MoneyKV, Section } from '../ui/common'

const pct = (bps: number | null | undefined) => (bps == null ? '' : String(bps / 100))
const toBps = (v: string) => { const n = Number(v.replace('%', '').trim()); return v.trim() === '' || Number.isNaN(n) ? null : Math.round(n * 100) }

export function ProjectForecast({ pid }: { pid: string }) {
  const app = useStore()
  const l = app.ledger
  const p = l.project(pid)!
  const [delay, setDelay] = useState(0)
  const [salePct, setSalePct] = useState(100)
  const [editing, setEditing] = useState(!p.expected_sale_cents)
  const [f, setF] = useState(() => ({
    sale: p.expected_sale_cents != null ? Money.plain(p.expected_sale_cents) : '',
    selling: pct(p.selling_cost_bps ?? 600),
    holding: p.monthly_holding_cents != null ? Money.plain(p.monthly_holding_cents) : '',
    loan: p.loan_balance_cents != null ? Money.plain(p.loan_balance_cents) : '',
    rate: pct(p.loan_rate_bps),
    saleDate: p.target_sale_date ?? '',
  }))
  const base = forecast(l, p)
  const what = forecast(l, p, { delayMonths: delay, salePct })
  const save = async () => {
    if (await app.saveProject({ ...p, expected_sale_cents: Money.parse(f.sale), selling_cost_bps: toBps(f.selling), monthly_holding_cents: Money.parse(f.holding),
      loan_balance_cents: Money.parse(f.loan), loan_rate_bps: toBps(f.rate), target_sale_date: f.saleDate || null })) setEditing(false)
  }
  const tone = (c: number) => (c < 0 ? { color: 'var(--bad)' } : { color: 'var(--good)' })
  const grid = [0, 1, 2, 3].map((d) => [100, 95, 90].map((s) => forecast(l, p, { delayMonths: d, salePct: s }).profit_cents))
  return (
    <div className="grid2">
      <div className="stack">
        <Section title="Expected profit" footer="Projected costs are paid + unpaid billed + committed not billed (purchase and closing costs included). If the budget is higher, the rest of the budget is counted too. Holding costs and loan interest run from today until the sale.">
          {base.missing.length > 0 && <div className="item"><span className="grow" style={{ color: 'var(--warn)' }}>Add the {base.missing.join(' and ')} to see a forecast.</span></div>}
          <MoneyKV label="Expected sale price" cents={what.sale_cents} />
          <MoneyKV label={`Selling costs (${pct(p.selling_cost_bps ?? 0)}%)`} cents={-what.selling_costs_cents} />
          <MoneyKV label="Projected costs" cents={-what.projected_costs_cents} />
          {what.budget_gap_cents > 0 && <MoneyKV label="Budget not yet committed" cents={-what.budget_gap_cents} />}
          <MoneyKV label={`Holding, ${what.months_left} months`} cents={-what.holding_cents} />
          <MoneyKV label="Loan interest" cents={-what.interest_cents} />
          <div className="item">
            <span className="grow bold">Profit{delay || salePct !== 100 ? ' (what-if)' : ''}</span>
            <span className="num bold" style={{ fontSize: 20, ...tone(what.profit_cents) }}>{Money.format(what.profit_cents)}</span>
          </div>
          {what.margin_bps != null && <div className="item"><span className="grow muted">Return on cost</span><span className="num">{(what.margin_bps / 100).toFixed(1)}%</span></div>}
          {(delay || salePct !== 100) ? <div className="item"><span className="grow muted">Change from plan</span><span className="num bold" style={tone(what.profit_cents - base.profit_cents)}>{Money.format(what.profit_cents - base.profit_cents)}</span></div> : null}
        </Section>
        <Section title="What if">
          <div style={{ padding: 12 }} className="stack">
            <label className="stack" style={{ gap: 4 }}>
              <span className="row"><span className="grow">Sale is delayed by</span><strong>{delay} month{delay === 1 ? '' : 's'}</strong></span>
              <input type="range" min={0} max={12} value={delay} onChange={(e) => setDelay(Number(e.target.value))} aria-label="Months of delay" />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="row"><span className="grow">Sale price</span><strong>{salePct}% · {Money.format(Math.round((p.expected_sale_cents ?? 0) * salePct / 100), false)}</strong></span>
              <input type="range" min={75} max={110} value={salePct} onChange={(e) => setSalePct(Number(e.target.value))} aria-label="Sale price percent" />
            </label>
            {(delay > 0 || salePct !== 100) && <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => { setDelay(0); setSalePct(100) }}>Back to plan</button>}
            <div className="note">Each month of delay adds {Money.format((p.monthly_holding_cents ?? 0) + Math.round((p.loan_balance_cents ?? 0) * (p.loan_rate_bps ?? 0) / 120000))} in holding costs and interest.</div>
          </div>
        </Section>
      </div>
      <div className="stack">
        <Section title="Profit by delay and price">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Delay</th><th className="num">At 100%</th><th className="num">At 95%</th><th className="num">At 90%</th></tr></thead>
              <tbody>{grid.map((row, d) => (
                <tr key={d}><td>{d === 0 ? 'On time' : `+${d} mo`}</td>{row.map((c, i) => <td key={i} className="num" style={tone(c)}>{Money.format(c, false)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Forecast inputs" action={!editing ? <button className="btn link" onClick={() => setEditing(true)}>Edit</button> : undefined}
          footer="Shared with all partners. Purchase price and closing costs come from the costs you've entered (Acquisition and Closing Costs categories).">
          {!editing ? (
            <>
              <MoneyKV label="Expected sale price" cents={p.expected_sale_cents ?? 0} />
              <div className="kv"><span className="grow">Target sale date</span><span>{Days.display(p.target_sale_date)}</span></div>
              <div className="kv"><span className="grow">Selling costs</span><span>{pct(p.selling_cost_bps) || '0'}%</span></div>
              <MoneyKV label="Holding costs per month" cents={p.monthly_holding_cents ?? 0} />
              <MoneyKV label="Loan balance" cents={p.loan_balance_cents ?? 0} />
              <div className="kv"><span className="grow">Loan rate</span><span>{pct(p.loan_rate_bps) || '0'}% a year</span></div>
            </>
          ) : (
            <form className="form-grid" style={{ padding: 12 }} onSubmit={(e) => { e.preventDefault(); save() }}>
              <Field label="Expected sale price"><AmountInput value={f.sale} onChange={(v) => setF({ ...f, sale: v })} /></Field>
              <Field label="Target sale date"><input type="date" value={f.saleDate} onChange={(e) => setF({ ...f, saleDate: e.target.value })} /></Field>
              <Field label="Selling costs (%)"><input inputMode="decimal" value={f.selling} placeholder="6" onChange={(e) => setF({ ...f, selling: e.target.value })} /></Field>
              <Field label="Holding costs per month"><AmountInput value={f.holding} onChange={(v) => setF({ ...f, holding: v })} placeholder="Taxes, insurance, utilities" /></Field>
              <Field label="Loan balance"><AmountInput value={f.loan} onChange={(v) => setF({ ...f, loan: v })} /></Field>
              <Field label="Loan rate (% a year)"><input inputMode="decimal" value={f.rate} placeholder="11" onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
              <div className="row full" style={{ gap: 8 }}>
                <button className="btn primary">Save</button>
                {p.expected_sale_cents != null && <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>}
              </div>
            </form>
          )}
        </Section>
      </div>
    </div>
  )
}
