import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { issueCategoryLabel, kindLabel, type EntryRef, type IssueCategory } from '../core/models'
import { Money } from '../core/money'
import { Field, Icon, ModalShell } from '../ui/common'

const RECENT_ERROR_MS = 15 * 60 * 1000

/** Report a problem with a record or the app. Opened from a record, the error banner, the Add menu or the Issues page. */
export function ReportForm({ refx, error, onClose }: { refx?: EntryRef | null; error?: string | null; onClose: () => void }) {
  const app = useStore()
  const entry = refx ? app.ledger.entry(refx) : undefined
  const recentError = error ?? (app.lastError && Date.now() - app.lastError.at < RECENT_ERROR_MS ? app.lastError.text : null)
  const [category, setCategory] = useState<IssueCategory>(recentError ? 'app_error' : refx ? 'wrong_amount' : 'other')
  const [note, setNote] = useState('')
  const [includeError, setIncludeError] = useState(!!recentError)
  const [shot, setShot] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!shot) { setPreview(null); return }
    const u = URL.createObjectURL(shot)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [shot])

  // Paste a screenshot straight from the clipboard (Cmd/Ctrl+V) anywhere in the form.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
      if (f) { e.preventDefault(); pick(f) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const pick = (f: File | undefined | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return app.showError(new Error('Choose an image for the screenshot.'))
    if (f.size > 20 * 1024 * 1024) return app.showError(new Error('That screenshot is larger than 20 MB.'))
    setShot(f.name ? f : new File([f], 'screenshot.png', { type: f.type }))
  }

  const save = async () => {
    setBusy(true)
    const ok = await app.reportIssue({ category, note, ref: refx ?? null, error: includeError ? recentError : null, screenshot: shot })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <ModalShell title="Report an issue" onClose={onClose} onSave={save} saveTitle="Send report" canSave={!!note.trim()} busy={busy}>
      <div className="panel">
        {entry && (
          <div className="card list" style={{ padding: '8px 12px' }}>
            <div className="small muted">About this {kindLabel[entry.ref.kind].toLowerCase()}</div>
            <div style={{ fontWeight: 600 }}>{entry.title} · {Money.format(entry.amount_cents)}</div>
          </div>
        )}
        <Field label="What kind of problem?">
          <select value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)}>
            {(Object.keys(issueCategoryLabel) as IssueCategory[]).map((c) => <option key={c} value={c}>{issueCategoryLabel[c]}</option>)}
          </select>
        </Field>
        <Field label="What’s wrong? (required)">
          <textarea value={note} autoFocus onChange={(e) => setNote(e.target.value)}
            placeholder={entry ? 'e.g. Should be $412.50, not $4,125.00' : 'e.g. Tried to void a receipt and got “No connection to the server”'} />
        </Field>
        {recentError && (
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={includeError} onChange={(e) => setIncludeError(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
            <span className="small">Include the error the app showed: <span className="muted">“{recentError}”</span></span>
          </label>
        )}
      </div>
      <div className="panel">
        <div className="row"><h2>Screenshot (optional)</h2></div>
        {preview ? (
          <div className="stack" style={{ gap: 8 }}>
            <img src={preview} alt="Screenshot to send" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--border)' }} />
            <button type="button" className="btn link danger" style={{ alignSelf: 'flex-start' }} onClick={() => setShot(null)}>Remove screenshot</button>
          </div>
        ) : (
          <div className="file-drop" onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]) }}>
            <Icon name="camera" /> Choose a screenshot, drop it here, or paste it (Ctrl/Cmd+V)
          </div>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <div className="note">Reports go to the shared Issues list for all partners. They never change any amounts. The page you were on and your browser are added to help whoever fixes it.</div>
    </ModalShell>
  )
}
