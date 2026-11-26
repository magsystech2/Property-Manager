import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Money, Days, type Cents } from '../core/money'
import { type Entry, type StatusLabel, type EntryRef, type Attachment, PaymentMethods } from '../core/models'
import { useStore } from '../store'

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke style)
// ---------------------------------------------------------------------------
const paths: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.34.22.7.22 1.07',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  x: 'M18 6 6 18M6 6l12 12',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  receipt: 'M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3zM9 8h6M9 12h6M9 16h4',
  doc: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  cash: 'M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01',
  bank: 'M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10 12 3l10 7z',
  sign: 'M3 17c3-4 5-4 6 0s3 4 6-2 4-3 6 1M3 21h18',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  tray: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
}
export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
export function MoneyText({ cents, bold, className, showCents = true }: { cents: Cents; bold?: boolean; className?: string; showCents?: boolean }) {
  return <span className={`num ${bold ? 'bold' : ''} ${className ?? ''}`}>{Money.format(cents, showCents)}</span>
}

const toneIcon: Record<string, string> = { good: 'check', warning: 'clock', bad: 'alert', neutral: 'x' }
export function StatusBadge({ status }: { status: StatusLabel }) {
  const icon = status.text === 'Committed' ? 'sign' : toneIcon[status.tone]
  return <span className={`badge ${status.tone}`}><Icon name={icon} size={12} />{status.text}</span>
}

export const recordPath = (r: EntryRef) => `/records/${r.kind}/${r.id}`

/** With showDue, a bill shows what's still owed as the main figure, with the total and amount paid under it. */
export function EntryRow({ entry, showDue }: { entry: Entry; showDue?: boolean }) {
  const app = useStore()
  const bal = showDue && entry.ref.kind === 'bill' ? app.ledger.balance(entry.ref.id) : null
  const settled = bal ? bal.total_cents - bal.outstanding_cents : 0
  return (
    <Link className="item" to={recordPath(entry.ref)}>
      <div className="grow">
        <div className="title">{entry.title}</div>
        <div className="subtitle">{Days.display(entry.date)} · {entry.subtitle}</div>
      </div>
      <div className="amount">
        {bal ? (
          <>
            <div><MoneyText cents={bal.outstanding_cents} bold /> <span className="small muted">due</span></div>
            {settled !== 0 && <div className="small muted">of {Money.format(bal.total_cents)} · {Money.format(settled)} paid</div>}
          </>
        ) : <MoneyText cents={entry.amount_cents} bold />}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 3 }}>
          {entry.attachment_count > 0 && <span className="muted" title={`${entry.attachment_count} document(s)`}><Icon name="clip" size={13} /></span>}
          <StatusBadge status={entry.status} />
        </div>
      </div>
    </Link>
  )
}

export function EntryList({ entries, empty = 'Nothing here yet.', limit, showDue }: { entries: Entry[]; empty?: string; limit?: number; showDue?: boolean }) {
  const [all, setAll] = useState(false)
  const shown = limit && !all ? entries.slice(0, limit) : entries
  if (entries.length === 0) return <div className="empty">{empty}</div>
  return (
    <div className="list">
      {shown.map((e) => <EntryRow key={`${e.ref.kind}:${e.ref.id}`} entry={e} showDue={showDue} />)}
      {limit && entries.length > limit && !all && (
        <button className="item" onClick={() => setAll(true)}><span className="grow" style={{ color: 'var(--accent)', fontWeight: 600 }}>Show all {entries.length}</span></button>
      )}
    </div>
  )
}

export function Section({ title, footer, action, children, plain }: { title?: ReactNode; footer?: ReactNode; action?: ReactNode; children: ReactNode; plain?: boolean }) {
  return (
    <section className="section">
      {(title || action) && <div className="section-head"><h2>{title}</h2><span className="spacer" />{action}</div>}
      {plain ? children : <div className="card list">{children}</div>}
      {footer && <div className="section-foot">{footer}</div>}
    </section>
  )
}

export function KV({ k, children, to }: { k: ReactNode; children: ReactNode; to?: string }) {
  const body = <><span className="k">{k}</span><span className="v">{children}</span>{to && <span className="chev"><Icon name="chevron" size={14} /></span>}</>
  return to ? <Link className="kv item" style={{ padding: '11px 16px' }} to={to}>{body}</Link> : <div className="kv">{body}</div>
}

export function MoneyKV({ label, cents, bold, to, tone }: { label: ReactNode; cents: Cents; bold?: boolean; to?: string; tone?: 'bad' | 'good' }) {
  return <KV k={bold ? <span className="bold" style={{ color: 'var(--text)' }}>{label}</span> : label} to={to}><MoneyText cents={cents} bold={bold} className={tone} /></KV>
}

