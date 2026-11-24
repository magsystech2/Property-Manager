import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../store'
import { Days, Money, uuid } from '../core/money'
import type { StatementLine } from '../core/models'
import { fingerprint, lineMatchedCents, parseStatement, suggestMatches, type ParsedStatement } from '../core/planning'
import { Field, Icon, MoneyText, PageHead, PartnerSelect, Section, Segmented, recordPath } from '../ui/common'
import { ClaimButton } from './Review'

export function StatementsPage() {
  const app = useStore()
  const l = app.ledger
  const [params] = useSearchParams()
  const focus = params.get('line')
  const [tab, setTab] = useState<'unmatched' | 'matched' | 'ignored'>(() => (focus ? (l.s.statement_lines.find((x) => x.id === focus)?.status as 'unmatched') ?? 'unmatched' : 'unmatched'))
  const [account, setAccount] = useState('all')
  const accounts = [...new Set(l.s.statement_lines.map((x) => x.account))].sort()
  const lines = l.s.statement_lines.filter((x) => x.status === tab && (account === 'all' || x.account === account))
    .sort((a, b) => b.posted_date.localeCompare(a.posted_date) || b.amount_cents - a.amount_cents)
  const count = (s: string) => l.s.statement_lines.filter((x) => x.status === s && (account === 'all' || x.account === account)).length
  return (
    <div className="stack">
      <PageHead title="Card and bank statements" sub="Import a statement, then match each charge to its receipt. Charges with no receipt show up as missing receipts." />
      <ImportStatement />
      {l.s.statement_lines.length > 0 && (
        <>
          <div className="row wrap" style={{ gap: 8 }}>
            <Segmented value={tab} onChange={setTab} options={[['unmatched', `To match (${count('unmatched')})`], ['matched', `Matched (${count('matched')})`], ['ignored', `Ignored (${count('ignored')})`]]} />
            {accounts.length > 1 && (
              <select value={account} onChange={(e) => setAccount(e.target.value)} style={{ width: 'auto' }} aria-label="Account">
                <option value="all">All accounts</option>{accounts.map((a) => <option key={a}>{a}</option>)}
              </select>
            )}
          </div>
          <Section>
            {lines.length === 0 && <div className="empty">{tab === 'unmatched' ? 'Every line is matched or ignored.' : 'Nothing here.'}</div>}
            {lines.map((x) => <LineRow key={x.id} line={x} highlight={x.id === focus} />)}
          </Section>
        </>
      )}
    </div>
  )
}

