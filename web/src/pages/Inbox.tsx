import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money } from '../core/money'
import type { InboxItem } from '../core/models'
import { FilePicker, Icon, PageHead, Section, Segmented, recordPath } from '../ui/common'
import { ClaimButton } from './Review'

export function InboxPage() {
  const app = useStore()
  const l = app.ledger
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'new' | 'done'>('new')
  const fresh = l.s.inbox_items.filter((i) => i.status === 'new').sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  const done = l.s.inbox_items.filter((i) => i.status !== 'new').sort((a, b) => (b.handled_at ?? '').localeCompare(a.handled_at ?? ''))
  const add = async () => {
    setBusy(true)
    if (await app.addToInbox(files, note)) { setFiles([]); setNote('') }
    setBusy(false)
  }
  return (
    <div className="stack">
      <PageHead title="Receipt inbox" sub="Drop receipts and contractor invoices here from any phone or computer. Any partner can file them later as a receipt or bill, so nothing gets entered twice." />
      <Section title="Add to the inbox" footer="A note like “Oak St tile 412.50” helps: the app suggests the property, vendor, date and amount from it and from the file name.">
        <div style={{ padding: 12 }} className="stack">
          <FilePicker files={files} onChange={setFiles} title="Receipt photos and invoice PDFs" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note: property, vendor, amount…" aria-label="Note" />
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!files.length || busy} onClick={add}>
            {busy ? 'Uploading…' : `Add ${files.length > 1 ? `${files.length} files` : 'to inbox'}`}
          </button>
        </div>
      </Section>

      <Segmented value={tab} onChange={setTab} options={[['new', `To file (${fresh.length})`], ['done', `Filed or dismissed (${done.length})`]]} />
      {tab === 'new' ? (
        <Section>
          {fresh.length === 0 && <div className="empty">The inbox is empty. Nice.</div>}
          {fresh.map((i) => <InboxRow key={i.id} i={i} />)}
        </Section>
      ) : (
        <Section>
          {done.length === 0 && <div className="empty">Nothing filed from the inbox yet.</div>}
          {done.map((i) => <DoneRow key={i.id} i={i} />)}
        </Section>
      )}
      <div className="note">Forwarding receipts by email needs a mail service and your own domain. Once you have a domain, each property can get an address like oak@inbox.yourdomain.com that drops mail attachments into this inbox.</div>
    </div>
  )
}

function OpenFile({ i }: { i: InboxItem }) {
  const app = useStore()
  const [busy, setBusy] = useState(false)
  return (
    <button className="btn" disabled={busy} onClick={async () => {
      setBusy(true)
      const url = await app.fileURL({ id: i.id, workspace_id: i.workspace_id, storage_path: i.storage_path, filename: i.filename, mime_type: i.mime_type, size_bytes: i.size_bytes })
      setBusy(false)
      if (url) window.open(url, '_blank', 'noopener')
    }}>{busy ? 'Opening…' : 'View'}</button>
  )
}

function InboxRow({ i }: { i: InboxItem }) {
  const app = useStore()
  const l = app.ledger
  const [dismissing, setDismissing] = useState(false)
  const [reason, setReason] = useState('')
  const guess = [i.suggested_kind === 'bill' ? 'Bill' : i.suggested_kind === 'receipt' ? 'Receipt' : null, i.suggested_vendor,
    i.suggested_total_cents ? Money.format(i.suggested_total_cents) : null, l.project(i.suggested_project_id)?.nickname,
    i.suggested_date ? Days.display(i.suggested_date) : null].filter(Boolean).join(' · ')
  const file = (kind: 'receipt' | 'bill') => {
    const d = app.inboxDraft(i)
    if (d.kind !== kind) { d.kind = kind; d.payer = kind === 'bill' ? 'llc' : 'me' }
    app.open({ type: 'transaction', draft: d, link: { inbox: i } })
  }
  return (
    <div className="item" style={{ flexWrap: 'wrap' }}>
      <span className="thumb"><Icon name={i.mime_type.startsWith('image/') ? 'receipt' : 'doc'} /></span>
      <div className="grow" style={{ minWidth: 200 }}>
        <div className="title">{i.filename}</div>
        <div className="subtitle">Added by {l.payerName(i.created_by)} · {Days.display((i.created_at ?? '').slice(0, 10))}{i.note ? ` · “${i.note}”` : ''}</div>
        {guess && <div className="small" style={{ color: 'var(--accent)' }}>Suggested: {guess}</div>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <OpenFile i={i} />
        <ClaimButton kind="inbox_item" id={i.id} />
        <button className="btn primary" onClick={() => file(i.suggested_kind === 'bill' ? 'bill' : 'receipt')}>File as {i.suggested_kind === 'bill' ? 'bill' : 'receipt'}</button>
        <button className="btn" onClick={() => file(i.suggested_kind === 'bill' ? 'receipt' : 'bill')}>As {i.suggested_kind === 'bill' ? 'receipt' : 'bill'}</button>
        <button className="btn link danger" onClick={() => setDismissing(!dismissing)}>Dismiss</button>
      </div>
      {dismissing && (
        <form className="row" style={{ width: '100%', gap: 8, marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await app.dismissInbox(i, reason)) setDismissing(false) }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. duplicate, personal purchase" autoFocus style={{ flex: 1 }} />
          <button className="btn" disabled={!reason.trim()}>Dismiss</button>
        </form>
      )}
    </div>
  )
}

function DoneRow({ i }: { i: InboxItem }) {
  const app = useStore()
  const l = app.ledger
  const ref = i.filed_bill_id ? { kind: 'bill' as const, id: i.filed_bill_id } : i.filed_expense_id ? { kind: 'expense' as const, id: i.filed_expense_id } : null
  const entry = ref ? l.entry(ref) : undefined
  return (
    <div className="item">
      <span className="thumb"><Icon name={i.status === 'filed' ? 'check' : 'tray'} /></span>
      <div className="grow">
        <div className="title">{i.filename}</div>
        <div className="subtitle">
          {i.status === 'filed' ? <>Filed by {l.payerName(i.handled_by)}{entry && <> as <Link to={recordPath(entry.ref)}>{entry.title} · {Money.format(entry.amount_cents)}</Link></>}</>
            : <>Dismissed by {l.payerName(i.handled_by)}: {i.dismiss_reason}</>}
        </div>
      </div>
      {i.status === 'dismissed' && <button className="btn" onClick={() => app.reopenInbox(i)}>Put back</button>}
    </div>
  )
}