export function Tile({ title, cents, icon, detail, to }: { title: string; cents: Cents; icon: string; detail?: string; to: string }) {
  return (
    <Link className="card tile" to={to}>
      <div className="label"><Icon name={icon} size={15} />{title}</div>
      <div className="value num">{Money.format(cents)}</div>
      <div className="more">{detail && <span className="muted" style={{ fontWeight: 500 }}>{detail}</span>}<span className="spacer" />See records →</div>
    </Link>
  )
}

export function PageHead({ title, sub, children, back }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; back?: string }) {
  return (
    <div className="page-head">
      <div style={{ flex: 1, minWidth: 200 }}>
        {back && <Link to={back} className="small row" style={{ gap: 2, marginBottom: 4 }}><Icon name="back" size={14} />Back</Link>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => <button key={v} type="button" role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <label className={`field ${className ?? ''}`}>{label}{children}</label>
}

export function AmountInput({ value, onChange, big, autoFocus, placeholder = '0.00' }: { value: string; onChange: (v: string) => void; big?: boolean; autoFocus?: boolean; placeholder?: string }) {
  return (
    <span className={big ? 'amount-big' : ''} style={{ display: 'block' }}>
      <input inputMode="decimal" className="num" value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,$-]/g, ''))} />
    </span>
  )
}

export function ProjectSelect({ value, onChange, allowNone, noneLabel = 'Choose a project…' }: { value: string | null | undefined; onChange: (v: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  const app = useStore()
  const ps = [...app.ledger.s.projects].sort((a, b) => a.nickname.localeCompare(b.nickname))
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{allowNone ? 'LLC-wide (no project)' : noneLabel}</option>
      {ps.map((p) => <option key={p.id} value={p.id}>{p.nickname}{p.status === 'sold' ? ' (sold)' : ''}</option>)}
    </select>
  )
}

export function CategorySelect({ value, onChange }: { value: string | null | undefined; onChange: (v: string | null) => void }) {
  const app = useStore()
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Choose…</option>
      {app.ledger.activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  )
}

export function PartnerSelect({ value, onChange, allowLLC, llcLabel = 'LLC account' }: { value: string | null | undefined; onChange: (v: string | null) => void; allowLLC?: boolean; llcLabel?: string }) {
  const app = useStore()
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowLLC ? <option value="">{llcLabel}</option> : <option value="">Choose a partner…</option>}
      {/* Partners whose access was removed aren't offered for new entries (unless already chosen). */}
      {app.ledger.s.members.filter((m) => !m.access_revoked_at || m.user_id === value).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}{m.user_id === app.me ? ' (me)' : ''}</option>)}
    </select>
  )
}

export function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)}>{PaymentMethods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
}

