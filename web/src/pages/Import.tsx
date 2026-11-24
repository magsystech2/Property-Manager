import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import { columnHelp, parseCSV, readImport, templateCSV, type ImportRow } from '../core/bulkImport'
import { Days, Money } from '../core/money'
import { Icon, PageHead, Section } from '../ui/common'

function saveFile(text: string, name: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

type RowState = { saved?: boolean; error?: string }

export function ImportPage() {
  const app = useStore()
  const l = app.ledger
  const input = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [table, setTable] = useState<string[][] | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [state, setState] = useState<Record<number, RowState>>({})
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [drag, setDrag] = useState(false)

  // Checked once when the file is read, so rows saved during this import aren't re-flagged as duplicates of themselves.
  const result = useMemo(() => (table ? readImport(table, l, app.me) : null), [table]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = result?.rows ?? []
  const ready = rows.filter((r) => r.draft && !state[r.line]?.saved)
  const problems = rows.filter((r) => r.errors.length)
  const chosen = ready.filter((r) => picked.has(r.line))
  const chosenTotal = chosen.reduce((a, r) => a + (Money.parse(r.draft!.total_text) ?? 0) * (r.draft!.is_refund ? -1 : 1), 0)
  const savedCount = Object.values(state).filter((s) => s.saved).length

  const read = async (f: File | undefined) => {
    if (!f) return
    setFileName(f.name); setState({}); setFileError(null); setTable(null)
    if (/\.(xlsx|xls|numbers)$/i.test(f.name)) {
      setFileError('Save the spreadsheet as CSV first. Excel: File → Save As → CSV UTF-8. Google Sheets: File → Download → CSV. Numbers: File → Export To → CSV.')
      return
    }
    if (f.size > 5 * 1024 * 1024) { setFileError('That file is over 5 MB. Split it into smaller files.'); return }
    const t = parseCSV(await f.text())
    if (t.length < 2) { setFileError('No rows found under the header. Fill in the template and choose it again.'); return }
    if (t.length > 1001) { setFileError(`That file has ${t.length - 1} rows. Upload up to 1,000 at a time.`); return }
    const r = readImport(t, l, app.me)
    setTable(t)
    setPicked(new Set(r.rows.filter((x) => x.draft && !x.duplicate).map((x) => x.line)))
  }

  const toggle = (line: number) => setPicked((p) => { const n = new Set(p); if (n.has(line)) n.delete(line); else n.add(line); return n })

  const importRows = async () => {
    const list = chosen
    setProgress({ done: 0, total: list.length })
    const { saved, failed } = await app.importMany(list.map((r) => r.draft!), (done) => setProgress({ done, total: list.length }))
    setProgress(null)
    setState((s) => {
      const n = { ...s }
      for (const r of list) {
        if (saved.includes(r.draft!.id)) n[r.line] = { saved: true }
        else if (failed[r.draft!.id]) n[r.line] = { error: failed[r.draft!.id] }
      }
      return n
    })
    setPicked((p) => new Set([...p].filter((line) => !list.some((r) => r.line === line && saved.includes(r.draft!.id)))))
    if (saved.length) app.showToast(`${saved.length} ${saved.length === 1 ? 'entry' : 'entries'} imported`)
  }

  return (
    <div className="stack">
      <PageHead title="Bulk upload" sub="Add many receipts and bills at once from a spreadsheet. Each row is checked the same way as the Add form before anything is saved." />

      <Section title="1. Get the template" footer="Open it in Excel, Numbers or Google Sheets, replace the two example rows with yours (or keep them to try it), and save as CSV.">
        <div className="item">
          <span className="thumb"><Icon name="doc" /></span>
          <div className="grow">
            <div className="title">bulk-upload-template.csv</div>
            <div className="subtitle">Header row plus a sample receipt and bill, using your projects and categories</div>
          </div>
          <button className="btn primary" onClick={() => saveFile(templateCSV(l), 'bulk-upload-template.csv')}><Icon name="download" />Download template</button>
        </div>
        <details className="item" style={{ display: 'block' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>What goes in each column</summary>
          <table className="table" style={{ marginTop: 8 }}>
            <tbody>{columnHelp.map(([k, v]) => <tr key={k}><td className="bold" style={{ whiteSpace: 'nowrap' }}>{k}</td><td>{v}</td></tr>)}</tbody>
          </table>
          <div className="small muted" style={{ marginTop: 6 }}>
            Projects: {l.s.projects.map((p) => p.nickname).join(', ') || 'none yet'}. Categories: {l.activeCategories.map((c) => c.name).join(', ')}.
          </div>
        </details>
      </Section>

      <Section title="2. Choose your filled-in file">
        <div className={`item dropzone ${drag ? 'drag' : ''}`} style={{ justifyContent: 'center', padding: 22, cursor: 'pointer' }}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files[0]) }}>
          <Icon name="tray" />
          <span>{fileName ? <><strong>{fileName}</strong> · choose another</> : 'Drop a CSV file here, or click to choose'}</span>
        </div>
        <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv,.xlsx,.xls,.numbers" hidden onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
      </Section>

      {fileError && <div className="callout bad" role="alert">{fileError}</div>}
      {result && result.missingColumns.length > 0 && (
        <div className="callout bad" role="alert">The file is missing these columns: {result.missingColumns.join(', ')}. Start from the template so the header row matches.</div>
      )}

      {rows.length > 0 && (
        <Section title="3. Check and import"
          footer={app.workspace?.require_review ? 'Approvals are on, so imported bills wait for a second partner to approve them.' : 'Imported entries show up in Activity right away. A wrong one can be voided like any other entry.'}
          action={<span className="small muted">{ready.length} ready · {problems.length} need fixing{savedCount ? ` · ${savedCount} imported` : ''}</span>}>
          {problems.length > 0 && <div className="item"><span className="grow small" style={{ color: 'var(--bad)' }}>Rows marked in red can't be imported. Fix them in your file and choose it again; rows already imported will show as duplicates and stay unchecked.</span></div>}
          <div style={{ overflowX: 'auto' }}>
            <table className="table import-table">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Select all ready rows" checked={ready.length > 0 && chosen.length === ready.length}
                    onChange={(e) => setPicked(e.target.checked ? new Set(ready.map((r) => r.line)) : new Set())} /></th>
                  <th>Row</th><th>Type</th><th>Date</th><th>Project</th><th>Vendor</th><th>Category</th><th className="num">Amount</th><th>Check</th>
                </tr>
              </thead>
              <tbody>{rows.map((r) => <Row key={r.line} r={r} s={state[r.line]} checked={picked.has(r.line)} onToggle={() => toggle(r.line)} />)}</tbody>
            </table>
          </div>
          <div className="item">
            <span className="grow">{progress ? `Saving ${progress.done} of ${progress.total}…` : chosen.length ? `${chosen.length} selected · ${Money.format(chosenTotal)}` : savedCount ? <>Done. <Link to="/activity">See them in Activity</Link></> : 'Nothing selected'}</span>
            <button className="btn primary" disabled={!chosen.length || !!progress} onClick={importRows}>
              {progress ? 'Importing…' : `Import ${chosen.length || ''} ${chosen.length === 1 ? 'row' : 'rows'}`}
            </button>
          </div>
        </Section>
      )}
    </div>
  )
}

function Row({ r, s, checked, onToggle }: { r: ImportRow; s?: RowState; checked: boolean; onToggle: () => void }) {
  const app = useStore()
  const l = app.ledger
  const d = r.draft
  const cat = d?.splits[0]?.category_id ? l.category(d.splits[0].category_id)?.name : r.values.category
  const amount = d ? Money.parse(d.total_text)! * (d.is_refund ? -1 : 1) : null
  return (
    <tr className={r.errors.length ? 'row-bad' : s?.saved ? 'row-done' : ''}>
      <td>{d && !s?.saved && <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Import row ${r.line}`} />}</td>
      <td className="muted">{r.line}</td>
      <td>{d ? (d.kind === 'bill' ? 'Bill' : d.is_refund ? 'Refund' : 'Receipt') : r.values.type || 'receipt'}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{d ? Days.display(d.date) : r.values.date}</td>
      <td>{d ? l.project(d.project_id)?.nickname : r.values.project}</td>
      <td>{r.values.vendor}</td>
      <td>{cat || <span className="muted">-</span>}</td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>{amount != null ? Money.format(amount) : r.values.amount}</td>
      <td className="small">
        {s?.saved ? <span className="badge good">Imported</span>
          : s?.error ? <span style={{ color: 'var(--bad)' }}>{s.error}</span>
            : r.errors.length ? <span style={{ color: 'var(--bad)' }}>{r.errors.join(' ')}</span>
              : r.warnings.length ? <span style={{ color: 'var(--warn)' }}>{r.warnings.join(' ')}</span>
                : <span className="badge good">Ready</span>}
      </td>
    </tr>
  )
}
