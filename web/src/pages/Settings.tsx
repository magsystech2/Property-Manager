import { useState } from 'react'
import { useStore } from '../store'
import { uuid } from '../core/money'
import { AppConfig } from '../config'
import type { BudgetCategory } from '../core/models'
import { KV, PageHead, Section } from '../ui/common'
import { LiveSetup } from './Onboarding'

export function SettingsPage() {
  const app = useStore()
  const s = app.ledger.s
  const me = app.myMember
  const [myName, setMyName] = useState(me?.display_name ?? '')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('partner')
  const [newCat, setNewCat] = useState('')
  const [liveSetup, setLiveSetup] = useState(false)
  return (
    <div className="stack">
      <PageHead title="Settings" />
      <div className="grid2">
        <div className="stack">
          <Section title="LLC">
            <KV k="Workspace">{s.workspace.name}</KV>
            <KV k="Mode">{app.isDemo ? 'Demo (this browser only)' : 'Live sync'}</KV>
            {!app.isDemo && <KV k="Signed in as">{app.backend?.userEmail()}</KV>}
            {app.lastSynced && <KV k="Last updated">{app.lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</KV>}
            {me && (
              <div className="kv" style={{ gap: 8 }}>
                <input value={myName} onChange={(e) => setMyName(e.target.value)} aria-label="Your name" />
                <button className="btn" disabled={!myName.trim() || myName === me.display_name} onClick={() => app.saveMember({ ...me, display_name: myName.trim() })}>Save name</button>
              </div>
            )}
          </Section>

          <Section title="Approvals" footer="When on, new bills, change orders and reimbursement requests wait until a different partner approves them. Only an owner can change this.">
            <label className="kv check">
              <input type="checkbox" checked={s.workspace.require_review} disabled={!app.isOwner}
                onChange={(e) => app.saveWorkspace({ ...s.workspace, require_review: e.target.checked })} />
              <span>Require a second partner to approve</span>
            </label>
          </Section>

          <Section title="Members">
            {s.members.map((m) => (
              <div key={m.user_id} className="item">
                <div className="grow">
                  <div className="title">{m.display_name}{m.user_id === app.me ? ' (me)' : ''}</div>
                  {m.email && <div className="subtitle">{m.email}</div>}
                </div>
                {app.isOwner && m.user_id !== app.me ? (
                  <select style={{ width: 'auto' }} value={m.role} onChange={(e) => app.saveMember({ ...m, role: e.target.value })} aria-label={`Role for ${m.display_name}`}>
                    <option value="owner">Owner</option><option value="partner">Partner</option>
                  </select>
                ) : <span className="muted">{m.role === 'owner' ? 'Owner' : 'Partner'}</span>}
              </div>
            ))}
          </Section>

          {app.isOwner && (
            <Section title="Invite partners" footer="The partner creates an account with this exact email (on the web or the iPhone app) and chooses “Join my invitation”. Only members of this LLC can see its records and documents.">
              {s.invites.filter((i) => !i.accepted_at).map((i) => (
                <div key={i.id} className="item">
                  <div className="grow"><div className="title">{i.email}</div><div className="subtitle">Invited as {i.role}</div></div>
                  <button className="btn link danger" onClick={() => app.cancelInvite(i)}>Cancel</button>
                </div>
              ))}
              <form className="kv wrap" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await app.invite(email.trim(), role)) setEmail('') }}>
                <input type="email" placeholder="partner@email.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
                <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}><option value="partner">Partner</option><option value="owner">Owner</option></select>
                <button className="btn primary" disabled={!email.includes('@')}>Invite</button>
              </form>
            </Section>
          )}
        </div>

        <div className="stack">
          <Section title="Budget categories" footer="Shared by all projects. Hidden categories keep their history but aren't offered for new entries.">
            {[...s.categories].sort((a, b) => a.sort_order - b.sort_order).map((c) => <CategoryRow key={c.id} c={c} />)}
            <form className="kv" style={{ gap: 8 }} onSubmit={(e) => {
              e.preventDefault()
              const name = newCat.trim()
              if (!name) return
              app.saveCategory({ id: uuid(), workspace_id: s.workspace.id, name, sort_order: Math.max(0, ...s.categories.map((x) => x.sort_order)) + 1, archived: false })
              setNewCat('')
            }}>
              <input placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <button className="btn" disabled={!newCat.trim()}>Add</button>
            </form>
          </Section>

          <Section title={app.isDemo ? 'Demo' : 'Account'}>
            {liveSetup ? <div style={{ padding: 12 }}><LiveSetup onCancel={() => setLiveSetup(false)} onDone={async () => { setLiveSetup(false); await app.signOut(); app.chooseLive() }} /></div> : (
              <>
                {app.isDemo && <button className="item" onClick={() => app.resetDemo()}><span className="grow bad">Reset sample data</span></button>}
                <button className="item" onClick={() => setLiveSetup(true)}><span className="grow">{app.isDemo ? 'Leave demo and connect live sync' : 'Live sync settings'}</span></button>
                <button className="item" onClick={() => { if (confirm(app.isDemo ? 'Exit demo?' : 'Sign out?')) app.signOut() }}><span className="grow bad">{app.isDemo ? 'Exit demo' : 'Sign out'}</span></button>
              </>
            )}
          </Section>
          {!app.isDemo && <div className="note">Supabase project: {AppConfig.supabaseUrl}</div>}
        </div>
      </div>
    </div>
  )
}

function CategoryRow({ c }: { c: BudgetCategory }) {
  const app = useStore()
  const [name, setName] = useState(c.name)
  return (
    <div className="kv" style={{ gap: 8 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ opacity: c.archived ? 0.55 : 1 }} aria-label="Category name"
        onBlur={() => { if (name.trim() && name !== c.name) app.saveCategory({ ...c, name: name.trim() }) }} />
      <button className="btn" onClick={() => app.saveCategory({ ...c, archived: !c.archived })}>{c.archived ? 'Show' : 'Hide'}</button>
    </div>
  )
}