/** Pick an existing vendor or type a new name. */
export function VendorInput({ vendorId, newName, onChange }: { vendorId: string | null; newName: string; onChange: (id: string | null, name: string) => void }) {
  const app = useStore()
  const vendors = [...app.ledger.s.vendors].sort((a, b) => a.name.localeCompare(b.name))
  const current = vendorId ? app.ledger.vendor(vendorId)?.name ?? '' : newName
  const listId = useRef(`vendors-${Math.random().toString(36).slice(2)}`).current
  return (
    <>
      <input list={listId} value={current} placeholder="Type or pick a vendor"
        onChange={(e) => {
          const name = e.target.value
          const match = vendors.find((v) => v.name.toLowerCase() === name.trim().toLowerCase())
          onChange(match ? match.id : null, match ? '' : name)
        }} />
      <datalist id={listId}>{vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist>
      {!vendorId && newName.trim() && <span className="note" style={{ fontWeight: 400 }}>New vendor “{newName.trim()}” will be added.</span>}
    </>
  )
}

/** Photos and PDFs. On a phone, "Take photo" opens the camera. */
export function FilePicker({ files, onChange, title = 'Documents' }: { files: File[]; onChange: (f: File[]) => void; title?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const add = (list: FileList | null) => {
    if (!list) return
    const ok = [...list].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    const big = ok.filter((f) => f.size > 20 * 1024 * 1024)
    if (big.length) alertOnce(`${big.map((f) => f.name).join(', ')} is larger than 20 MB and was skipped.`)
    onChange([...files, ...ok.filter((f) => f.size <= 20 * 1024 * 1024)])
  }
  return (
    <div className="panel">
      <div className="row"><h2>{title}</h2></div>
      {files.map((f, i) => (
        <div className="row" key={i}>
          <FileThumb file={f} />
          <span className="grow" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
          <span className="muted small">{Math.max(1, Math.round(f.size / 1024))} KB</span>
          <button type="button" className="btn link danger" onClick={() => onChange(files.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className={`file-drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}>
        <Icon name="clip" /> Drop receipt photos or PDFs here, or click to choose
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => camera.current?.click()}>Take photo</button>
        <span className="note">Images and PDFs, up to 20 MB each.</span>
      </div>
      <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
    </div>
  )
}

function alertOnce(msg: string) {
  import('../store').then(({ store }) => store.showError(new Error(msg)))
}

function FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url ? <img className="thumb" src={url} alt="" /> : <span className="thumb"><Icon name="doc" /></span>
}

export function AttachmentRow({ a, showRecord }: { a: Attachment; showRecord?: boolean }) {
  const app = useStore()
  const [busy, setBusy] = useState(false)
  const ref: EntryRef | null = a.expense_id ? { kind: 'expense', id: a.expense_id } : a.bill_id ? { kind: 'bill', id: a.bill_id }
    : a.bill_payment_id ? { kind: 'payment', id: a.bill_payment_id } : a.reimbursement_id ? { kind: 'reimbursement', id: a.reimbursement_id }
      : a.contribution_id ? { kind: 'contribution', id: a.contribution_id } : a.commitment_id ? { kind: 'commitment', id: a.commitment_id } : null
  const entry = ref ? app.ledger.entry(ref) : undefined
  const open = async () => {
    setBusy(true)
    const url = await app.fileURL(a)
    setBusy(false)
    if (url) window.open(url, '_blank', 'noopener')
  }
  return (
    <div className="item">
      <span className="thumb"><Icon name={a.mime_type.startsWith('image/') ? 'receipt' : 'doc'} /></span>
      <div className="grow">
        <div className="title">{a.filename}</div>
        <div className="subtitle">
          {Math.max(1, Math.round(a.size_bytes / 1024))} KB · {app.ledger.payerName(a.uploaded_by)}{a.created_at ? ` · ${Days.display(a.created_at.slice(0, 10))}` : ''}
          {showRecord && entry && <> · <Link to={recordPath(entry.ref)}>{entry.title}</Link></>}
          {showRecord && !ref && (a.vendor_id ? ' · Vendor document' : a.project_id ? ' · Project document' : '')}
        </div>
      </div>
      <button className="btn" disabled={busy} onClick={open}>{busy ? 'Opening…' : 'Open'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------
export function ModalShell({ title, children, onClose, onSave, saveTitle = 'Save', canSave = true, busy, secondary }: {
  title: string; children: ReactNode; onClose: () => void; onSave?: () => void; saveTitle?: string; canSave?: boolean; busy?: boolean; secondary?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal" role="dialog" aria-label={title} onSubmit={(e) => { e.preventDefault(); if (canSave && !busy) onSave?.() }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn link" onClick={onClose}>Cancel</button>
        </div>
        <div className="modal-body">{children}</div>
        {(onSave || secondary) && (
          <div className="modal-foot">
            {secondary}
            {onSave && <button type="submit" className="btn primary big" disabled={!canSave || busy}>{busy ? 'Saving…' : saveTitle}</button>}
          </div>
        )}
      </form>
    </div>
  )
}

/** A big money figure with the cents set smaller, as in the hero cards. */
export function BigMoney({ cents }: { cents: Cents }) {
  const s = Money.format(cents)
  const i = s.lastIndexOf('.')
  return <span className="big-money num">{i > 0 ? <>{s.slice(0, i)}<span className="cents">{s.slice(i)}</span></> : s}</span>
}

/** Dark green headline card with an optional tan side card for the one thing that needs attention. */
export function Hero({ label, cents, children, side }: { label: ReactNode; cents: Cents; children?: ReactNode; side?: ReactNode }) {
  return (
    <section className={`hero2 ${side ? 'with-side' : ''}`}>
      <div className="hero-main">
        <div className="hero-label">{label}</div>
        <BigMoney cents={cents} />
        {children}
      </div>
      {side && <div className="hero-side">{side}</div>}
    </section>
  )
}

export interface StripItem { label: ReactNode; value: ReactNode; note?: ReactNode; tone?: 'good' | 'bad'; to?: string }
/** A flat row of four figures divided by rules. */
export function StatStrip({ items }: { items: StripItem[] }) {
  return (
    <div className="strip">
      {items.map((x, i) => {
        const body = <><div className="strip-label">{x.label}</div><div className={`strip-value num ${x.tone ?? ''}`}>{x.value}</div>{x.note && <div className="strip-note">{x.note}</div>}</>
        return x.to ? <Link key={i} className="strip-cell" to={x.to}>{body}</Link> : <div key={i} className="strip-cell">{body}</div>
      })}
    </div>
  )
}