function ImportStatement() {
  const app = useStore()
  const l = app.ledger
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [account, setAccount] = useState('')
  const [owner, setOwner] = useState<string | null>(null)
  const [neg, setNeg] = useState<boolean | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const parsed: ParsedStatement | null = useMemo(() => (text ? parseStatement(text, neg) : null), [text, neg])
  const known = [...new Map(l.s.statement_lines.map((x) => [x.account, x.account_owner ?? null])).entries()]
  const existing = new Set(l.s.statement_lines.map((x) => x.fingerprint))
  const prepared = useMemo(() => {
    if (!parsed || !account.trim()) return []
    const seen = new Map<string, number>()
    return parsed.lines.map((x) => {
      const base = fingerprint(account, x, 0)
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { ...x, fp: fingerprint(account, x, n) }
    })
  }, [parsed, account])
  const fresh = prepared.filter((x) => !existing.has(x.fp))
  const reset = () => { setText(null); setFileName(''); setNeg(undefined) }
  const doImport = async () => {
    const ws = app.workspace?.id
    if (!ws) return
    setBusy(true)
    const batch = uuid()
    const rows: StatementLine[] = fresh.map((x) => ({ id: uuid(), workspace_id: ws, account: account.trim(), account_owner: owner, posted_date: x.posted_date,
      description: x.description, amount_cents: x.amount_cents, fingerprint: x.fp, import_batch: batch, status: 'unmatched' }))
    if ((await app.importStatement(rows)) != null) reset()
    setBusy(false)
  }
  return (
    <Section title="Import a statement" footer="Download the statement as CSV from your bank or card website (usually under Activity → Download). Importing the same statement again skips lines already in.">
      <div style={{ padding: 12 }} className="stack">
        <div className="form-grid">
          <Field label="Account name">
            <input list="known-accounts" value={account} placeholder="e.g. Chase Ink 4421" onChange={(e) => {
              setAccount(e.target.value)
              const k = known.find(([a]) => a === e.target.value)
              if (k) setOwner(k[1])
            }} />
            <datalist id="known-accounts">{known.map(([a]) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Whose account"><PartnerSelect value={owner} onChange={setOwner} allowLLC llcLabel="LLC account" /></Field>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={() => input.current?.click()}><Icon name="tray" />{fileName ? `${fileName} · choose another` : 'Choose CSV file'}</button>
          <input ref={input} type="file" accept=".csv,.txt,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFileName(f.name); setNeg(undefined); setText(await f.text()) } e.target.value = '' }} />
          {owner && <span className="small muted">Charges will count as paid personally by {l.payerName(owner)} when you enter receipts from them.</span>}
        </div>
        {parsed?.error && <div className="callout bad">{parsed.error}</div>}
        {parsed && !parsed.error && (
          <>
            <div className="row wrap" style={{ gap: 12 }}>
              <span>{parsed.lines.length} lines · {Days.display(parsed.lines.reduce((a, x) => (x.posted_date < a ? x.posted_date : a), parsed.lines[0]?.posted_date ?? ''))} to {Days.display(parsed.lines.reduce((a, x) => (x.posted_date > a ? x.posted_date : a), ''))}</span>
              <label className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={parsed.chargesNegative} onChange={(e) => setNeg(e.target.checked)} />
                Charges are negative numbers in this file
              </label>
            </div>
            <div className="card list" style={{ maxHeight: 220, overflow: 'auto' }}>
              {parsed.lines.slice(0, 8).map((x, i) => (
                <div key={i} className="item"><span className="grow small">{Days.display(x.posted_date)} · {x.description}</span><MoneyText cents={x.amount_cents} /></div>
              ))}
              {parsed.lines.length > 8 && <div className="item small muted">…and {parsed.lines.length - 8} more</div>}
            </div>
            <div className="note">Check the first few: charges should be positive (money out), refunds and payments negative. If they're backwards, flip the checkbox.</div>
            {parsed.skipped.length > 0 && <div className="small muted">Skipped {parsed.skipped.length} rows: {parsed.skipped.slice(0, 3).map((s) => `row ${s.row} (${s.reason})`).join(', ')}{parsed.skipped.length > 3 ? '…' : ''}</div>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" disabled={!account.trim() || !fresh.length || busy} onClick={doImport}>
                {busy ? 'Importing…' : !account.trim() ? 'Name the account first' : fresh.length ? `Import ${fresh.length} lines` : 'All lines already imported'}
              </button>
              {prepared.length > fresh.length && fresh.length > 0 && <span className="small muted">{prepared.length - fresh.length} already in, skipped</span>}
              <button className="btn link" onClick={reset}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Section>
  )
}

function LineRow({ line, highlight }: { line: StatementLine; highlight?: boolean }) {
  const app = useStore()
  const l = app.ledger
  const [open, setOpen] = useState(!!highlight)
  const [ignoring, setIgnoring] = useState(false)
  const [reason, setReason] = useState('')
  const matches = l.s.statement_matches.filter((m) => m.statement_line_id === line.id)
  const suggestions = line.status === 'unmatched' ? suggestMatches(l, line) : []
  const matched = lineMatchedCents(l, line.id)
  return (
    <div className="item" style={{ display: 'block', ...(highlight ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : {}) }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="title">{line.description || '(no description)'}</div>
          <div className="subtitle">{Days.display(line.posted_date)} · {line.account}{line.account_owner ? ` · ${l.payerName(line.account_owner)}` : ''}
            {line.status === 'unmatched' && suggestions.length > 0 && <span style={{ color: 'var(--good)' }}> · {suggestions.length === 1 ? 'likely match found' : `${suggestions.length} possible matches`}</span>}
            {line.status === 'unmatched' && matched !== 0 && ` · ${Money.format(matched)} matched so far`}
          </div>
        </div>
        <MoneyText cents={line.amount_cents} bold />
      </div>
      {line.status === 'unmatched' && (
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {suggestions[0] && <button className="btn primary" onClick={() => app.matchLine(line, [suggestions[0].ref])}>Match to {suggestions[0].entry.title} · {Days.display(suggestions[0].entry.date)}</button>}
          {line.amount_cents > 0 && <button className={`btn ${suggestions[0] ? '' : 'primary'}`} onClick={() => app.open({ type: 'transaction', draft: app.lineDraft(line), link: { line } })}>Enter receipt</button>}
          {line.amount_cents > 0 && <button className="btn" onClick={() => app.open({ type: 'splitLine', line })}>Split across properties</button>}
          <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Find'} matches</button>
          <ClaimButton kind="statement_line" id={line.id} />
          <button className="btn link" onClick={() => setIgnoring(!ignoring)}>Ignore</button>
        </div>
      )}
      {ignoring && (
        <form className="row" style={{ gap: 8, marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await app.ignoreLine(line, reason)) setIgnoring(false) }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. card payment, personal, transfer between accounts" autoFocus style={{ flex: 1 }} />
          <button className="btn" disabled={!reason.trim()}>Ignore</button>
        </form>
      )}
      {open && line.status === 'unmatched' && <FindMatch line={line} />}
      {line.status === 'matched' && (
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
          <span className="small muted">Matched to</span>
          {matches.map((m) => {
            const ref = m.expense_id ? { kind: 'expense' as const, id: m.expense_id } : { kind: 'payment' as const, id: m.bill_payment_id! }
            const e = l.entry(ref)
            return <Link key={m.id} className="badge neutral" to={recordPath(ref)}>{e ? `${e.title} · ${l.project(e.project_id)?.nickname ?? ''} · ${Money.format(e.amount_cents)}` : 'record'}</Link>
          })}
          <button className="btn link" onClick={() => app.unmatchLine(line)}>Undo match</button>
        </div>
      )}
      {line.status === 'ignored' && (
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <span className="small muted">Ignored by {l.payerName(line.handled_by)}: {line.ignore_reason}</span>
          <button className="btn link" onClick={() => app.unignoreLine(line)}>Undo</button>
        </div>
      )}
    </div>
  )
}

/** Pick one or more receipts or bill payments by hand (for a charge that covers several receipts, or a looser match). */
function FindMatch({ line }: { line: StatementLine }) {
  const app = useStore()
  const l = app.ledger
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const used = new Set(l.s.statement_matches.flatMap((m) => [m.expense_id, m.bill_payment_id]))
  const near = l.entries().filter((e) => (e.ref.kind === 'expense' || e.ref.kind === 'payment') && e.status.text !== 'Void' && !used.has(e.ref.id)
    && Math.abs(Days.daysBetween(e.date, line.posted_date)) <= 30
    && (!q || `${e.title} ${e.subtitle} ${Money.plain(e.amount_cents)}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Math.abs(Math.abs(a.amount_cents) - Math.abs(line.amount_cents)) - Math.abs(Math.abs(b.amount_cents) - Math.abs(line.amount_cents)) || Math.abs(Days.daysBetween(a.date, line.posted_date)) - Math.abs(Days.daysBetween(b.date, line.posted_date)))
    .slice(0, 12)
  const total = picked.reduce((a, k) => a + (l.entries().find((e) => `${e.ref.kind}:${e.ref.id}` === k)?.amount_cents ?? 0), 0) + lineMatchedCents(l, line.id)
  return (
    <div className="stack" style={{ marginTop: 8, padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipts and payments within 30 days" />
      {near.length === 0 && <div className="small muted">No unmatched receipts or payments near this date. Enter a receipt instead.</div>}
      {near.map((e) => {
        const k = `${e.ref.kind}:${e.ref.id}`
        return (
          <label key={k} className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={picked.includes(k)} onChange={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />
            <span className="grow">{Days.display(e.date)} · {e.title} · {e.subtitle}</span>
            <MoneyText cents={e.amount_cents} />
          </label>
        )
      })}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={!picked.length || Math.abs(total) > Math.abs(line.amount_cents)}
          onClick={() => app.matchLine(line, picked.map((k) => { const [kind, id] = k.split(':'); return { kind: kind as 'expense', id } }))}>
          Match {picked.length || ''} selected
        </button>
        <span className="small muted">{Money.format(total)} of {Money.format(line.amount_cents)}{Math.abs(total) > Math.abs(line.amount_cents) ? ': more than the charge' : ''}</span>
      </div>
    </div>
  )
}
