import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useStore, store } from './store'
import { newDraft } from './drafts'
import { Icon } from './ui/common'
import { Onboarding } from './pages/Onboarding'
import { HomePage } from './pages/Home'
import { ProjectsPage, ProjectDetailPage } from './pages/Projects'
import { ActivityPage, RecordsPage } from './pages/Activity'
import { PartnersPage, PartnerDetailPage } from './pages/Partners'
import { VendorsPage, VendorDetailPage } from './pages/Vendors'
import { EntryDetailPage } from './pages/EntryDetail'
import { ExportPage } from './pages/Export'
import { SettingsPage } from './pages/Settings'
import { DraftsPage } from './pages/Drafts'
import { ImportPage } from './pages/Import'
import { InboxPage } from './pages/Inbox'
import { StatementsPage } from './pages/Statements'
import { ReviewPage, MissingPage } from './pages/Review'
import { CashPage } from './pages/Cash'
import { RecurringPage, ReportsPage, dueTemplates } from './pages/Reports'
import { ModalHost } from './forms/ModalHost'
import { IssuesPage } from './pages/Issues'

export default function App() {
  const app = useStore()
  useEffect(() => { store.launch() }, [])
  return (
    <BrowserRouter>
      {app.phase === 'ready' ? <Shell /> : app.phase === 'launching' ? <div className="center-page muted">Loading…</div> : <Onboarding />}
      {app.toast && <div className="toast" role="status">{app.toast}</div>}
      {app.error && (
        <div className="error-banner" role="alert">
          <Icon name="alert" /><span style={{ flex: 1 }}>{app.error}</span>
          {app.phase === 'ready' && <button className="btn link" onClick={() => { const err = app.error; app.error = null; app.open({ type: 'report', error: err }) }}>Report</button>}
          <button className="btn link" onClick={() => { app.error = null; app.emit() }}>Dismiss</button>
        </div>
      )}
    </BrowserRouter>
  )
}

/** On a phone this opens the camera straight away; on a computer it opens the photo picker. */
function scanReceipt(projectId: string | null) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,application/pdf'
  input.setAttribute('capture', 'environment')
  input.onchange = () => {
    const files = Array.from(input.files ?? [])
    if (files.length) store.open({ type: 'transaction', draft: newDraft('receipt', projectId), files })
  }
  input.click()
}

/** The project whose page is open, so new entries start on that project (still changeable in the form). */
function currentProjectId(pathname: string): string | null {
  const m = /^\/projects\/([^/]+)/.exec(pathname)
  return m && store.ledger.project(m[1]) ? m[1] : null
}

const addActions: { label: string; desc: string; icon: string; open: (projectId: string | null) => void; to?: string }[] = [
  { label: 'Scan receipt', desc: 'Take a photo, then fill in the details', icon: 'camera', open: (pid) => scanReceipt(pid) },
  { label: 'Add expense', desc: 'A receipt, already paid', icon: 'receipt', open: (pid) => store.open({ type: 'transaction', draft: newDraft('receipt', pid) }) },
  { label: 'Add bill', desc: 'An invoice still owed', icon: 'doc', open: (pid) => store.open({ type: 'transaction', draft: newDraft('bill', pid) }) },
  { label: 'Record payment', desc: 'Money paid on a bill', icon: 'cash', open: () => store.open({ type: 'payment' }) },
  { label: 'Add to inbox', desc: 'Drop a receipt or invoice to file later', icon: 'tray', open: () => {}, to: '/inbox' },
  { label: 'Say it', desc: 'Speak or type a sentence', icon: 'mic', open: () => store.open({ type: 'voice' }) },
  { label: 'Add contribution', desc: 'Capital a partner put in', icon: 'bank', open: (pid) => store.open({ type: 'contribution', partnerId: store.me, projectId: pid }) },
  { label: 'Reimburse a partner', desc: 'Pay back personal spending', icon: 'users', open: () => store.open({ type: 'reimbursement' }) },
  { label: 'Add commitment', desc: 'A contract or agreed quote', icon: 'sign', open: (pid) => store.open({ type: 'commitment', projectId: pid }) },
  { label: 'Recurring cost', desc: 'Insurance, utilities, dumpster: due ones and templates', icon: 'repeat', open: () => {}, to: '/recurring' },
  { label: 'Bulk upload', desc: 'Many receipts and bills from a spreadsheet', icon: 'tray', open: () => {}, to: '/import' },
  { label: 'Report an issue', desc: 'Something wrong with a record or the app', icon: 'alert', open: () => store.open({ type: 'report' }) },
]

function AddMenu({ mobile, onClose }: { mobile?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const loc = useLocation()
  const go = useNavigate()
  const pid = currentProjectId(loc.pathname)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    setTimeout(() => window.addEventListener('mousedown', h))
    return () => window.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div ref={ref} className={`card menu-list ${mobile ? 'mobile-add-menu' : 'add-menu'}`} role="menu">
      {pid && <div className="small muted" style={{ padding: '6px 12px' }}>For {store.ledger.project(pid)?.nickname}</div>}
      {addActions.map((a) => (
        <button key={a.label} role="menuitem" onClick={() => { if (a.to) go(a.to); else a.open(pid); onClose() }}>
          <Icon name={a.icon} /><span><div style={{ fontWeight: 600 }}>{a.label}</div><div className="desc">{a.desc}</div></span>
        </button>
      ))}
    </div>
  )
}

