import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './common'

// ---------------------------------------------------------------------------
// The animated walk-throughs on the Help guides (like the PhotoCleaner app's). Each scene is a small
// drawing of the app's own screens on sample numbers, and plays one phase per step of its guide: a
// finger moves and taps, and the screen reacts. Drawn at 300×380 and scaled to fit.
// ---------------------------------------------------------------------------

/** Milliseconds per step. */
export const PHASE_MS = 4200
const W = 300
const H = 380
/** Desktop frame: a browser window with the sidebar to the left of the same 300×380 page area. */
const SW = 116
const CH = 22
/** True when the scene is drawn in the desktop layout (sidebar and top bar instead of phone header and tabs). */
const Desktop = createContext(false)
const useDesktop = () => useContext(Desktop)
const sideItems: [string, string][] = [['home', 'Overview'], ['folder', 'Projects'], ['list', 'Activity'], ['users', 'Partners'], ['', ''], ['check', 'Weekly review'], ['alert', 'Needs review'], ['tray', 'Receipt inbox'], ['bank', 'Statements'], ['cash', 'Cash plan'], ['chart', 'Reports'], ['', ''], ['tray', 'More tools'], ['help', 'Help']]
const sideY = (label: string) => { const i = sideItems.findIndex(([, l]) => l === label); return 84 + i * 20 + (i >= 4 ? -8 : 0) + (i >= 11 ? -8 : 0) }
/** Where to tap for a main page: the phone's bottom tab, or the desktop sidebar item. */
function useNavXY() {
  const d = useDesktop()
  const phone: Record<string, [number, number]> = { Overview: [30, 352], Projects: [90, 352], Add: [150, 351], Partners: [210, 352], 'More tools': [270, 352], Search: [262, 22] }
  return (name: string): [number, number] => {
    if (!d) return phone[name] ?? [150, 352]
    if (name === 'Add') return [-SW / 2, 52]
    if (name === 'Search') return [243, 22]
    return [-SW + 40, sideY(name) + 7]
  }
}
const navFor: Record<string, string> = { 'Project Ledger': 'Overview', Chamberlayne: 'Projects', Bill: 'Activity', Receipt: 'Activity', 'Add expense': 'Activity', Activity: 'Activity', Madhan: 'Partners', Partners: 'Partners' }

