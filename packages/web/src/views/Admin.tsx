import {useSheetContext} from '../lib/sheet-context'
import { imageURL, revokeImageURL } from '../platform/plan-history'
import { createExerciseIndex } from '@opengym/core/exercises'
import { ux } from '../platform/ux'
import { copyText } from '../lib/clipboard'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { api } from '../lib/api'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '@opengym/core/format'
import { auditCat, auditLine, fmtWhen } from '../lib/audit'
import { workoutVolume, setsDone } from '@opengym/core/history'
import { confirmSheet } from '../sheets'
import Icon from '../components/Icon'
import { Button } from '../components/ui'
import '../admin.css'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Deliberately English-only — it isn't part of the translated end-user surface, so it stays
// out of the per-language string packs.
//
// One page of cards, each opening with a sentence that says what it is for. An operator who
// looks at this twice a year should not have to remember what "synced 3d ago" or an invite
// code means.

const adminApi = (valid:()=>boolean, path:string, init?:RequestInit):Promise<any> => {
  if(!valid())return Promise.reject(new Error('The account changed. Open this action again.'))
  return api(path,init).then(response=>{if(!valid())throw new Error('The account changed. Open this action again.');return response})
}

const rel = (ts: any) => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  return Math.floor(s / 86400) + ' d ago'
}
const dur = (ms: any) => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min' }

// The one time the reset code is visible. Locked, so a tap beside the sheet cannot lose it
// before it has been copied or written down.
function UserDetail({ id, onChanged, close, contextValid }: any) {
  const currentValid=useSheetContext({updater:true})
  const valid=()=>contextValid() && currentValid()
  const [d, setD] = useState<any>(null)
  const toast = useUI((s: any) => s.toast)
  const openSheet = useUI((s: any) => s.openSheet)
  useEffect(() => { if(!valid())return; let live=true; adminApi(valid,'/api/admin/user?id=' + encodeURIComponent(id)).then((data:any)=>{if(live&&valid())setD(data)}).catch((e: any)=>{if(live&&valid())toast(e.message)});return()=>{live=false} }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  const u = d.user
  // The document comes straight off the user's state file. PUT /api/data drops null and
  // shapeless entries now, but a file written before it did still answers with them, and this
  // sheet renders outside the route's ErrorBoundary: one throw here blanked the whole app and
  // left exactly this account un-disableable. setsDone/workoutVolume walk entries and sets, so
  // an entry that lacks either has nothing to show and is skipped rather than drawn.
  const workouts = (d.workouts || []).filter((w: any) => w && Array.isArray(w.entries) && w.entries.every((e: any) => e && Array.isArray(e.sets)))
  // Their whole record as the admin API already returns it — the export the delete sheet offers.
  const exportUser = () => {
    if(!valid())return
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
    const a = ux().document!.createElement('a')
    a.href = imageURL(blob)
    a.download = `opengym-${u.name.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}-${u.id}.json`
    ux().document!.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => revokeImageURL(a.href), 1000)
  }
  const doDelete = () => {
    if(!valid())return
    adminApi(valid,'/api/admin/user/delete', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(() => { if(!valid())return; toast('Account deleted'); onChanged(); close() })
      .catch((e: any) => toast(e.message))
  }
  const setDisabled = (disabled: any) => {
    if(!valid())return
    adminApi(valid,'/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { if(!valid())return; toast(disabled ? 'User disabled' : 'User enabled'); onChanged(); close() })
      .catch((e: any) => toast(e.message))
  }
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="adm-pill acc">admin</span>}
      {u.disabled && <span className="adm-pill bad">disabled</span>}
      {u.invitedBy && <span className="adm-pill">invite {u.invitedBy}</span>}
      <span className="adm-pill">joined {u.created ? fmtDate(u.created.slice(0, 10), false) : '–'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">Workouts</div><div className="v" style={{ fontSize: '1.1rem' }}>{workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Measurements</div><div className="v" style={{ fontSize: '1.1rem' }}>{(d.measurements || []).length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <>
      <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
        onClick={() => u.disabled ? setDisabled(false)
          : confirmSheet({ title: 'Disable ' + u.name + '?', message: 'They are signed out everywhere and can no longer sync or log in until re-enabled. Their data stays.', confirmText: 'Disable', danger: true, onConfirm: () => setDisabled(true) })}>
        {u.disabled ? 'Enable account' : 'Disable account'}</button>
      <div className="adm-hint">{u.disabled ? 'Enabling lets them sign in and sync again.' : 'Disabling signs them out everywhere and blocks sign-in. Nothing is deleted.'}</div>
      {/* The one destructive action in the app (issue #107), so it asks twice and offers the
          export first — that history is theirs. The second step names the account again, because
          the first sheet can be dismissed by anyone who was not reading. */}
      <button className="btn danger" style={{ margin: '14px 0 4px' }}
        onClick={() => confirmSheet({
          title: 'Delete ' + u.name + '?',
          message: 'Everything goes: their workouts, weigh-ins, routines, passkeys and notifications. This cannot be undone, and the invite code they joined with stays used. Download their data first if they might want it.',
          confirmText: 'Continue',
          danger: true,
          onConfirm: () => confirmSheet({
            title: 'Delete ' + u.name + ' for good?',
            message: 'Last chance. There’s no undo and no backup of this on the server.',
            confirmText: 'Delete account',
            danger: true,
            onConfirm: doDelete,
          }),
        })}>Delete account</button>
      <button className="btn" style={{ marginBottom: 4 }} onClick={exportUser}>Download their data</button>
      <div className="adm-hint">Deleting removes the account and every trace of its training history from this server.</div>

    </>}
    <h4 className="sec">Workout history</h4>
    {workouts.length ? <div className="list" style={{ gap: 0 }}>
      {workouts.slice(0, 60).map((w: any) => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w, createExerciseIndex(d.customEx)), d.unit)}</span>
      </div>)}
    </div> : <div className="adm-empty">No workouts logged.</div>}
  </>
}