function Shell() {
  const app = useStore()
  const [menu, setMenu] = useState<'side' | 'tab' | null>(null)
  const loc = useLocation()
  // A new screen starts clean: scroll to top and drop an error banner left from the last one.
  useEffect(() => { window.scrollTo(0, 0); if (store.error) { store.error = null; store.emit() } }, [loc.pathname])
  const nav = [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/projects', label: 'Projects', icon: 'folder' },
    { to: '/activity', label: 'Activity', icon: 'list' },
    { to: '/partners', label: 'Partners', icon: 'users' },
  ]
  const demo = app.demo
  const inboxCount = app.ledger.s.inbox_items.filter((i) => i.status === 'new').length
  const unmatchedCount = app.ledger.s.statement_lines.filter((x) => x.status === 'unmatched').length
  const dueCount = dueTemplates(app.ledger.s.entry_templates, app.ledger.today).length
  const issueCount = (app.ledger.s.issue_reports ?? []).filter((r) => r.status === 'open').length
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Project Ledger</div>
        <div className="brand-sub">{app.workspace?.name}</div>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => setMenu(menu ? null : 'side')}><Icon name="plus" />Add</button>
          {menu === 'side' && <AddMenu onClose={() => setMenu(null)} />}
        </div>
        {nav.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className="nav-link"><Icon name={n.icon} />{n.label}</NavLink>)}
        <NavLink to="/review" className="nav-link"><Icon name="check" />Weekly review</NavLink>
        <NavLink to="/inbox" className="nav-link"><Icon name="tray" />Inbox{inboxCount ? <span className="nav-count">{inboxCount}</span> : null}</NavLink>
        <NavLink to="/statements" className="nav-link"><Icon name="bank" />Statements{unmatchedCount ? <span className="nav-count">{unmatchedCount}</span> : null}</NavLink>
        <NavLink to="/cash" className="nav-link"><Icon name="cash" />Cash needed</NavLink>
        <NavLink to="/reports" className="nav-link"><Icon name="chart" />Reports</NavLink>
        <NavLink to="/recurring" className="nav-link"><Icon name="repeat" />Recurring{dueCount ? <span className="nav-count">{dueCount}</span> : null}</NavLink>
        <NavLink to="/vendors" className="nav-link"><Icon name="store" />Vendors</NavLink>
        <NavLink to="/import" className="nav-link"><Icon name="list" />Bulk upload</NavLink>
        <NavLink to="/export" className="nav-link"><Icon name="download" />Export CSV</NavLink>
        <NavLink to="/issues" className="nav-link"><Icon name="alert" />Issues{issueCount ? <span className="nav-count">{issueCount}</span> : null}</NavLink>
        {app.draftList.length > 0 && <NavLink to="/drafts" className="nav-link"><Icon name="tray" />Drafts ({app.draftList.length})</NavLink>}
        <span className="spacer" />
        <NavLink to="/settings" className="nav-link"><Icon name="settings" />Settings</NavLink>
        <div className="small muted" style={{ padding: '6px 10px' }}>
          {app.isDemo ? 'Demo, this browser only' : `Signed in as ${app.myMember?.display_name ?? app.backend?.userEmail() ?? ''}`}
        </div>
      </aside>
      <div className="main">
        {demo && (
          <div className="demo-bar">
            <strong>DEMO MODE</strong>
            <span>Sample data in this browser only. Acting as</span>
            <select value={app.me ?? ''} onChange={(e) => app.actAs(e.target.value)} aria-label="Act as partner">
              {app.ledger.s.members.filter((m) => !m.access_revoked_at).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
            <button onClick={() => app.resetDemo()}>Reset sample data</button>
            <button onClick={() => app.signOut()}>Exit demo</button>
          </div>
        )}
        <main className="content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/records" element={<RecordsPage />} />
            <Route path="/records/:kind/:id" element={<EntryDetailPage />} />
            <Route path="/partners" element={<PartnersPage />} />
            <Route path="/partners/:id" element={<PartnerDetailPage />} />
            <Route path="/vendors" element={<VendorsPage />} />
            <Route path="/vendors/:id" element={<VendorDetailPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/drafts" element={<DraftsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/statements" element={<StatementsPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/missing" element={<MissingPage />} />
            <Route path="/cash" element={<CashPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/recurring" element={<RecurringPage />} />
            <Route path="/issues" element={<IssuesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end><Icon name="home" />Home</NavLink>
        <NavLink to="/projects"><Icon name="folder" />Projects</NavLink>
        <button className="add-tab" onClick={() => setMenu(menu ? null : 'tab')} aria-label="Add"><span className="circle"><Icon name="plus" size={22} /></span>Add</button>
        <NavLink to="/activity"><Icon name="list" />Activity</NavLink>
        <NavLink to="/partners"><Icon name="users" />Partners</NavLink>
      </nav>
      {menu === 'tab' && <AddMenu mobile onClose={() => setMenu(null)} />}
      <ModalHost />
    </div>
  )
}