// Timing helpers: t is progress through the current step, 0…1.
/** Eased progress: 0 before `s`, 1 after `e`. */
const ramp = (t: number, s: number, e: number) => { if (t <= s) return 0; if (t >= e) return 1; const x = (t - s) / (e - s); return x * x * (3 - 2 * x) }
const lin = (t: number, s: number, e: number) => (t <= s ? 0 : t >= e ? 1 : (t - s) / (e - s))
/** 0, up to 1 and back to 0 between `s` and `e`. */
const bump = (t: number, s: number, e: number) => (t <= s || t >= e ? 0 : Math.sin(((t - s) / (e - s)) * Math.PI))
const mix = (a: number, b: number, x: number) => a + (b - a) * x
/** Text typed out between `a` and `b`. */
const typed = (s: string, t: number, a: number, b: number) => s.slice(0, Math.round(s.length * lin(t, a, b)))
const usd = (n: number, cents = false) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`
/** A number counting up between `a` and `b`. */
const up = (n: number, t: number, a: number, b: number) => Math.round(n * ramp(t, a, b))

// ---------------------------------------------------------------------------
// The finger
// ---------------------------------------------------------------------------
type Act = 'tap' | 'press' | 'release' | 'move'
/** [time, x, y, action]: the finger fades in just before the first stop and travels between them. */
type Stop = [number, number, number, Act?]

function Finger({ stops, t, fadeOut }: { stops: Stop[]; t: number; fadeOut?: number }) {
  if (!stops.length) return null
  const first = stops[0]
  const last = stops[stops.length - 1]
  const enter = first[0] - 0.12
  let x = last[1]
  let y = last[2]
  if (t <= first[0]) {
    const k = ramp(t, enter, first[0])
    x = mix(first[1] + 36, first[1], k)
    y = mix(first[2] + 48, first[2], k)
  } else {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i]
      const b = stops[i + 1]
      if (t <= b[0]) {
        const leave = (a[3] ?? 'tap') === 'tap' ? a[0] + 0.05 : a[0]
        const k = ramp(t, leave, b[0])
        x = mix(a[1], b[1], k)
        y = mix(a[2], b[2], k)
        break
      }
    }
  }
  const end = fadeOut ?? last[0] + 0.12
  const opacity = ramp(t, enter, enter + 0.05) * (1 - ramp(t, end, end + 0.05))
  let pressed = false
  let ripple = 0
  let holding = false
  for (const [s, , , act = 'tap'] of stops) {
    if (act === 'tap') {
      if (t >= s && t < s + 0.04) pressed = true
      if (t > s && t < s + 0.15) ripple = (t - s) / 0.15
    }
    if (act === 'press' && t >= s) holding = true
    if (act === 'release' && t >= s) holding = false
  }
  if (opacity <= 0) return null
  return (
    <div className="tut-finger" style={{ left: x, top: y, opacity }}>
      {ripple > 0 && <span className="tut-ripple" style={{ width: 28 + 34 * ripple, height: 28 + 34 * ripple, opacity: 0.9 * (1 - ripple) }} />}
      <span className="tut-dot" style={{ transform: `translate(-50%, -50%) scale(${pressed || holding ? 0.8 : 1})` }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawing pieces, placed in scene coordinates
// ---------------------------------------------------------------------------
type Box = { x: number; y: number; w?: number; h?: number; style?: CSSProperties; children?: ReactNode; className?: string }
function Abs({ x, y, w, h, style, children, className }: Box) {
  return <div className={className} style={{ position: 'absolute', left: x, top: y, width: w, height: h, ...style }}>{children}</div>
}
function Txt({ x, y, w = 270, size = 12, weight = 400, color = 'var(--text)', align = 'left', children, style }: { x: number; y: number; w?: number; size?: number; weight?: number; color?: string; align?: 'left' | 'right' | 'center'; children: ReactNode; style?: CSSProperties }) {
  return <Abs x={x} y={y} w={w} style={{ fontSize: size, fontWeight: weight, color, textAlign: align, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.25, ...style }}>{children}</Abs>
}
function Head({ title, back, search, nav, counts }: { title: string; back?: boolean; search?: boolean; nav?: string; counts?: Record<string, number> }) {
  const d = useDesktop()
  if (d) {
    const active = nav ?? navFor[title] ?? title
    return (
      <>
        <Abs x={-SW} y={0} w={SW} h={H} style={{ background: 'var(--brand)', color: 'var(--brand-text)' }}>
          <Abs x={10} y={10} w={18} h={18} style={{ borderRadius: 5, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="list" size={11} /></Abs>
          <Txt x={33} y={12} w={80} size={10} weight={700} color="var(--brand-text)">Project Ledger</Txt>
          <Abs x={8} y={40} w={SW - 16} h={24} style={{ borderRadius: 7, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}><Icon name="plus" size={11} />Add</Abs>
          {sideItems.map(([icon, label], i) => label ? (
            <Abs key={label} x={6} y={sideY(label)} w={SW - 12} h={18} style={{ borderRadius: 5, background: label === active ? 'var(--brand-active)' : undefined, color: label === active ? 'var(--brand-text)' : 'var(--brand-muted)', fontSize: 9.5, fontWeight: label === active ? 700 : 500, display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 5, whiteSpace: 'nowrap' }}>
              <Icon name={icon} size={10} />{label}
              {counts?.[label] ? <span style={{ marginLeft: 'auto', marginRight: 4, background: 'var(--warn)', color: '#fff', borderRadius: 7, fontSize: 8, fontWeight: 800, padding: '0 5px' }}>{counts[label]}</span> : null}
            </Abs>
          ) : <Abs key={i} x={10} y={sideY(sideItems[i + 1][1]) - 12} w={SW - 20} h={10} style={{ fontSize: 7, fontWeight: 700, letterSpacing: 0.6, color: 'var(--brand-muted)' }}>{i === 4 ? 'FINANCE' : ''}</Abs>)}
        </Abs>
        <Abs x={0} y={0} w={W} h={44} style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          <Txt x={12} y={15} w={172} size={11} color="var(--muted)">Workspace / <span style={{ color: 'var(--text)', fontWeight: 700 }}>{title === 'Project Ledger' ? active : title}</span></Txt>
          <Abs x={190} y={10} w={100} h={24} style={{ border: '1px solid var(--border)', borderRadius: 7, background: 'var(--surface)', color: 'var(--muted)', fontSize: 9.5, display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 7 }}><Icon name="search" size={10} />Search records</Abs>
        </Abs>
      </>
    )
  }
  return (
    <Abs x={0} y={0} w={W} h={44} style={{ background: 'var(--brand)', color: 'var(--brand-text)' }}>
      {back && <Abs x={10} y={13} style={{ color: 'var(--brand-muted)' }}><Icon name="back" size={16} /></Abs>}
      <Txt x={back ? 30 : 14} y={13} size={14} weight={700} color="var(--brand-text)">{title}</Txt>
      {search && <Abs x={254} y={13} style={{ color: 'var(--brand-text)' }}><Icon name="search" size={17} /></Abs>}
    </Abs>
  )
}
const tabX = [30, 90, 150, 210, 270]
function Tabs({ active }: { active: number }) {
  if (useDesktop()) return null
  const tabs: [string, string][] = [['home', 'Home'], ['folder', 'Projects'], ['plus', 'Add'], ['users', 'Partners'], ['tray', 'More']]
  return (
    <Abs x={0} y={334} w={W} h={46} style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
      {tabs.map(([icon, label], i) => i === 2
        ? <Abs key={label} x={tabX[i] - 17} y={-10} w={34} h={34} style={{ borderRadius: 17, background: 'var(--accent)', color: 'var(--accent-text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={18} /></Abs>
        : <Abs key={label} x={tabX[i] - 28} y={6} w={56} style={{ textAlign: 'center', color: i === active ? 'var(--accent)' : 'var(--muted)', fontSize: 9, fontWeight: i === active ? 700 : 500 }}><Icon name={icon} size={16} /><div>{label}</div></Abs>)}
    </Abs>
  )
}
function Card({ x = 10, y, w = 280, h, children, style, hl }: { x?: number; y: number; w?: number; h: number; children?: ReactNode; style?: CSSProperties; hl?: number }) {
  return <Abs x={x} y={y} w={w} h={h} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: hl ? `0 0 0 ${2 * hl}px var(--tut-tint)` : undefined, ...style }}>{children}</Abs>
}
/** A list row: icon, title, subtitle and a value on the right. */
function Row({ y, icon, title, sub, right, rightColor, hl, tone, h = 40, style }: { y: number; icon?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; rightColor?: string; hl?: number; tone?: 'warn' | 'bad' | 'good'; h?: number; style?: CSSProperties }) {
  const tones = { warn: ['var(--warn-soft)', 'var(--warn)'], bad: ['var(--bad-soft)', 'var(--bad)'], good: ['var(--good-soft)', 'var(--good)'] }
  const [bg, fg] = tone ? tones[tone] : ['var(--surface-2)', 'var(--muted)']
  const tx = icon ? 42 : 10
  return (
    <Card y={y} h={h} hl={hl} style={style}>
      {icon && <Abs x={8} y={(h - 26) / 2} w={26} h={26} style={{ borderRadius: 7, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={14} /></Abs>}
      <Txt x={tx} y={sub ? 6 : (h - 15) / 2} w={right ? 150 : 230} size={12} weight={600}>{title}</Txt>
      {sub && <Txt x={tx} y={21} w={right ? 150 : 230} size={10} color="var(--muted)">{sub}</Txt>}
      {right != null && <Txt x={150} y={(h - 15) / 2} w={120} size={12} weight={700} align="right" color={rightColor ?? 'var(--text)'} style={{ fontVariantNumeric: 'tabular-nums' }}>{right}</Txt>}
    </Card>
  )
}
/** A form field; `focus` shows a blinking caret. */
function Field({ x = 14, y, w = 272, label, value, focus, placeholder }: { x?: number; y: number; w?: number; label: string; value: string; focus?: boolean; placeholder?: string }) {
  return (
    <>
      <Txt x={x} y={y} w={w} size={10} weight={600} color="var(--muted)">{label}</Txt>
      <Abs x={x} y={y + 14} w={w} h={26} style={{ background: 'var(--surface)', border: `1.5px solid ${focus ? 'var(--tut-tint)' : 'var(--border)'}`, borderRadius: 7 }}>
        <Txt x={8} y={5} w={w - 16} size={12} color={value ? 'var(--text)' : 'var(--muted)'}>{value || placeholder}{focus && <span className="tut-caret" />}</Txt>
      </Abs>
    </>
  )
}
function Btn({ x, y, w, h = 28, label, primary, pressed, icon, danger }: { x: number; y: number; w: number; h?: number; label: string; primary?: boolean; pressed?: boolean; icon?: string; danger?: boolean }) {
  return (
    <Abs x={x} y={y} w={w} h={h} style={{ borderRadius: 8, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
      background: primary ? 'var(--accent)' : 'var(--surface)', color: primary ? 'var(--accent-text)' : danger ? 'var(--bad)' : 'var(--text)',
      border: primary ? 'none' : '1px solid var(--border)', transform: pressed ? 'scale(0.94)' : undefined }}>
      {icon && <Icon name={icon} size={12} />}{label}
    </Abs>
  )
}
function Badge({ x, y, label, tone = 'neutral' }: { x: number; y: number; label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const c = { neutral: ['var(--surface-2)', 'var(--muted)'], good: ['var(--good-soft)', 'var(--good)'], warn: ['var(--warn-soft)', 'var(--warn)'], bad: ['var(--bad-soft)', 'var(--bad)'] }[tone]
  return <Abs x={x} y={y} style={{ background: c[0], color: c[1], fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 9, whiteSpace: 'nowrap' }}>{label}</Abs>
}
/** A sheet sliding up from the bottom; `show` 0…1. */
function Sheet({ show, h, title, children }: { show: number; h: number; title?: string; children: ReactNode }) {
  const d = useDesktop()
  if (show <= 0) return null
  return (
    <>
      <Abs x={d ? -SW : 0} y={0} w={d ? W + SW : W} h={H} style={{ background: 'rgba(0,0,0,0.35)', opacity: show, zIndex: 3 }} />
      <Abs x={0} y={d ? H - h - 6 + 14 * (1 - show) : H - h * show} w={W} h={h} style={{ background: 'var(--bg)', borderRadius: d ? 12 : '16px 16px 0 0', boxShadow: '0 -6px 20px rgba(0,0,0,0.18)', zIndex: 4, opacity: d ? show : 1 }}>
        {!d && <Abs x={135} y={6} w={30} h={4} style={{ borderRadius: 2, background: 'var(--border)' }} />}
        {title && <Txt x={14} y={16} size={13} weight={700}>{title}</Txt>}
        {children}
      </Abs>
    </>
  )
}
function Toast({ show, text }: { show: number; text: string }) {
  if (show <= 0) return null
  return <Abs x={40} y={290 + 10 * (1 - show)} w={220} h={28} style={{ opacity: show, background: 'var(--ink)', color: 'var(--bg)', borderRadius: 14, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><Icon name="check" size={12} />{text}</Abs>
}
function Fade({ o, children, dy = 0 }: { o: number; children: ReactNode; dy?: number }) {
  if (o <= 0) return null
  return <div style={{ position: 'absolute', inset: 0, opacity: o, transform: dy ? `translateY(${dy * (1 - o)}px)` : undefined }}>{children}</div>
}
function Bar({ x, y, w, h = 6, frac, color = 'var(--tut-tint)' }: { x: number; y: number; w: number; h?: number; frac: number; color?: string }) {
  return <Abs x={x} y={y} w={w} h={h} style={{ background: 'var(--surface-2)', borderRadius: h / 2, overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, height: '100%', background: color, borderRadius: h / 2 }} /></Abs>
}
function Segs({ y, items, active, x = 10, w = 280 }: { y: number; items: string[]; active: number; x?: number; w?: number }) {
  const cw = w / items.length
  return (
    <Abs x={x} y={y} w={w} h={26} style={{ background: 'var(--surface-2)', borderRadius: 8 }}>
      {items.map((s, i) => <Abs key={s} x={i * cw + 2} y={2} w={cw - 4} h={22} style={{ borderRadius: 6, background: i === active ? 'var(--surface)' : undefined, boxShadow: i === active ? '0 1px 3px rgba(0,0,0,0.12)' : undefined, fontSize: 10, fontWeight: i === active ? 700 : 500, color: i === active ? 'var(--text)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{s}</Abs>)}
    </Abs>
  )
}
const segX = (i: number, n: number, x = 10, w = 280) => x + (i + 0.5) * (w / n)

type SP = { p: number; t: number }

// ---------------------------------------------------------------------------
// Scenes, one per guide
// ---------------------------------------------------------------------------

function HomeScreen({ hero = 42300 }: { hero?: number }) {
  return (
    <>
      <Txt x={14} y={54} size={15} weight={700}>Good morning, Madhan</Txt>
      <Abs x={10} y={78} w={280} h={70} style={{ background: 'var(--hero)', borderRadius: 12 }}>
        <Txt x={14} y={12} size={10} color="var(--hero-soft)" weight={600}>What I’ve put in</Txt>
        <Txt x={14} y={28} size={24} weight={800} color="var(--hero-text)" style={{ fontVariantNumeric: 'tabular-nums' }}>{usd(hero)}</Txt>
      </Abs>
      <Card x={10} y={156} w={136} h={50}><Txt x={10} y={8} size={9} color="var(--muted)">LLC owes me</Txt><Txt x={10} y={22} size={15} weight={700}>$1,250</Txt></Card>
      <Card x={154} y={156} w={136} h={50}><Txt x={10} y={8} size={9} color="var(--muted)">Expected back</Txt><Txt x={10} y={22} size={15} weight={700} color="var(--good)">$58,900</Txt></Card>
      <Txt x={14} y={216} size={11} weight={700}>Needs attention</Txt>
      <Row y={234} icon="alert" tone="warn" title="2 entries need review" sub="Is this Chamberlayne or Willway?" right="Review →" rightColor="var(--warn)" />
      <Row y={280} icon="doc" tone="bad" title="Overdue bill" sub="ABC Plumbing" right="$8,200" />
    </>
  )
}
function ProjectList({ hl = 0 }: { hl?: number }) {
  return (
    <>
      <Txt x={14} y={54} size={15} weight={700}>Projects</Txt>
      {[['Chamberlayne', 182400, 210000], ['Willway', 96500, 100000], ['Oak Street', 41200, 150000]].map(([n, s, b], i) => (
        <Card key={n} y={80 + i * 62} h={54} hl={i === 0 ? hl : 0}>
          <Txt x={12} y={8} size={12} weight={700}>{n}</Txt>
          <Txt x={12} y={24} size={10} color="var(--muted)">{usd(s as number)} of {usd(b as number)}</Txt>
          <Bar x={12} y={40} w={256} frac={(s as number) / (b as number)} />
        </Card>
      ))}
    </>
  )
}
const partners = [
  { name: 'Madhan', into: 60000, personal: 8400, back: 4400 },
  { name: 'Kiran', into: 55000, personal: 2100, back: 0 },
  { name: 'Prabhakar', into: 50000, personal: 12600, back: 3000 },
]
const putIn = (x: typeof partners[number]) => x.into + x.personal - x.back
const share = Math.round(partners.reduce((a, x) => a + putIn(x), 0) / 3)
function PartnerTable() {
  return (
    <>
      <Txt x={14} y={54} size={15} weight={700}>Who paid what</Txt>
      <Card y={80} h={136}>
        <Txt x={12} y={10} size={9} weight={700} color="var(--muted)">PARTNER</Txt>
        <Txt x={120} y={10} w={70} size={9} weight={700} color="var(--muted)" align="right">PUT IN</Txt>
        <Txt x={196} y={10} w={72} size={9} weight={700} color="var(--muted)" align="right">VS SHARE</Txt>
        {partners.map((x, i) => {
          const d = putIn(x) - share
          return (
            <div key={x.name}>
              <Abs x={0} y={30 + i * 34} w={278} h={1} style={{ background: 'var(--border)' }} />
              <Txt x={12} y={40 + i * 34} size={12} weight={600}>{x.name}</Txt>
              <Txt x={120} y={40 + i * 34} w={70} size={12} align="right">{usd(putIn(x))}</Txt>
              <Txt x={196} y={40 + i * 34} w={72} size={12} weight={700} align="right" color={d < 0 ? 'var(--bad)' : 'var(--good)'}>{d > 0 ? '+' : ''}{usd(d)}</Txt>
            </div>
          )
        })}
      </Card>
      <Txt x={14} y={228} size={11} weight={700}>Borrowed money</Txt>
      <Row y={246} icon="bank" title="Prabhakar · Pavi" sub="$50,000 at 12%" right="$58,500" />
    </>
  )
}
const records: [string, string, number, string][] = [
  ['Home Depot', 'Chamberlayne · Plumbing', -412.5, 'receipt'],
  ['ABC Plumbing', 'Chamberlayne · Bill', -8200, 'doc'],
  ['Kiran', 'Contribution', 25000, 'bank'],
  ['Lowe’s', 'Willway · Tile', -412, 'receipt'],
  ['City Water', 'Oak Street · Utilities', -96.4, 'receipt'],
]
function ActivityList({ query = '', focus, list = records }: { query?: string; focus?: boolean; list?: typeof records }) {
  return (
    <>
      <Abs x={10} y={52} w={280} h={30} style={{ background: 'var(--surface)', border: `1.5px solid ${focus ? 'var(--tut-tint)' : 'var(--border)'}`, borderRadius: 15, color: 'var(--muted)' }}>
        <Abs x={10} y={7}><Icon name="search" size={14} /></Abs>
        <Txt x={30} y={7} w={240} size={12} color={query ? 'var(--text)' : 'var(--muted)'}>{query || 'Search records'}{focus && <span className="tut-caret" />}</Txt>
      </Abs>
      {list.map(([v, sub, amt, icon], i) => (
        <Row key={v + sub} y={92 + i * 46} icon={icon} title={v} sub={sub} right={`${amt > 0 ? '+' : ''}${usd(amt, true)}`} rightColor={amt > 0 ? 'var(--good)' : undefined} />
      ))}
    </>
  )
}
function MoreList({ hl = -1 }: { hl?: number }) {
  const rows: [string, string, string][] = [['check', 'Weekly review', 'Approve, match and file the week'], ['alert', 'Needs review', '2 to review'], ['tray', 'Receipt inbox', '1 waiting to be filed'], ['bank', 'Statements', '4 charges to match'], ['cash', 'Cash plan', 'What the LLC must cover'], ['help', 'Help', 'How to use the app']]
  return (
    <>
      <Txt x={14} y={54} size={15} weight={700}>More tools</Txt>
      {rows.map(([icon, title, sub], i) => <Row key={title} y={78 + i * 42} h={38} icon={icon} title={title} sub={sub} hl={i === hl ? 1 : 0} />)}
    </>
  )
}
function AddMenu({ show, hl = -1 }: { show: number; hl?: number }) {
  const items: [string, string, string][] = [['camera', 'Scan receipt', 'Take a photo, then fill in the details'], ['receipt', 'Add expense', 'A receipt, already paid'], ['mic', 'Say it', 'Speak or type a sentence'], ['doc', 'Add bill', 'An invoice still owed']]
  return (
    <Sheet show={show} h={226} title="Add">
      {items.map(([icon, title, sub], i) => <Row key={title} y={40 + i * 44} h={40} icon={icon} title={title} sub={sub} hl={i === hl ? 1 : 0} />)}
    </Sheet>
  )
}

function Basics({ p, t }: SP) {
  const tap = 0.3
  const s = p === 0 ? 1 : ramp(t, tap + 0.03, tap + 0.16)
  const screen = (i: number, o: number) => (
    <Fade key={i} o={o}>
      {i === 0 && <HomeScreen hero={p === 0 ? up(42300, t, 0.1, 0.55) : 42300} />}
      {i === 1 && <ProjectList />}
      {i === 2 && <PartnerTable />}
      {i === 3 && <ActivityList />}
      {i === 4 && <HomeScreen />}
      {i === 5 && <MoreList />}
    </Fade>
  )
  const tabFor = [0, 1, 3, 0, 0, 4]
  const nav = useNavXY()
  const navName = ['Overview', 'Projects', 'Partners', 'Activity', 'Overview', 'More tools']
  const targets: [number, number][] = [[150, 113], nav('Projects'), nav('Partners'), nav('Search'), nav('Add'), nav('More tools')]
  const shown = p === 0 ? 0 : s > 0.5 ? p : p - 1
  return (
    <>
      {p > 0 && p !== 5 && s < 1 && screen(p - 1, 1 - s)}
      {p === 5 && s < 1 && screen(4, 1 - s)}
      {screen(p, s)}
      <Head title="Project Ledger" search nav={navName[shown]} />
      <Tabs active={tabFor[shown]} />
      {p === 4 && <AddMenu show={ramp(t, tap + 0.03, tap + 0.2)} />}
      {p === 5 && <AddMenu show={1 - ramp(t, 0, 0.12)} />}
      {p === 0 ? <Finger t={t} stops={[[0.6, 150, 113, 'move']]} fadeOut={0.85} /> : <Finger t={t} stops={[[tap, ...targets[p]]]} />}
    </>
  )
}

function Projects({ p, t }: SP) {
  const tabs = ['Overview', 'Budget', 'Forecast', 'Sale', 'Files']
  const tap = 0.14
  const s = ramp(t, tap + 0.02, tap + 0.14)
  const edit = p === 1 && t > 0.55
  const newBudget = p === 1 && t > 0.82
  const body = (i: number) => {
    if (i === 0) return (
      <>
        <Card x={10} y={92} w={136} h={52}><Txt x={10} y={8} size={9} color="var(--muted)">Spent</Txt><Txt x={10} y={22} size={16} weight={700}>{usd(p === 0 ? up(182400, t, 0.2, 0.6) : 182400)}</Txt></Card>
        <Card x={154} y={92} w={136} h={52}><Txt x={10} y={8} size={9} color="var(--muted)">Unpaid bills</Txt><Txt x={10} y={22} size={16} weight={700} color="var(--bad)">$8,200</Txt></Card>
        <Card y={152} h={52}><Txt x={10} y={8} size={9} color="var(--muted)">Budget used</Txt><Txt x={10} y={22} size={12} weight={700}>{usd(182400)} of {usd(210000)}</Txt><Bar x={150} y={26} w={118} frac={0.87 * (p === 0 ? ramp(t, 0.2, 0.6) : 1)} /></Card>
        <Txt x={14} y={216} size={11} weight={700}>Who paid what on this project</Txt>
        {partners.map((x, k) => <Row key={x.name} y={234 + k * 32} h={28} title={x.name} right={usd(Math.round(putIn(x) * 0.6))} />)}
      </>
    )
    if (i === 1) {
      const cats: [string, number, number][] = [['Plumbing', 16800, newBudget ? 20000 : 18000], ['Roofing', 9500, 12000], ['Electrical', 7200, 7000], ['Flooring', 11300, 14000]]
      return cats.map(([n, sp, b], k) => (
        <Card key={n} y={92 + k * 56} h={50}>
          <Txt x={10} y={8} size={12} weight={600}>{n}</Txt>
          <Txt x={10} y={25} size={10} color={sp > b ? 'var(--bad)' : 'var(--muted)'}>{usd(sp)} spent{sp > b ? ' · over' : ''}</Txt>
          {k === 0 && edit && !newBudget
            ? <Abs x={186} y={10} w={84} h={24} style={{ border: '1.5px solid var(--tut-tint)', borderRadius: 6, background: 'var(--surface)' }}><Txt x={6} y={4} w={72} size={12} align="right">{typed('20,000', t, 0.6, 0.78)}<span className="tut-caret" /></Txt></Abs>
            : <Txt x={180} y={12} w={88} size={12} weight={700} align="right" style={{ textDecoration: k === 0 && p === 1 && t > 0.4 && !edit ? 'underline dotted' : undefined }}>{usd(b)}</Txt>}
          <Bar x={180} y={36} w={88} h={5} frac={(sp / b) * (p === 1 ? ramp(t, 0.2, 0.45) : 1)} color={sp > b ? 'var(--bad)' : undefined} />
        </Card>
      ))
    }
    if (i === 2) return (
      <>
        <Row y={92} title="Expected sale price" right="$340,000" />
        <Row y={138} title="Target sale date" right="Mar 2027" />
        <Card y={184} h={70} style={{ background: 'var(--good-soft)', border: 'none' }}><Txt x={12} y={12} size={10} color="var(--good)" weight={600}>Projected profit</Txt><Txt x={12} y={30} size={22} weight={800} color="var(--good)">{usd(p === 2 ? up(40000, t, 0.3, 0.7) : 40000)}</Txt></Card>
      </>
    )
    if (i === 3) return (
      <>
        <Row y={92} title="Net proceeds" right="$319,600" />
        <Txt x={14} y={144} size={11} weight={700}>Who gets what</Txt>
        {partners.map((x, k) => <Row key={x.name} y={162 + k * 44} title={x.name} sub="Capital back + equal share" right={usd(putIn(x) + 13333)} />)}
      </>
    )
    return (
      <>
        {[['receipt', 'receipt-0412.jpg'], ['doc', 'abc-invoice.pdf'], ['doc', 'closing.pdf'], ['camera', 'kitchen-before.jpg']].map(([ic, n], k) => (
          <Card key={n} x={10 + (k % 2) * 144} y={92 + Math.floor(k / 2) * 96} w={136} h={88}>
            <Abs x={52} y={16} style={{ color: 'var(--muted)' }}><Icon name={ic} size={30} /></Abs>
            <Txt x={8} y={64} w={120} size={10} align="center">{n}</Txt>
          </Card>
        ))}
      </>
    )
  }
  const cur = p
  const prev = p === 0 ? 0 : p - 1
  return (
    <>
      <Head title="Chamberlayne" back />
      <Segs y={54} items={tabs} active={s > 0.5 || p === 0 ? cur : prev} />
      {p > 0 && s < 1 && <Fade o={1 - s}>{body(prev)}</Fade>}
      <Fade o={p === 0 ? 1 : s}>{body(cur)}</Fade>
      <Finger t={t} stops={p === 1 ? [[tap, segX(1, 5), 67], [0.55, 240, 115]] : [[tap, segX(p, 5), 67]]} fadeOut={p === 1 ? 0.7 : undefined} />
    </>
  )
}

function AddExpense({ p, t }: SP) {
  const nav = useNavXY()
  const d = useDesktop()
  if (p === 0) {
    return (
      <>
        <HomeScreen />
        <Head title="Project Ledger" search />
        <Tabs active={0} />
        <AddMenu show={ramp(t, 0.22, 0.38)} hl={t > 0.7 ? 0 : -1} />
        <Finger t={t} stops={[[0.18, ...nav('Add')], [0.7, 150, (d ? H - 232 : H - 226) + 60]]} />
      </>
    )
  }
  if (p === 4) {
    const paid = t > 0.62
    return (
      <>
        <Head title="Bill" back />
        <Txt x={14} y={56} size={11} color="var(--muted)">ABC Plumbing · Chamberlayne</Txt>
        <Txt x={14} y={72} size={26} weight={800}>$8,200.00</Txt>
        <Badge x={200} y={80} label={paid ? 'Partly paid' : 'Unpaid'} tone={paid ? 'warn' : 'bad'} />
        <Row y={116} title="Paid so far" right={usd(paid ? up(4000, t, 0.62, 0.8) : 0)} />
        <Row y={162} title="Balance owed" right={usd(8200 - (paid ? up(4000, t, 0.62, 0.8) : 0))} rightColor="var(--bad)" />
        <Btn x={14} y={214} w={130} h={32} label="Record payment" icon="cash" primary pressed={t > 0.15 && t < 0.2} />
        <Sheet show={ramp(t, 0.2, 0.3) * (1 - ramp(t, 0.58, 0.66))} h={170} title="Record payment">
          <Field y={42} label="Amount" value={typed('$4,000.00', t, 0.32, 0.46)} focus={t < 0.5} />
          <Btn x={14} y={98} w={272} h={32} label="Save" primary pressed={t > 0.52 && t < 0.57} />
        </Sheet>
        <Finger t={t} stops={[[0.15, 78, 230], [0.52, 150, H - 170 + 114]]} />
      </>
    )
  }
  const amount = p === 1 ? typed('$412.50', t, 0.1, 0.3) : '$412.50'
  const vendor = p === 1 ? typed('Home Depot', t, 0.32, 0.5) : 'Home Depot'
  const project = p === 1 ? (t > 0.6 ? 'Chamberlayne' : '') : 'Chamberlayne'
  const cat = p === 1 ? (t > 0.75 ? 'Plumbing' : '') : 'Plumbing'
  const who = p >= 2 && (p > 2 || t > 0.3) ? 0 : 1
  const dup = p === 3 ? ramp(t, 0.35, 0.48) : 0
  return (
    <>
      <Head title="Add expense" back />
      <Abs x={226} y={52} w={60} h={74} style={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', opacity: p === 1 ? ramp(t, 0.05, 0.15) : 1, color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="receipt" size={28} /></Abs>
      <Field y={52} w={200} label="Amount" value={amount} focus={p === 1 && t < 0.31} />
      <Field y={96} w={200} label="Vendor" value={vendor} focus={p === 1 && t > 0.31 && t < 0.52} />
      <Field y={140} w={130} label="Project" value={project} placeholder="Choose…" />
      <Field x={152} y={140} w={134} label="Category" value={cat} placeholder="Choose…" />
      <Txt x={14} y={186} size={10} weight={600} color="var(--muted)">Who paid</Txt>
      <Segs x={14} w={272} y={200} items={['Me', 'LLC account', 'Kiran']} active={who} />
      {p >= 2 && who === 0 && <Txt x={14} y={232} size={10} color="var(--good)" style={{ opacity: p === 2 ? ramp(t, 0.42, 0.55) : 1 }}>Added to what the LLC owes you</Txt>}
      <Btn x={14} y={254} w={272} h={32} label="Save" primary pressed={p === 3 && t > 0.2 && t < 0.25} />
      {dup > 0 && (
        <Abs x={10} y={294 - 8 * (1 - dup)} w={280} h={78} style={{ opacity: dup, background: 'var(--warn-soft)', borderRadius: 10, color: 'var(--warn)' }}>
          <Txt x={12} y={10} size={12} weight={700} color="var(--warn)">Possible duplicate</Txt>
          <Txt x={12} y={28} w={256} size={10} color="var(--warn)">Home Depot, $412.50, 2 days ago is already there.</Txt>
          <Txt x={12} y={44} w={256} size={10} color="var(--warn)">Post anyway only if it’s a different purchase.</Txt>
        </Abs>
      )}
      {p === 1 && <Finger t={t} stops={[[0.6, 78, 166], [0.75, 218, 166]]} />}
      {p === 2 && <Finger t={t} stops={[[0.3, segX(0, 3, 14, 272), 213]]} />}
      {p === 3 && <Finger t={t} stops={[[0.2, 150, 270]]} />}
    </>
  )
}

function Settle({ p, t }: SP) {
  const cols: [string, (x: typeof partners[number]) => number, string?][] = [
    ['Into LLC account', (x) => x.into],
    ['Paid personally', (x) => x.personal],
    ['Paid back to them', (x) => -x.back],
  ]
  if (p === 5) {
    const paid = t > 0.6
    return (
      <>
        <Head title="Madhan" back />
        <Card y={56} h={150}>
          <Txt x={12} y={10} size={11} weight={700}>Balance</Txt>
          {[['Paid personally for projects', 8400], ['Reimbursed by the LLC', paid ? 4400 + up(4000, t, 0.6, 0.75) : 4400]].map(([k, v], i) => (
            <div key={k as string}><Txt x={12} y={34 + i * 26} size={11} color="var(--muted)">{k}</Txt><Txt x={180} y={34 + i * 26} w={88} size={11} align="right">{usd(v as number)}</Txt></div>
          ))}
          <Abs x={12} y={88} w={256} h={1} style={{ background: 'var(--border)' }} />
          <Txt x={12} y={100} size={12} weight={700}>LLC still owes</Txt>
          <Txt x={180} y={98} w={88} size={16} weight={800} align="right" color={paid ? 'var(--good)' : 'var(--bad)'}>{usd(paid ? 4000 - up(4000, t, 0.6, 0.75) : 4000)}</Txt>
        </Card>
        <Btn x={10} y={216} w={280} h={32} label="Reimburse a partner" icon="users" pressed={t > 0.2 && t < 0.25} />
        <Sheet show={ramp(t, 0.25, 0.35) * (1 - ramp(t, 0.55, 0.62))} h={150} title="Reimburse Madhan">
          <Field y={40} label="Amount" value={typed('$4,000.00', t, 0.36, 0.48)} focus />
          <Btn x={14} y={94} w={272} h={30} label="Save" primary />
        </Sheet>
        <Toast show={bump(t, 0.7, 0.98)} text="Paid back" />
        <Finger t={t} stops={[[0.2, 150, 232], [0.52, 150, H - 150 + 109]]} />
      </>
    )
  }
  const head = p <= 2 ? cols[p][0] : p === 3 ? 'Total put in' : 'Over / under share'
  return (
    <>
      <Head title="Partners" />
      <Txt x={14} y={54} size={15} weight={700}>Who paid what</Txt>
      <Abs x={10} y={80} w={280} h={28} style={{ background: 'var(--tut-tint)', borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', paddingLeft: 12, opacity: ramp(t, 0, 0.12) }}>{head}</Abs>
      {partners.map((x, i) => {
        const y = 118 + i * 52
        let v: number
        let color: string | undefined
        if (p <= 2) v = cols[p][1](x)
        else if (p === 3) v = putIn(x)
        else { v = putIn(x) - share; color = v < 0 ? 'var(--bad)' : 'var(--good)' }
        const shown = Math.round(v * ramp(t, 0.15 + i * 0.08, 0.45 + i * 0.08))
        return (
          <Card key={x.name} y={y} h={44}>
            <Txt x={12} y={14} size={12} weight={600}>{x.name}</Txt>
            {p === 4 && (
              <Abs x={110} y={18} w={80} h={8} style={{ background: 'var(--surface-2)', borderRadius: 4 }}>
                <Abs x={40} y={-3} w={1.5} h={14} style={{ background: 'var(--muted)' }} />
                <Abs x={v < 0 ? 40 - Math.min(40, (-v / 4000) * 40) * ramp(t, 0.2, 0.5) : 40} y={0} w={Math.min(40, (Math.abs(v) / 4000) * 40) * ramp(t, 0.2, 0.5)} h={8} style={{ background: color, borderRadius: 4 }} />
              </Abs>
            )}
            <Txt x={190} y={13} w={78} size={13} weight={700} align="right" color={color} style={{ fontVariantNumeric: 'tabular-nums' }}>{p === 4 && shown > 0 ? '+' : ''}{usd(shown)}</Txt>
          </Card>
        )
      })}
      {p === 3 && (
        <Abs x={10} y={278} w={280} h={44} style={{ opacity: ramp(t, 0.5, 0.65), background: 'var(--accent-soft)', borderRadius: 10, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', fontWeight: 600 }}>
          $60,000 + $8,400 − $4,400 = $64,000
        </Abs>
      )}
      {p === 4 && <Txt x={14} y={286} w={272} size={10} color="var(--muted)" style={{ whiteSpace: 'normal', opacity: ramp(t, 0.5, 0.65) }}>Each share of costs is {usd(share)} (equal thirds). Plus: covered more than their share.</Txt>}
      {p <= 2 && <Txt x={14} y={286} w={272} size={10} color="var(--muted)" style={{ whiteSpace: 'normal', opacity: ramp(t, 0.5, 0.65) }}>{['Money deposited into the LLC’s bank account.', 'Project costs paid with their own card or cash.', 'What the LLC has already paid back.'][p]}</Txt>}
    </>
  )
}

function Borrowed({ p, t }: SP) {
  const rate = p === 3 && t > 0.72 ? 10 : 12
  const accrued = rate === 12 ? 8500 : 7083
  const intPaid = p === 2 ? (t > 0.62 ? up(500, t, 0.62, 0.75) : 0) : p > 2 ? 500 : 0
  const card = (o: number) => (
    <Fade o={o} dy={10}>
      <Card y={82} h={196}>
        <Txt x={12} y={10} size={12} weight={700}>Prabhakar <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· Pavi</span></Txt>
        {([['Initial amount', '$50,000'], ['Rate', `${rate}%`], ['Since · used for', 'Jun 2025 · Chamberlayne'], ['Interest so far', usd(p === 1 ? up(accrued, t, 0.1, 0.5) : accrued)], ['Interest paid', usd(intPaid)], ['Owed now', usd(50000 + accrued - intPaid)], ['Per month', usd(Math.round(50000 * rate / 1200))]] as [string, string][]).map(([k, v], i) => (
          <div key={k}>
            <Txt x={12} y={34 + i * 22} size={11} color="var(--muted)">{k}</Txt>
            {k === 'Rate' && p === 3 && t > 0.3 && t <= 0.72
              ? <Abs x={200} y={30 + i * 22} w={68} h={20} style={{ border: '1.5px solid var(--tut-tint)', borderRadius: 5, background: 'var(--surface)' }}><Txt x={4} y={2} w={58} size={11} align="right">{typed('10', t, 0.42, 0.55)}<span className="tut-caret" /></Txt></Abs>
              : <Txt x={150} y={34 + i * 22} w={118} size={11} align="right" weight={k === 'Owed now' ? 800 : 600} color={(k === 'Interest so far' && p === 1) || (k === 'Interest paid' && p === 2 && t > 0.62) ? 'var(--tut-tint)' : undefined}>{v}</Txt>}
          </div>
        ))}
      </Card>
    </Fade>
  )
  return (
    <>
      <Head title="Partners" />
      <Txt x={14} y={56} size={13} weight={700}>Borrowed money</Txt>
      <Btn x={210} y={51} w={80} h={24} label="+ Add loan" pressed={p === 0 && t > 0.12 && t < 0.17} />
      {card(p === 0 ? ramp(t, 0.86, 0.98) : 1)}
      <Txt x={14} y={292} w={272} size={10} color="var(--muted)" style={{ whiteSpace: 'normal' }}>For reference only: loans don’t change anyone’s balance or payout.</Txt>
      {p === 0 && (
        <Sheet show={ramp(t, 0.17, 0.28) * (1 - ramp(t, 0.8, 0.88))} h={300} title="Add loan">
          <Field y={40} w={130} label="Partner" value={t > 0.3 ? 'Prabhakar' : ''} />
          <Field x={152} y={40} w={134} label="Lender" value={typed('Pavi', t, 0.32, 0.4)} focus={t > 0.3 && t < 0.42} />
          <Field y={86} w={130} label="Used for" value={t > 0.44 ? 'Chamberlayne' : ''} />
          <Field x={152} y={86} w={134} label="Borrowed on" value={t > 0.48 ? 'Jun 1, 2025' : ''} />
          <Field y={132} w={130} label="Amount" value={typed('$50,000', t, 0.52, 0.62)} focus={t > 0.5 && t < 0.63} />
          <Field x={152} y={132} w={134} label="Rate per year" value={typed('12%', t, 0.64, 0.7)} focus={t > 0.63 && t < 0.72} />
          <Btn x={14} y={190} w={272} h={32} label="Save loan" primary pressed={t > 0.74 && t < 0.79} />
        </Sheet>
      )}
      {p === 2 && (
        <Sheet show={ramp(t, 0.2, 0.3) * (1 - ramp(t, 0.56, 0.62))} h={170} title="Payment on Pavi loan">
          <Segs x={14} w={272} y={40} items={['Interest', 'Principal']} active={0} />
          <Field y={74} label="Amount" value={typed('$500.00', t, 0.32, 0.44)} focus />
          <Btn x={14} y={124} w={272} h={30} label="Save" primary pressed={t > 0.5 && t < 0.55} />
        </Sheet>
      )}
      {p === 0 && <Finger t={t} stops={[[0.12, 250, 63], [0.74, 150, H - 300 + 206]]} />}
      {p === 1 && <Finger t={t} stops={[[0.3, 230, 160, 'move']]} fadeOut={0.6} />}
      {p === 2 && <Finger t={t} stops={[[0.15, 60, 98], [0.5, 150, H - 170 + 139]]} />}
      {p === 3 && <Finger t={t} stops={[[0.3, 250, 138]]} />}
    </>
  )
}

function Fix({ p, t }: SP) {
  if (p === 0) {
    const editing = t > 0.3 && t < 0.7
    const saved = t >= 0.7
    return (
      <>
        <Head title="Chamberlayne" back />
        <Segs y={54} items={['Overview', 'Budget', 'Forecast', 'Sale', 'Files']} active={1} />
        {[['Plumbing', 16800, saved ? 20000 : 18000], ['Roofing', 9500, 12000], ['Electrical', 7200, 7000]].map(([n, sp, b], k) => (
          <Card key={n} y={92 + k * 56} h={50} hl={k === 0 ? bump(t, 0.1, 0.32) : 0}>
            <Txt x={10} y={8} size={12} weight={600}>{n}</Txt>
            <Txt x={10} y={25} size={10} color="var(--muted)">{usd(sp as number)} spent</Txt>
            {k === 0 && editing
              ? <Abs x={186} y={10} w={84} h={24} style={{ border: '1.5px solid var(--tut-tint)', borderRadius: 6, background: 'var(--surface)' }}><Txt x={6} y={4} w={72} size={12} align="right">{typed('20,000', t, 0.36, 0.56)}<span className="tut-caret" /></Txt></Abs>
              : <Txt x={180} y={12} w={88} size={12} weight={700} align="right" color={k === 0 && saved ? 'var(--tut-tint)' : undefined}>{usd(b as number)}</Txt>}
          </Card>
        ))}
        {t > 0.12 && t < 0.3 && <Abs x={176} y={70} style={{ background: 'var(--ink)', color: 'var(--bg)', fontSize: 10, padding: '3px 7px', borderRadius: 5 }}>Click to edit</Abs>}
        {t > 0.58 && t < 0.72 && <Abs x={196} y={126} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5 }}>Enter ↵</Abs>}
        <Toast show={bump(t, 0.72, 0.98)} text="Budget saved" />
        <Finger t={t} stops={[[0.12, 240, 115, 'move'], [0.3, 240, 115]]} />
      </>
    )
  }
  if (p === 1) {
    const fixed = t > 0.6
    return (
      <>
        <Head title="Receipt" back />
        <Card y={56} h={92} hl={0} style={{ opacity: fixed ? mix(1, 0.55, ramp(t, 0.6, 0.72)) : 1 }}>
          <Txt x={12} y={10} size={11} color="var(--muted)">Home Depot · Chamberlayne · Plumbing</Txt>
          {t > 0.25 && !fixed
            ? <Abs x={10} y={28} w={120} h={30} style={{ border: '1.5px solid var(--tut-tint)', borderRadius: 6, background: 'var(--surface)' }}><Txt x={6} y={5} w={108} size={16} weight={700}>{typed('$421.50', t, 0.3, 0.5)}<span className="tut-caret" /></Txt></Abs>
            : <Txt x={12} y={30} size={20} weight={800} style={{ textDecoration: fixed ? 'line-through' : undefined }}>$412.50</Txt>}
          {fixed && <Badge x={220} y={34} label="Void" />}
          {fixed && <Txt x={12} y={66} w={256} size={10} color="var(--muted)">Corrected: amount $412.50 → $421.50</Txt>}
        </Card>
        <Fade o={ramp(t, 0.66, 0.8)} dy={20}>
          <Card y={158} h={80} hl={bump(t, 0.75, 1)}>
            <Txt x={12} y={10} size={11} color="var(--muted)">Home Depot · Chamberlayne · Plumbing</Txt>
            <Txt x={12} y={30} size={20} weight={800}>$421.50</Txt>
            <Badge x={210} y={34} label="Posted" tone="good" />
            <Txt x={12} y={58} size={10} color="var(--muted)">Same receipt photo attached</Txt>
          </Card>
        </Fade>
        <Finger t={t} stops={[[0.22, 60, 100], [0.55, 60, 100, 'move']]} />
      </>
    )
  }
  const voided = p === 3 && t > 0.68
  return (
    <>
      <Head title="Receipt" back />
      <Card y={56} h={74}>
        <Txt x={12} y={10} size={11} color="var(--muted)">Lowe’s · Willway · Tile</Txt>
        <Txt x={12} y={30} size={20} weight={800} color={voided ? 'var(--muted)' : undefined}>$412.00</Txt>
        <Badge x={210} y={34} label={voided ? 'Void' : 'Posted'} tone={voided ? 'neutral' : 'good'} />
      </Card>
      <Txt x={14} y={142} size={11} weight={700}>Notes</Txt>
      <Abs x={10} y={160} w={280} h={60} style={{ border: `1.5px solid ${p === 2 && t < 0.8 ? 'var(--tut-tint)' : 'var(--border)'}`, borderRadius: 8, background: 'var(--surface)' }}>
        <Txt x={8} y={8} w={262} size={11} style={{ whiteSpace: 'normal' }}>{p === 2 ? typed('Bathroom tile, returned 2 boxes', t, 0.2, 0.6) : 'Bathroom tile, returned 2 boxes'}{p === 2 && t < 0.8 && <span className="tut-caret" />}</Txt>
      </Abs>
      {voided && <Abs x={10} y={230} w={280} h={30} style={{ background: 'var(--bad-soft)', color: 'var(--bad)', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', paddingLeft: 10, opacity: ramp(t, 0.68, 0.78) }}>Voided by Madhan: Entered twice</Abs>}
      <Btn x={190} y={286} w={100} h={30} label="Void…" danger pressed={p === 3 && t > 0.15 && t < 0.2} />
      {p === 3 && (
        <Sheet show={ramp(t, 0.2, 0.3) * (1 - ramp(t, 0.6, 0.67))} h={160} title="Void this receipt?">
          <Field y={40} label="Reason" value={typed('Entered twice', t, 0.32, 0.48)} focus />
          <Btn x={14} y={94} w={272} h={30} label="Void" primary pressed={t > 0.54 && t < 0.59} />
        </Sheet>
      )}
      {p === 2 && <Finger t={t} stops={[[0.15, 120, 190]]} />}
      {p === 3 && <Finger t={t} stops={[[0.15, 240, 301], [0.54, 150, H - 160 + 109]]} />}
    </>
  )
}

function Review({ p, t }: SP) {
  if (p === 0) {
    return (
      <>
        <Head title="Receipt" back />
        <Card y={56} h={74}>
          <Txt x={12} y={10} size={11} color="var(--muted)">ABC Plumbing · Chamberlayne</Txt>
          <Txt x={12} y={30} size={20} weight={800}>$16,800.00</Txt>
          {t > 0.7 && <Badge x={190} y={34} label="Needs review" tone="warn" />}
        </Card>
        <Btn x={10} y={140} w={135} h={30} label="Needs review" icon="alert" pressed={t > 0.15 && t < 0.2} />
        <Btn x={155} y={140} w={135} h={30} label="Void…" danger />
        <Sheet show={ramp(t, 0.2, 0.3) * (1 - ramp(t, 0.62, 0.68))} h={180} title="What should be checked?">
          <Abs x={14} y={40} w={272} h={58} style={{ border: '1.5px solid var(--tut-tint)', borderRadius: 8, background: 'var(--surface)' }}>
            <Txt x={8} y={8} w={256} size={11} style={{ whiteSpace: 'normal' }}>{typed('Is this Chamberlayne or Willway?', t, 0.3, 0.52)}<span className="tut-caret" /></Txt>
          </Abs>
          <Btn x={14} y={110} w={272} h={30} label="Add to Needs review" primary pressed={t > 0.56 && t < 0.61} />
        </Sheet>
        <Finger t={t} stops={[[0.15, 78, 155], [0.56, 150, H - 180 + 125]]} />
      </>
    )
  }
  if (p === 1) {
    const n = t > 0.3 ? 3 : 2
    return (
      <>
        <HomeScreen />
        <Head title="Project Ledger" search counts={{ 'Needs review': n }} />
        <Tabs active={0} />
        <Abs x={10} y={234} w={280} h={40} style={{ borderRadius: 10, boxShadow: `0 0 0 ${3 * bump(t, 0.3, 0.7)}px var(--tut-tint)` }} />
        <Card y={234} h={40}>
          <Abs x={8} y={7} w={26} h={26} style={{ borderRadius: 7, background: 'var(--warn-soft)', color: 'var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="alert" size={14} /></Abs>
          <Txt x={42} y={6} w={170} size={12} weight={600}>{n} entries need review</Txt>
          <Txt x={42} y={21} w={170} size={10} color="var(--muted)">Is this Chamberlayne or Willway?</Txt>
          <Abs x={232} y={10} w={36} h={20} style={{ borderRadius: 10, background: 'var(--warn)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 + 0.35 * bump(t, 0.3, 0.5)})` }}>{n}</Abs>
        </Card>
      </>
    )
  }
  const items = ['Is this Chamberlayne or Willway?', 'Amount looks doubled', 'Which partner paid?']
  const done = p === 2 && t > 0.62
  const out = p === 2 ? ramp(t, 0.72, 0.86) : 0
  const back = p === 3 ? ramp(t, 0.45, 0.6) : 0
  return (
    <>
      <Head title="Needs review" back />
      <Segs y={52} items={['To review', 'Reviewed']} active={p === 3 ? 1 : 0} />
      {p === 2 && items.map((x, i) => (
        <Card key={x} y={88 + i * 62 - (i > 0 ? 62 * out : 0)} h={56} style={i === 0 ? { opacity: 1 - out, transform: `translateX(${60 * out}px)` } : undefined}>
          <Txt x={12} y={8} w={165} size={12} weight={600}>{['ABC Plumbing · $16,800', 'Home Depot · $824', 'Lowe’s · $412'][i]}</Txt>
          <Txt x={12} y={26} w={165} size={10} color="var(--warn)">{x}</Txt>
          {i === 0 && done ? <Badge x={200} y={18} label="✓ Reviewed" tone="good" /> : <Btn x={180} y={14} w={92} h={26} label="Mark reviewed" pressed={i === 0 && t > 0.15 && t < 0.2} />}
        </Card>
      ))}
      {p === 2 && (
        <Sheet show={ramp(t, 0.2, 0.3) * (1 - ramp(t, 0.55, 0.62))} h={160} title="What did you find?">
          <Field y={40} label="Note" value={typed('Moved it to Willway', t, 0.3, 0.46)} focus />
          <Btn x={14} y={94} w={272} h={30} label="Done" primary pressed={t > 0.5 && t < 0.55} />
        </Sheet>
      )}
      {p === 3 && (
        <Card y={88} h={56} style={{ opacity: 1 - back }}>
          <Txt x={12} y={8} w={180} size={12} weight={600}>ABC Plumbing · $16,800</Txt>
          <Txt x={12} y={26} w={180} size={10} color="var(--good)">Moved it to Willway</Txt>
          <Btn x={196} y={14} w={76} h={26} label="Reopen" pressed={t > 0.3 && t < 0.35} />
        </Card>
      )}
      {p === 3 && <Toast show={bump(t, 0.55, 0.95)} text="Back on the review list" />}
      {p === 2 && <Finger t={t} stops={[[0.15, 226, 115], [0.5, 150, H - 160 + 109]]} />}
      {p === 3 && <Finger t={t} stops={[[0.1, segX(1, 2), 65], [0.3, 234, 115]]} />}
    </>
  )
}