function InvitesCard({ invites, reload, inviteOnly, valid }: any) {
  const toast = useUI((s: any) => s.toast)
  const gen = () => adminApi(valid,'/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { copyText(invite.code).catch(() => {}); toast('Code ' + invite.code + ' created & copied'); reload() })
    .catch((e: any) => toast(e.message))
  const revoke = (code: any) => confirmSheet({
    title: 'Revoke code ' + code + '?', message: 'Anyone who has it can no longer use it. People who already signed up with it are not affected.',
    confirmText: 'Revoke', danger: true,
    onConfirm: () => adminApi(valid,'/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
      .then(() => { toast('Code revoked'); reload() }).catch((e: any) => toast(e.message))
  })
  const copy = (code: any) => { copyText(code).catch(() => {}); toast('Copied ' + code) }
  const open = (invites || []).filter((i: any) => !i.usedBy)
  const used = (invites || []).filter((i: any) => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Invite codes</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">New code</Button></div>
    <div className="adm-lead">
      {inviteOnly
        ? 'Sign-up is invite-only: someone needs one of these codes to create a profile. Each code works once.'
        : 'Sign-up is open, so codes are optional here. They only record who invited whom.'}
    </div>
    {open.length ? <>
      <div className="adm-group-t">Unused · tap to copy</div>
      {open.map((i: any) => <div key={i.code} className="row between" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <button className="adm-code" onClick={() => copy(i.code)} aria-label={'copy ' + i.code}>{i.code}</button>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn adm-iconbtn" onClick={() => copy(i.code)} aria-label="copy"><Icon name="copy" /></button>
          <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
        </div>
      </div>)}
    </> : null}
    {used.length ? <>
      <div className="adm-group-t" style={{ marginTop: open.length ? 12 : 0 }}>Already used</div>
      {used.map((i: any) => <div key={i.code} className="row between dim" style={{ padding: '6px 0', fontSize: '.82rem' }}>
        <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', letterSpacing: '.06em' }}>{i.code}</span><span>→ {i.usedByName || 'used'}</span>
      </div>)}
    </> : null}
    {!open.length && !used.length && <div className="adm-empty">No codes yet. "New code" makes one and copies it to your clipboard.</div>}
  </div>
}

// Who signed in, who tried and failed, what an admin changed. A card rather than its own route:
// the dashboard is deliberately one page of cards, and the 95 % use of this is a glance at the
// last twenty events. Paging follows Library.jsx's house style — "Show more", not page numbers.
function AuditCard({ tick, valid }: any) {
  const toast = useUI((s: any) => s.toast)
  const [meta, setMeta] = useState<any>(null)      // last response minus the rows: total, retention, …
  const [rows, setRows] = useState<any[]>([])
  const [cat, setCat] = useState('')

  const load = (c: string, before?: string) => adminApi(valid,'/api/admin/audit?limit=50&cat=' + c + (before ? '&before=' + before : ''))
    .then((r: any) => { setMeta(r); setRows((x: any) => (before ? x.concat(r.events) : r.events)) })
    .catch((e: any) => toast(e.message))
  const pick = (c: any) => { setCat(c); setRows([]); setMeta(null); load(c) }
  // Reloads on mount and whenever the header's ↻ bumps the tick. Deliberately not on the 15s
  // poll that drives "training now": this is history, not presence.
  useEffect(() => { load(cat) }, [tick])

  const clear = () => confirmSheet({
    title: 'Clear the activity log?',
    message: 'Every recorded event is deleted. The clear itself is logged, so the gap stays visible.',
    confirmText: 'Clear', danger: true,
    onConfirm: () => adminApi(valid,'/api/admin/audit/clear', { method: 'POST', body: '{}' })
      .then(() => { toast('Activity log cleared'); pick(cat) }).catch((e: any) => toast(e.message))
  })

  if (meta && !meta.enabled) return null      // AUDIT_LOG=0 — the card isn't there at all

  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Activity log</h2>
      <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={clear} aria-label="clear log"><Icon name="trash" /></button></div>
    <div className="adm-lead">
      Who signed in, what failed, and what an admin changed.
      {meta ? ' ' + fmtNum(meta.total) + ' events'
        + (meta.retention.days ? ', kept for ' + meta.retention.days + ' days' : '')
        + (meta.ip_mode === 'off' ? ', without IP addresses' : '') + '.' : ''}
    </div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {[['', 'All'], ['auth', 'Sign-ins'], ['admin', 'Admin'], ['fail', 'Failed']].map(([v, l]) =>
        <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{l}</button>)}
    </div>
    {rows.map((e: any) => {
      const line = auditLine(e)
      return <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="grow">
          <div className="small" style={{ fontWeight: 600 }}>{line.title}
            {/* a red pill, not a red row: twenty fumbled Face IDs in a row shouldn't read as an incident */}
            {!e.ok && <span className="adm-pill bad" style={{ marginInlineStart: 6 }}>failed</span>}
            {auditCat(e.ev) === 'admin' && <span className="adm-pill acc" style={{ marginInlineStart: 6 }}>admin</span>}</div>
          {line.sub && <div className="dim" style={{ fontSize: '.72rem' }}>{line.sub}</div>}
        </div>
        <span className="small muted" style={{ flex: 'none', marginInlineStart: 8 }}>{fmtWhen(e.ts, meta?.now)}</span>
      </div>
    })}
    {meta && !rows.length && <div className="adm-empty">Nothing logged yet.</div>}
    {meta?.nextBefore && <div style={{ marginTop: 10 }}>
      <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>Show more</Button></div>}
  </div>
}

export default function Admin() {
  const valid=useSheetContext({updater:true})
  const nav = useNavigate()
  const user = useStore((s: any) => s.user)
  const openSheet = useUI((s: any) => s.openSheet)
  const [users, setUsers] = useState<any>(null)
  const [usersErr, setUsersErr] = useState<any>(null)   // why the last load failed, until one succeeds
  const [invites, setInvites] = useState<any>(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it

  // A failed load, or an answer without a list, used to leave the page on "Loading…" for good —
  // with a toast every 15 seconds from the poll, or with nothing at all when the answer was
  // someone else's page. It says so where the list would be instead, and the poll (or ↻) keeps
  // trying; a list that did load stays up, marked as the last one that came through.
  const loadUsers = () => {if(!valid())return Promise.resolve();return adminApi(valid,'/api/admin/users')
    .then((d: any) => {
      if(!valid())return
      if (!Array.isArray(d?.users)) throw new Error('The server answered without a list of users.')
      setUsers(d.users); setInviteOnly(!!d.invite_only); setUsersErr(null)
    })
    .catch((e: any) => {if(valid())setUsersErr(e.message || 'Failed to load')})}
  const loadInvites = () => {if(!valid())return Promise.resolve();return adminApi(valid,'/api/admin/invites').then((d: any) => {if(valid())setInvites(d.invites)}).catch(() => {})}
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => {
    if (!user?.admin || !valid()) return
    loadUsers(); loadInvites()
    const iv = setInterval(() => {
      if (!valid()) { clearInterval(iv); return }
      loadUsers()
    }, 15000)
    return () => clearInterval(iv)
  }, [user, valid])
  if (!user?.admin) return null

  const openUser = (id: any) => {if(valid())openSheet((close: any) => <UserDetail id={id} onChanged={loadUsers} close={close} contextValid={valid} />)}
  const liveUsers = (users || []).filter((u: any) => u.live)
  const activeCount = (users || []).filter((u: any) => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter((u: any) => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings/account')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 8 }}><h1 style={{ margin: 0 }}>Admin</h1>
        <div className="sub">{users ? users.length + ' users · ' + activeCount + ' active this week' : usersErr ? 'Could not load' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); setTick((n: any) => n + 1) }} aria-label="refresh">↻</button>
    </div>
    <div className="adm-intro">
      Everything about running this instance: who uses it, how they get in, and what has happened on it. Nothing here shows anyone's training data beyond counts.
    </div>

    {usersErr && <div className="card" role="alert" style={{ borderColor: 'var(--red)' }}>
      <div className="row between"><h2 style={{ margin: 0 }}>{users ? 'The last update failed' : 'Could not load the users'}</h2>
        <Button size="sm" icon="reset" onClick={loadUsers}>Try again</Button></div>
      <div className="adm-lead" style={{ marginBottom: 0 }}>
        {usersErr} {users ? 'The list below is the last one that loaded.' : 'It tries again every 15 seconds.'}
      </div>
    </div>}

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">Users</div><div className="v">{users ? users.length : '–'}</div></div>
      <div className="tile"><div className="l">Training now</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '–'}</div></div>
      <div className="tile"><div className="l">Active 7 days</div><div className="v">{users ? activeCount : '–'}</div></div>
      <div className="tile"><div className="l">Disabled</div><div className="v">{users ? disabledCount : '–'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 2px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />Training now</h2>
      <div className="adm-lead">Sessions running at this moment. Tap a name for details.</div>
      {liveUsers.map((u: any) => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · exercise {u.live.exIdx} of {u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} sets</div></div>
        <span className="adm-pill acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <InvitesCard invites={invites} reload={loadInvites} inviteOnly={inviteOnly} valid={valid} />

    <div className="card">
      <h2 style={{ margin: 0 }}>Users</h2>
      <div className="adm-lead">Everyone with a profile on this instance. Tap one to see their activity, to disable the account (nothing is deleted) or to delete it with all their data for good.</div>
      <div className="list">
        {(users || []).map((u: any) => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : undefined}>
          <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginInlineEnd: 5 }} />}{u.name} {u.admin && <span className="adm-pill acc" style={{ marginInlineStart: 4 }}>admin</span>}{u.disabled && <span className="adm-pill bad" style={{ marginInlineStart: 4 }}>disabled</span>}</div>
            <div className="ss">{u.live ? 'training now · ' + u.live.name : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout, false) : '') + ' · last sync ' + rel(u.lastSync)}</div></div>
          {u.hasPush && <Icon name="bell" aria-label="push notifications on" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
        </div>)}
        {users && !users.length && <div className="adm-empty">No users yet.</div>}
      </div>
    </div>

    <div style={{ marginTop: 14 }}><AuditCard tick={tick} valid={valid} /></div>
  </div>
}
