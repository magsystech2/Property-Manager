import { useState } from 'react'
import { useStore } from '../store'
import { AppConfig } from '../config'
import { Field, Icon } from '../ui/common'

export function Onboarding() {
  const app = useStore()
  return (
    <div className="center-page">
      <div className="welcome">
        <div className="logo"><Icon name="home" size={30} /></div>
        {app.phase === 'welcome' && <Welcome />}
        {app.phase === 'signIn' && <SignIn />}
        {app.phase === 'chooseWorkspace' && <ChooseWorkspace />}
      </div>
    </div>
  )
}

function Welcome() {
  const app = useStore()
  const [setup, setSetup] = useState(false)
  return (
    <>
      <div>
        <h1>Project Ledger</h1>
        <div className="muted">Track what each property costs against its budget, who paid what, which bills are due, and where every receipt is.</div>
      </div>
      {setup ? <LiveSetup onDone={() => { setSetup(false); app.chooseLive() }} onCancel={() => setSetup(false)} /> : (
        <>
          <button className="btn primary big" onClick={() => (AppConfig.isLiveConfigured ? app.chooseLive() : setSetup(true))}>Sign in to our LLC</button>
          <button className="btn big" onClick={() => app.startDemo()}>Try the demo</button>
          <div className="note">The demo uses sample data for three partners and two properties, kept in this browser only. Nothing is sent anywhere.</div>
          <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => setSetup(true)}>Live sync settings</button>
        </>
      )}
    </>
  )
}

export function LiveSetup({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState(AppConfig.supabaseUrl)
  const [key, setKey] = useState(AppConfig.supabaseAnonKey)
  const fromServer = !!AppConfig.serverUrl
  let valid = false
  try { valid = !!new URL(url).host && key.length > 20 } catch { valid = false }
  return (
    <div className="panel">
      <h3>Live sync settings</h3>
      <div className="note">
        {fromServer ? 'This server already has the LLC’s Supabase project set. Change it here only to use a different one in this browser.'
          : 'From your Supabase dashboard: Project Settings → API. Use the Project URL and the anon public key. The same values the iPhone app uses.'}
      </div>
      <Field label="Project URL"><input value={url} placeholder="https://abcdefgh.supabase.co" onChange={(e) => setUrl(e.target.value)} /></Field>
      <Field label="Anon public key"><input value={key} onChange={(e) => setKey(e.target.value)} /></Field>
      <div className="row">
        <button className="btn" onClick={onCancel}>Cancel</button>
        {fromServer && <button className="btn" onClick={() => { AppConfig.supabaseUrl = ''; AppConfig.supabaseAnonKey = ''; onDone() }}>Use server settings</button>}
        <span className="spacer" />
        <button className="btn primary" disabled={!valid} onClick={() => { AppConfig.supabaseUrl = url; AppConfig.supabaseAnonKey = key; onDone() }}>Save</button>
      </div>
    </div>
  )
}

function SignIn() {
  const app = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [create, setCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault()
      setBusy(true)
      await app.signIn(email.trim(), password, create)
      setBusy(false)
    }}>
      <div>
        <h1>{create ? 'Create account' : 'Sign in'}</h1>
        <div className="muted">{create ? 'Use the email your LLC owner invited, or any email if you are setting up the LLC.' : 'Same email and password as the iPhone app.'}</div>
      </div>
      <Field label="Email"><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password"><input type="password" autoComplete={create ? 'new-password' : 'current-password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : create ? 'Create account' : 'Sign in'}</button>
      <div className="row">
        <button type="button" className="btn link" onClick={() => setCreate(!create)}>{create ? 'I already have an account' : 'Create account'}</button>
        <span className="spacer" />
        <button type="button" className="btn link" onClick={() => app.signOut()}>Back</button>
      </div>
    </form>
  )
}

function ChooseWorkspace() {
  const app = useStore()
  const [name, setName] = useState('')
  const [llc, setLlc] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (f: () => Promise<void>) => { setBusy(true); await f(); setBusy(false) }
  return (
    <>
      <div>
        <h1>Your LLC</h1>
        <div className="muted">Signed in as {app.backend?.userEmail()}</div>
      </div>
      {app.workspaces.length > 0 && (
        <div className="card list">
          {app.workspaces.map((w) => (
            <button key={w.id} className="item" onClick={() => act(() => app.openWorkspace(w.id))}>
              <span className="grow title">{w.name}</span><Icon name="chevron" />
            </button>
          ))}
        </div>
      )}
      <Field label="Your name (shown to partners)"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Madhan" /></Field>
      <div className="panel">
        <h3>Join my invitation</h3>
        <div className="note">If your LLC owner invited this email, join their workspace.</div>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => act(() => app.joinInvites(name.trim()))}>Join my invitation</button>
      </div>
      <div className="panel">
        <h3>Create LLC workspace</h3>
        <div className="note">For the first partner only. You become the owner and the default budget categories are added.</div>
        <Field label="LLC name"><input value={llc} onChange={(e) => setLlc(e.target.value)} placeholder="e.g. Oak Street Homes LLC" /></Field>
        <button className="btn" disabled={busy || !name.trim() || !llc.trim()} onClick={() => act(() => app.createWorkspace(llc.trim(), name.trim()))}>Create workspace</button>
      </div>
      <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => app.signOut()}>Sign out</button>
    </>
  )
}