function Sale({ p, t }: SP) {
  const head = (
    <>
      <Head title="Chamberlayne" back />
      <Segs y={52} items={['Overview', 'Budget', 'Forecast', 'Sale', 'Files']} active={3} />
    </>
  )
  if (p === 0) {
    return (
      <>
        {head}
        <Txt x={14} y={92} size={13} weight={700}>Sale</Txt>
        <Btn x={180} y={86} w={110} h={26} label="Record the sale" primary pressed={t > 0.12 && t < 0.17} />
        <Sheet show={ramp(t, 0.17, 0.28) * (1 - ramp(t, 0.8, 0.88))} h={250} title="Record the sale">
          <Field y={40} label="Sale price" value={typed('$340,000', t, 0.3, 0.42)} focus={t < 0.44} />
          <Field y={86} label="Selling costs" value={typed('$20,400', t, 0.45, 0.56)} focus={t > 0.44 && t < 0.58} />
          <Field y={132} label="Loan paid off at closing" value={typed('$150,000', t, 0.59, 0.7)} focus={t > 0.58 && t < 0.72} />
          <Btn x={14} y={190} w={272} h={32} label="Save" primary pressed={t > 0.74 && t < 0.79} />
        </Sheet>
        <Fade o={ramp(t, 0.86, 0.98)}><Row y={122} title="Net proceeds" right="$319,600" /></Fade>
        <Finger t={t} stops={[[0.12, 235, 99], [0.74, 150, H - 250 + 206]]} />
      </>
    )
  }
  if (p === 1) {
    const steps: [string, number][] = [['Net proceeds', 319600], ['Loan paid off', -150000], ['Bills still to pay', -8200], ['Cash left to pay out', 161400]]
    return (
      <>
        {head}
        <Txt x={14} y={92} size={13} weight={700}>Cash from the sale</Txt>
        {steps.map(([k, v], i) => {
          const o = ramp(t, 0.08 + i * 0.16, 0.2 + i * 0.16)
          const last = i === 3
          return (
            <Fade key={k} o={o} dy={8}>
              <Txt x={14} y={120 + i * 50} size={11} color={last ? 'var(--text)' : 'var(--muted)'} weight={last ? 700 : 400}>{k}</Txt>
              <Txt x={180} y={118 + i * 50} w={106} size={13} weight={700} align="right" color={v < 0 ? 'var(--bad)' : last ? 'var(--good)' : undefined}>{usd(v)}</Txt>
              <Bar x={14} y={138 + i * 50} w={272} h={8} frac={Math.abs(v) / 319600} color={v < 0 ? 'var(--bad)' : last ? 'var(--good)' : 'var(--ink)'} />
            </Fade>
          )
        })}
      </>
    )
  }
  if (p === 2 || p === 3) {
    const cents = [13333.34, 13333.34, 13333.33]
    return (
      <>
        {head}
        <Txt x={14} y={92} size={13} weight={700}>Who gets what</Txt>
        <Txt x={180} y={94} w={106} size={10} align="right" color="var(--muted)">Profit $40,000.01</Txt>
        {partners.map((x, i) => {
          const cap = putIn(x)
          const capK = p === 2 ? ramp(t, 0.1 + i * 0.08, 0.35 + i * 0.08) : 1
          const profK = p === 2 ? ramp(t, 0.55, 0.8) : 1
          return (
            <Card key={x.name} y={116 + i * 62} h={56} hl={p === 3 && i === 1 ? bump(t, 0.55, 0.95) : 0}>
              <Txt x={12} y={8} size={12} weight={700}>{x.name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· equal share</span></Txt>
              <Abs x={12} y={30} w={170} h={10} style={{ background: 'var(--surface-2)', borderRadius: 5, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${(cap / 80000) * 100 * capK}%`, background: 'var(--ink)' }} />
                <div style={{ width: `${(13333 / 80000) * 100 * profK}%`, background: 'var(--good)' }} />
              </Abs>
              <Txt x={190} y={8} w={80} size={10} align="right" color="var(--muted)">Capital {usd(Math.round(cap * capK))}</Txt>
              <Txt x={190} y={28} w={80} size={11} weight={700} align="right" color="var(--good)">{p === 3 ? '+' + usd(cents[i], true) : '+' + usd(Math.round(13333 * profK))}</Txt>
            </Card>
          )
        })}
        {p === 3 && <Txt x={14} y={308} w={272} size={10} color="var(--muted)" style={{ whiteSpace: 'normal', opacity: ramp(t, 0.3, 0.45) }}>Exactly equal thirds. The leftover cent goes to one partner so the total adds up.</Txt>}
        {p === 2 && <Fade o={ramp(t, 0.82, 0.95)}><Txt x={14} y={308} w={272} size={10} color="var(--muted)"><span style={{ color: 'var(--ink)', fontWeight: 800 }}>■</span> Capital back first <span style={{ color: 'var(--good)', fontWeight: 800, marginLeft: 8 }}>■</span> then profit share</Txt></Fade>}
      </>
    )
  }
  if (p === 4) {
    return (
      <>
        {head}
        <Txt x={14} y={92} size={13} weight={700}>Profit split</Txt>
        <Btn x={190} y={86} w={100} h={26} label="Change split" pressed={t > 0.12 && t < 0.17} />
        {partners.map((x, i) => <Row key={x.name} y={122 + i * 44} title={x.name} right={t > 0.8 ? ['40%', '30%', '30%'][i] : 'equal'} />)}
        <Sheet show={ramp(t, 0.17, 0.28) * (1 - ramp(t, 0.74, 0.8))} h={240} title="Split for Chamberlayne">
          {partners.map((x, i) => <Field key={x.name} y={40 + i * 44} label={x.name} value={typed(['40', '30', '30'][i] + '%', t, 0.32 + i * 0.1, 0.4 + i * 0.1)} focus={t > 0.3 + i * 0.1 && t < 0.42 + i * 0.1} />)}
          <Btn x={14} y={180} w={272} h={32} label="Save split" primary pressed={t > 0.66 && t < 0.71} />
        </Sheet>
        <Finger t={t} stops={[[0.12, 240, 99], [0.66, 150, H - 240 + 196]]} />
      </>
    )
  }
  const rec = t > 0.66
  return (
    <>
      {head}
      <Txt x={14} y={92} size={13} weight={700}>Distributions</Txt>
      <Btn x={190} y={86} w={100} h={26} label="+ Record one" pressed={t > 0.12 && t < 0.17} />
      <Row y={122} title="Kiran" sub="Dec 2" right="$70,433" />
      <Fade o={rec ? ramp(t, 0.66, 0.78) : 0} dy={-10}><Row y={168} title="Madhan" sub="Today" right="$55,000" hl={bump(t, 0.7, 1)} /></Fade>
      <Sheet show={ramp(t, 0.17, 0.28) * (1 - ramp(t, 0.6, 0.66))} h={190} title="Record a distribution">
        <Field y={40} label="Partner" value={t > 0.3 ? 'Madhan' : ''} />
        <Field y={86} label="Amount paid out" value={typed('$55,000', t, 0.36, 0.5)} focus />
        <Btn x={14} y={140} w={272} h={30} label="Save" primary pressed={t > 0.54 && t < 0.59} />
      </Sheet>
      <Finger t={t} stops={[[0.12, 240, 99], [0.54, 150, H - 190 + 155]]} />
    </>
  )
}

function Search({ p, t }: SP) {
  const q = ['home depot', '412', 'tile 412', 'tile 412'][p]
  const typing = p < 3 ? typed(q, t, 0.15, 0.4) : q
  const done = p === 3 || t > 0.45
  const filter: typeof records = p === 0 ? records.filter((r) => r[0] === 'Home Depot') : p === 1 ? records.filter((r) => Math.floor(Math.abs(r[2])) === 412) : records.filter((r) => r[0] === 'Lowe’s')
  const list = done ? filter : records
  return (
    <>
      <Head title="Activity" />
      <ActivityList query={typing} focus={p < 3 && t > 0.08 && t < 0.5} list={p === 3 ? [] : list} />
      {p === 1 && done && <Txt x={14} y={96 + list.length * 46} w={272} size={10} color="var(--muted)" style={{ whiteSpace: 'normal' }}>412 finds $412.00 to $412.99</Txt>}
      {p === 3 && (
        <>
          <Abs x={10} y={90} style={{ display: 'flex', gap: 6 }}>
            {['Project', 'Vendor', 'Partner', 'Date'].map((c, i) => (
              <span key={c} style={{ fontSize: 10, fontWeight: 600, padding: '4px 9px', borderRadius: 12, border: '1px solid var(--border)', background: i === 0 && t > 0.3 ? 'var(--tut-tint)' : 'var(--surface)', color: i === 0 && t > 0.3 ? '#fff' : 'var(--text)' }}>{i === 0 && t > 0.3 ? 'Willway ✕' : c}</span>
            ))}
          </Abs>
          <Fade o={ramp(t, 0.35, 0.5)}>
            <Row y={124} icon="folder" title="Willway" sub="Project" right="Open →" />
            {filter.map(([v, sub, amt, icon], i) => <Row key={v} y={170 + i * 46} icon={icon} title={v} sub={sub} right={usd(amt, true)} />)}
          </Fade>
        </>
      )}
      {p < 3 ? <Finger t={t} stops={[[0.08, 150, 67]]} /> : <Finger t={t} stops={[[0.25, 38, 101]]} />}
    </>
  )
}

function Books({ p, t }: SP) {
  if (p === 0) {
    const claimed = t > 0.55
    return (
      <>
        <Head title="Weekly review" back />
        <Txt x={14} y={54} size={11} weight={700}>Bills due in 7 days</Txt>
        <Row y={70} icon="doc" title="ABC Plumbing" sub="Due Fri" right="$8,200" />
        <Txt x={14} y={120} size={11} weight={700}>Waiting for approval</Txt>
        <Row y={136} icon="sign" tone="warn" title="Roof Pros change order" sub="Added by Kiran" right="$1,450" />
        <Txt x={14} y={186} size={11} weight={700}>Missing receipts</Txt>
        <Card y={202} h={44}>
          <Txt x={12} y={7} size={12} weight={600}>Card charge · Lowe’s</Txt>
          <Txt x={12} y={23} size={10} color="var(--muted)">Nov 21 · $96.40</Txt>
          {claimed ? <Badge x={190} y={14} label="Claimed by you" tone="good" /> : <Btn x={192} y={8} w={78} h={26} label="I’ll take it" pressed={t > 0.5 && t < 0.55} />}
        </Card>
        <Finger t={t} stops={[[0.5, 231, 223]]} />
      </>
    )
  }
  if (p === 1) {
    const drop = ramp(t, 0.05, 0.3)
    const filed = t > 0.6
    return (
      <>
        <Head title="Receipt inbox" back />
        {!filed && (
          <Card y={60 + 40 * drop} h={64} style={{ opacity: drop }}>
            <Abs x={10} y={10} w={34} h={44} style={{ borderRadius: 5, background: 'var(--surface-2)', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="receipt" size={18} /></Abs>
            <Txt x={54} y={14} w={130} size={12} weight={600}>IMG_2231.jpg</Txt>
            <Txt x={54} y={32} w={130} size={10} color="var(--muted)">Added just now</Txt>
            <Btn x={200} y={18} w={68} h={28} label="File" primary pressed={t > 0.5 && t < 0.55} />
          </Card>
        )}
        <Fade o={filed ? ramp(t, 0.6, 0.75) : 0}>
          <Row y={100} icon="receipt" title="Home Depot" sub="Chamberlayne · Plumbing" right="$412.50" hl={bump(t, 0.7, 1)} />
        </Fade>
        <Toast show={bump(t, 0.66, 0.96)} text="Filed as a receipt" />
        <Finger t={t} stops={[[0.5, 234, 132]]} />
      </>
    )
  }
  if (p === 2) {
    const charges: [string, string, boolean][] = [['Home Depot $412.50', 'Receipt', true], ['City Water $96.40', 'Receipt', true], ['Lowe’s $64.10', 'Missing receipt', false]]
    return (
      <>
        <Head title="Statements" back />
        <Txt x={14} y={54} size={11} weight={700}>Card statement · November</Txt>
        {charges.map(([c, r, ok], i) => {
          const k = ramp(t, 0.15 + i * 0.22, 0.3 + i * 0.22)
          return (
            <div key={c}>
              <Card x={10} y={76 + i * 60} w={130} h={46}><Txt x={8} y={15} w={114} size={11} weight={600}>{c}</Txt></Card>
              <Abs x={140} y={98 + i * 60} w={20 * k} h={2} style={{ background: ok ? 'var(--good)' : 'var(--bad)' }} />
              <Card x={160} y={76 + i * 60} w={130} h={46} style={{ opacity: k, background: ok ? 'var(--good-soft)' : 'var(--bad-soft)', border: 'none' }}>
                <Abs x={8} y={14} style={{ color: ok ? 'var(--good)' : 'var(--bad)' }}><Icon name={ok ? 'check' : 'alert'} size={16} /></Abs>
                <Txt x={30} y={15} w={94} size={11} weight={700} color={ok ? 'var(--good)' : 'var(--bad)'}>{ok ? 'Matched' : r}</Txt>
              </Card>
            </div>
          )
        })}
      </>
    )
  }
  if (p === 3) {
    const pts = [26, 24, 22, 18, 21, 15, 11, 7, -3, 4, 9, 12]
    const k = ramp(t, 0.1, 0.6)
    const n = Math.max(1, Math.round(pts.length * k))
    const path = pts.slice(0, n).map((v, i) => `${i ? 'L' : 'M'}${20 + i * 24},${200 - v * 4}`).join(' ')
    return (
      <>
        <Head title="Cash plan" back />
        <Txt x={14} y={54} size={11} weight={700}>LLC account, next 30 days</Txt>
        <Card y={74} h={170}>
          <svg width={278} height={168} style={{ position: 'absolute', left: 0, top: 0 }} viewBox="0 74 278 168">
            <line x1={10} x2={268} y1={200} y2={200} stroke="var(--border)" strokeDasharray="3 3" />
            <path d={path} fill="none" stroke="var(--tut-tint)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            {n > 8 && <circle cx={20 + 8 * 24} cy={212} r={5} fill="var(--bad)" />}
          </svg>
        </Card>
        <Fade o={ramp(t, 0.6, 0.72)}>
          <Abs x={10} y={256} w={280} h={44} style={{ background: 'var(--bad-soft)', borderRadius: 10 }}>
            <Txt x={12} y={7} size={12} weight={700} color="var(--bad)">Short $3,200 by Dec 14</Txt>
            <Txt x={12} y={24} size={10} color="var(--bad)">Plan a contribution before then</Txt>
          </Abs>
        </Fade>
      </>
    )
  }
  const bars: [string, number][] = [['Chamberlayne', 182400], ['Willway', 96500], ['Oak Street', 41200]]
  return (
    <>
      <Head title="Reports" back />
      <Txt x={14} y={54} size={11} weight={700}>Spent by project</Txt>
      {bars.map(([n, v], i) => (
        <div key={n}>
          <Txt x={14} y={80 + i * 44} size={11}>{n}</Txt>
          <Txt x={180} y={80 + i * 44} w={106} size={11} weight={700} align="right">{usd(up(v, t, 0.05, 0.4))}</Txt>
          <Bar x={14} y={98 + i * 44} w={272} h={8} frac={(v / 182400) * ramp(t, 0.05, 0.4)} />
        </div>
      ))}
      <Btn x={10} y={222} w={280} h={32} label="Export CSV" icon="download" pressed={t > 0.5 && t < 0.55} />
      <Fade o={ramp(t, 0.58, 0.7)}><Row y={266} icon="doc" tone="good" title="ledger-export.csv" sub="Ready for the accountant" /></Fade>
      <Finger t={t} stops={[[0.5, 150, 238]]} />
    </>
  )
}

const scenes: Record<string, (p: SP) => ReactNode> = {
  basics: Basics, projects: Projects, add: AddExpense, settle: Settle, borrowed: Borrowed, fix: Fix, review: Review, sale: Sale, search: Search, books: Books,
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

function useMedia(query: string) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
  const [on, setOn] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const q = window.matchMedia(query)
    const h = () => setOn(q.matches)
    h()
    q.addEventListener?.('change', h)
    return () => q.removeEventListener?.('change', h)
  }, [query])
  return on
}
const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)')

/** Plays a guide's scene beside its steps, one phase per step, in a loop. Clicking a step shows it;
 * Pause stops on the current frame. With reduced motion nothing plays by itself: the scene shows the
 * chosen step's result. */
export function TutorialPlayer({ scene, steps, tint }: { scene: string; steps: string[]; tint: string }) {
  const reduce = useReducedMotion()
  // Same switch as the app (sidebar from 901px): a computer gets the web layout (sidebar, top bar); a phone gets the phone layout (header, bottom tabs).
  const desktop = useMedia('(min-width: 901px)')
  const fullW = desktop ? SW + W : W
  const fullH = desktop ? CH + H : H
  const [paused, setPaused] = useState(false)
  const [pos, setPos] = useState({ phase: 0, t: reduce ? 0.999 : 0 })
  const origin = useRef(performance.now())
  const pausedAt = useRef<number | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const n = steps.length
  const autoplay = !reduce

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / fullW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fullW])

  useEffect(() => { origin.current = performance.now(); setPos({ phase: 0, t: reduce ? 0.999 : 0 }) }, [scene, reduce])

  useEffect(() => {
    if (!autoplay || paused || !n) return
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 30) return
      last = now
      const local = Math.max(0, now - origin.current) % (PHASE_MS * n)
      const phase = Math.min(Math.floor(local / PHASE_MS), n - 1)
      setPos({ phase, t: (local - phase * PHASE_MS) / PHASE_MS })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [autoplay, paused, n, scene])

  /** Playing: the step starts over. Paused or reduced motion: the step's last frame, its result. */
  const jump = (i: number) => {
    const now = performance.now()
    if (!autoplay || paused) {
      origin.current = now - (i + 0.98) * PHASE_MS
      if (paused) pausedAt.current = now
      setPos({ phase: i, t: 0.98 })
    } else {
      origin.current = now - i * PHASE_MS
      setPos({ phase: i, t: 0 })
    }
  }
  const toggle = () => {
    const now = performance.now()
    if (paused) { origin.current += now - (pausedAt.current ?? now); pausedAt.current = null; setPaused(false) }
    else { pausedAt.current = now; setPaused(true) }
  }

  const Scene = scenes[scene]
  return (
    <div className="tut" style={{ ['--tut-tint' as string]: tint } as CSSProperties}>
      <div className="tut-side">
        <div className={`tut-stage ${desktop ? 'desktop' : 'phone'}`} ref={stage} aria-hidden="true" style={{ aspectRatio: `${fullW} / ${fullH}` }}>
          <div className="tut-canvas" style={{ width: fullW, height: fullH, transform: `scale(${scale})` }}>
            {desktop && (
              <div className="tut-chrome" style={{ height: CH }}>
                <i /><i /><i />
                <span>project-ledger</span>
              </div>
            )}
            <div style={{ position: 'absolute', left: desktop ? SW : 0, top: desktop ? CH : 0, width: W, height: H }}>
              <Desktop.Provider value={desktop}>
                {Scene && <Scene p={pos.phase} t={pos.t} />}
              </Desktop.Provider>
            </div>
          </div>
        </div>
        {autoplay && (
          <button type="button" className="tut-play" onClick={toggle} style={{ color: tint, borderColor: tint }}>
            {paused ? '▶ Play' : '❚❚ Pause'}
          </button>
        )}
      </div>
      <ol className="tut-steps">
        {steps.map((s, i) => {
          const on = i === pos.phase
          return (
            <li key={i}>
              <button type="button" className={`tut-step ${on ? 'on' : ''}`} onClick={() => jump(i)} aria-current={on ? 'step' : undefined} aria-label={`Step ${i + 1}: ${s}`}>
                <span className="tut-num" style={on ? { background: tint, color: '#fff' } : { color: tint, background: `color-mix(in srgb, ${tint} 15%, transparent)` }}>{i + 1}</span>
                <span className="tut-text">
                  {s}
                  {on && autoplay && <span className="tut-progress" style={{ background: `color-mix(in srgb, ${tint} 18%, transparent)` }}><span style={{ width: `${pos.t * 100}%`, background: tint }} /></span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
