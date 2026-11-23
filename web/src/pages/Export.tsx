import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store'
import { csv, filename, rows, totals, type CSVFilter } from '../core/csv'
import { Money } from '../core/money'
import { Field, Icon, MoneyKV, PageHead, PartnerSelect, ProjectSelect, Section } from '../ui/common'

export function ExportPage() {
  const app = useStore()
  const l = app.ledger
  const [params] = useSearchParams()
  const [f, setF] = useState<CSVFilter>({ project_id: params.get('project'), partner_id: params.get('partner'), vendor_id: params.get('vendor') })
  const rs = useMemo(() => rows(l, f), [l, f])
  const t = totals(rs)
  const download = () => {
    const blob = new Blob([csv(l, f)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename(l, f)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return (
    <div className="stack">
      <PageHead title="Export CSV" sub="One row per transaction, or per category share when a record is split. Same columns as the iPhone export." />
      <div className="panel">
        <div className="form-grid">
          <Field label="Project"><ProjectSelect value={f.project_id} onChange={(v) => setF({ ...f, project_id: v })} noneLabel="All projects" /></Field>
          <Field label="Partner"><PartnerSelect value={f.partner_id} onChange={(v) => setF({ ...f, partner_id: v })} allowLLC llcLabel="All partners" /></Field>
          <Field label="Vendor">
            <select value={f.vendor_id ?? ''} onChange={(e) => setF({ ...f, vendor_id: e.target.value || null })}>
              <option value="">All vendors</option>
              {[...l.s.vendors].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <div className="row">
            <Field label="From" className="grow"><input type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || null })} /></Field>
            <Field label="To" className="grow"><input type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || null })} /></Field>
          </div>
        </div>
        <div className="row">
          <span className="note">{rs.length} rows · {filename(l, f)}</span>
          <span className="spacer" />
          <button className="btn primary" onClick={download}><Icon name="download" />Download CSV</button>
        </div>
      </div>
      <Section title="Totals in this export" footer="These match the app: project paid cost and unpaid billed add up to the project and category summaries, and out of pocket minus reimbursed is what the LLC owes each partner.">
        <MoneyKV label="Project paid cost" cents={t.paid_cost} />
        <MoneyKV label="Project unpaid billed" cents={t.unpaid_billed} />
        <MoneyKV label="Project committed, not billed" cents={t.unbilled_committed} />
        <MoneyKV label="Partner out of pocket" cents={t.out_of_pocket} />
        <MoneyKV label="Partner reimbursed" cents={t.reimbursed} />
        <MoneyKV label="Owed to partners (out of pocket − reimbursed)" cents={t.out_of_pocket - t.reimbursed} bold />
        <MoneyKV label="Partner contributions" cents={t.contribution} />
        <MoneyKV label="Sale proceeds" cents={t.proceeds} />
      </Section>
      <div className="note">Amounts are in dollars ({Money.plain(123456)} format) so spreadsheets read them as numbers.</div>
    </div>
  )
}
