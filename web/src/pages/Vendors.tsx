import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { AttachmentRow, EntryList, Icon, KV, MoneyKV, MoneyText, PageHead, Section } from '../ui/common'

export function VendorsPage() {
  const app = useStore()
  const l = app.ledger
  const [q, setQ] = useState('')
  const vs = [...l.s.vendors].sort((a, b) => a.name.localeCompare(b.name)).filter((v) => !q || `${v.name} ${v.contact_name} ${v.kind}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="stack">
      <PageHead title="Vendors and contractors">
        <button className="btn primary" onClick={() => app.open({ type: 'vendor' })}><Icon name="plus" />New vendor</button>
      </PageHead>
      <input type="search" placeholder="Search vendors" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vendors" />
      <Section>
        {vs.length === 0 && <div className="empty">No vendors yet. They're added automatically when you type a new name on a receipt or bill.</div>}
        {vs.map((v) => {
          const sum = l.vendorSummary(v.id)
          return (
            <Link key={v.id} className="item" to={`/vendors/${v.id}`}>
              <div className="grow">
                <div className="title">{v.name}</div>
                <div className="subtitle"><span style={{ textTransform: 'capitalize' }}>{v.kind}</span>{v.contact_name ? ` · ${v.contact_name}` : ''}{v.phone ? ` · ${v.phone}` : ''}</div>
              </div>
              {sum.outstanding_cents > 0 && <span className="small">owes <MoneyText cents={sum.outstanding_cents} bold /></span>}
              <Icon name="chevron" size={14} />
            </Link>
          )
        })}
      </Section>
    </div>
  )
}

export function VendorDetailPage() {
  const { id = '' } = useParams()
  const app = useStore()
  const l = app.ledger
  const v = l.vendor(id)
  if (!v) return <PageHead title="Vendor not found" back="/vendors" />
  const sum = l.vendorSummary(id)
  return (
    <div className="stack">
      <PageHead title={v.name} sub={<span style={{ textTransform: 'capitalize' }}>{v.kind}</span>} back="/vendors">
        <div className="row">
          <button className="btn" onClick={() => app.open({ type: 'vendor', vendor: v })}>Edit</button>
          <Link className="btn" to={`/export?vendor=${v.id}`}><Icon name="download" />CSV</Link>
        </div>
      </PageHead>
      <div className="grid2">
        <Section title="Totals">
          <MoneyKV label="Billed (after credits)" cents={sum.billed_cents} />
          <MoneyKV label="Paid (bills and receipts)" cents={sum.paid_cents} />
          <MoneyKV label="Still owed" cents={sum.outstanding_cents} bold />
        </Section>
        <Section title="Contact">
          <KV k="Contact">{v.contact_name || '-'}</KV>
          <KV k="Phone">{v.phone ? <a href={`tel:${v.phone}`}>{v.phone}</a> : '-'}</KV>
          <KV k="Email">{v.email ? <a href={`mailto:${v.email}`}>{v.email}</a> : '-'}</KV>
          {v.address && <KV k="Address">{v.address}</KV>}
          {v.notes && <KV k="Notes">{v.notes}</KV>}
        </Section>
      </div>
      {sum.projects.length > 0 && (
        <Section title="Projects">
          {sum.projects.map((p) => <Link key={p.id} className="item" to={`/projects/${p.id}`}><span className="grow">{p.nickname}</span><Icon name="chevron" size={14} /></Link>)}
        </Section>
      )}
      <Section title="Bills, payments and receipts"><EntryList entries={sum.entries} empty="No transactions yet." limit={100} /></Section>
      <Section title="Files">
        {sum.attachments.length === 0 && <div className="empty">No documents yet.</div>}
        {sum.attachments.map((a) => <AttachmentRow key={a.id} a={a} showRecord />)}
      </Section>
    </div>
  )
}
