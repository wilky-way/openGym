import { authenticate } from '../lib/auth-transactions'
import { useSheetContext } from '../lib/sheet-context'
import { PairRedeemSheet } from './Devices'
import { clientPlatform } from '../lib/client-io'
import { safeLoginError } from './PasskeyProof'
import type { ReactNode } from 'react'
import type { StoreState } from '../store/useStore'
export interface SyncViewState { localDurability?: 'saved' | 'journal' | 'memory'; remoteRecovery?: 'pending' | 'unavailable' | 'confirmed'; status: string; lastError?: {code?: string; status?: number} | null; pending?: boolean; server?: string; lastSynced?: number }
export interface ConnectionView { tone: 'ok' | 'wait' | 'off' | 'bad' | 'quiet'; icon: string; line: string; banner: string | null; action: 'retry' | 'signin' | null; label?: string | null }
type LeaveKind = 'signout' | 'everywhere'
export interface LeaveResult { owed?: boolean; stashed?: boolean; count?: number | null; [key: string]: unknown }
interface LeaveServices { exportBackup(): unknown; exportBackupZip?(): unknown; done(r: LeaveResult): void; valid?(allowSignedOut?: boolean): boolean }
import type { ClientError } from '../lib/api'
import { ux } from '../platform/ux'
// The connection to the server, as the screens show it and act on it: the persistent indicator
// (SyncBanner.jsx), the "Server & sync" block in Settings, and the question a sign-out asks when the server has not got everything yet. The store decides the state
// (useStore.js, `sync` — see statusOf there); this file only words it and offers what to do.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { t, tn } from '../lib/i18n'
import { fmtAgo, changeCount } from '@opengym/core/format'
import { passkeyLogin, webauthnOK } from '../lib/api'
import { authUiServices, askAddDeviceData, menuSheet } from '../lib/auth-ui-services'
import { Section, Row, Button } from './ui'

const ui = () => useUI.getState()
const toast = (m: string) => ui().toast(m)
// Passkeys are the only browser sign-in method.
const usesPairing = () => !!clientPlatform().server.baseUrl()
const canSignIn = () => usesPairing() || webauthnOK()

// "gym.example.com" out of the base URL the store keeps (a subpath stays: it is part of which
// server this is). Anything unparseable is shown as it is.
export const hostOf = (base?: string) => {
  try { const u = new URL(base || ''); return u.host + u.pathname.replace(/\/$/, '') } catch { return base || '' }
}

export const isOnline = () => ux().window?.navigator.onLine !== false
// The same, for a screen that has to change its words when the network comes or goes.
export function useOnline() {
  const [online, setOnline] = useState(isOnline)
  useEffect(() => {
    const on = () => setOnline(isOnline())
    ux().window?.addEventListener('online', on)
    ux().window?.addEventListener('offline', on)
    return () => { ux().window?.removeEventListener('online', on); ux().window?.removeEventListener('offline', on) }
  }, [])
  return online
}

// Present connection status and a recovery action for this browser.
export function connectionView(sync: SyncViewState | null | undefined, { online = isOnline() } = {}): ConnectionView | null {
  if (!sync) return null
  if (sync.localDurability && sync.localDurability !== 'saved') return {tone:'bad', icon:'warning', line:t('Can’t save on this device'), banner:sync.localDurability === 'journal' ? t('Can’t save on this device. Workout recovery is saved separately; finish or export to keep it.') : t('Can’t save on this device. Workout kept in memory; keep this page open and finish or export.'), action:null}
  const err = sync.lastError || {}
  // A device that says it has no network is offline whatever the last request found: said the
  // moment it goes, not at the next sync attempt, which may be a poll away. Only the states that
  // claim a working connection give way; a refusal or an error keeps its own words.
  const status = !online && (sync.status === 'ok' || sync.status === 'pending') ? 'offline' : sync.status
  switch (status) {
    case 'ok':
      return { tone: 'ok', icon: 'cloud', line: t('All synced'), banner: null, action: null }
    case 'pending':   // the sentence already says "tap to retry": no second word for it
      return { tone: 'wait', icon: 'reset', line: t('Waiting to sync'), banner: t('Not synced yet. Tap to retry.'), action: 'retry', label: null }
    // A sign-in's question about this device's workouts is still open (useStore adoptProfile):
    // nothing syncs until it is answered, and "retry" — Sync now — asks it again.
    case 'held':
      return { tone: 'wait', icon: 'reset', line: t('Waiting for your answer about this device’s workouts'), banner: t('Nothing syncs until you say whether this device’s workouts go into your profile. Tap to answer.'), action: 'retry', label: null }
    case 'offline':
      if (online) return {
        tone: 'off', icon: 'cloudSlash', action: 'retry',
        line: err.code === 'timeout' ? t('The server did not answer in time.') : t('The server cannot be reached'),
        banner: sync.pending ? t('Your server can’t be reached. Your changes are saved on this device and sync once it answers again.') : t('Your server can’t be reached. Showing the last copy synced with it.'),
      }
      return {
        tone: 'off', icon: 'cloudSlash', action: 'retry',
        line: err.code === 'timeout' ? t('The server did not answer in time.') : t('Offline. The server can’t be reached'),
        banner: sync.pending ? t('Offline. Your changes are saved on this device and sync when you’re back online.') : t('Offline. Showing the last copy synced with the server.'),
      }
    case 'error':
      return err.code === 'bad-response'
        ? { tone: 'bad', icon: 'warning', action: 'retry', line: t('Not an openGym answer (HTTP {0})', err.status), banner: t('Your server’s address answered with something other than openGym (HTTP {0}). Your changes are kept here.', err.status) }
        : { tone: 'bad', icon: 'warning', action: 'retry', line: t('Server error (HTTP {0})', err.status), banner: t('Your server answered with an error (HTTP {0}). Your changes are kept here.', err.status) }
    case 'auth':
      return { tone: 'bad', icon: 'lock', action: 'signin', line: t('The server refuses this browser'), banner: t('Your server no longer accepts this browser. Your changes are kept here.'), ...(usesPairing() ? {label: t('Pair again')} : {}) }
    // Guests retain data in this browser until they sign in.
    default:
      return { tone: 'quiet', icon: 'lock', action: canSignIn() ? 'signin' : null, line: t('Guest mode: your data lives only in this browser.'), banner: t('Guest mode: your data lives only in this browser.') }
  }
}

// The word on the indicator's button: the view's own `label` when it has one (null for none),
// else the action's.
export const actionLabel = (view: ConnectionView) => (view.label !== undefined ? view.label : (view.action === 'retry' ? t('Try again') : view.action === 'signin' ? t('Sign in') : null) || null)

// "Sync now": whatever is waiting goes, the server's copy is checked, and the answer is said.
export async function syncNowWithToast() {
  const sync = await useStore.getState().syncNow()
  const view = connectionView(sync)
  if (view) toast(view.line)
  return sync
}

// Re-sign-in merges this device’s saved account data through the adoption prompt.
export function signInAgain() {
  if (usesPairing()) return ui().openSheet(close => <PairRedeemSheet close={close} />)
  return passkeySignIn()
}
export async function passkeySignIn() {
  if (usesPairing()) return ui().openSheet(close => <PairRedeemSheet close={close} />)
  const st = useStore.getState(), server = clientPlatform().server.baseUrl()
  try {
    const u = await authenticate(passkeyLogin, () => useStore.getState().user === st.user && clientPlatform().server.baseUrl() === server, { adopt: true })
    if (!u) return
    await st.adoptProfile(askAddDeviceData)
    toast(t('Welcome back, {0}', u.name))
  } catch (caught) { const e = caught as ClientError; if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(safeLoginError(e, t('Sign-in failed'))) }
}

// Sign-out keeps unsynced changes or asks the user how to proceed.
const LEAVE = {

  signout: { run: (st: StoreState, o?: {force?: boolean;valid?():boolean}) => st.signOut(o), anyway: () => t('Sign out anyway'), failed: () => t('Couldn’t sign out. You’re still signed in.') },
  everywhere: { run: (st: StoreState, o?: {force?: boolean;valid?():boolean}) => st.signOutAll(o), anyway: () => t('Sign out anyway'), failed: () => t('Couldn’t sign out everywhere. You’re still signed in.') },
}
async function attempt(kind: LeaveKind, opts?: {force?: boolean;valid?():boolean}) {
  try { return await LEAVE[kind].run(useStore.getState(), opts) }
  catch (caught) { const e = caught as ClientError;   // only a local failure lands here (signOut swallows a failed logout request); each says which action it was
    toast(LEAVE[kind].failed())
    return null
  }
}
export async function leaveServer(kind: LeaveKind, { exportBackup, exportBackupZip, done, valid }: LeaveServices) {
  if (valid && !valid()) return
  const r = await attempt(kind, valid ? {valid} : undefined)
  if (valid && !valid(!r?.owed || !!r.stashed)) return
  if (!r) return
  if (r.owed && !r.stashed) {
    ui().openSheet(close => <OwedSheet kind={kind} count={r.count} exportBackup={exportBackup} exportBackupZip={exportBackupZip} done={done} close={close} valid={valid} />, { kind: 'center', locked: true })
    return
  }
  done(r)
}

// A sign-out must keep unsynced edits durably before clearing the local session.
export function OwedSheet({ kind, count: count0, exportBackup, done, close, valid: callerValid }: LeaveServices & { kind: LeaveKind; count?: number | null; close(): void }) {
  const contextValid = useSheetContext({ updater: !!callerValid })
  const valid = (allowSignedOut = false) => contextValid(allowSignedOut) && (!callerValid || callerValid(allowSignedOut))
  const sync = useStore(s => s.sync)
  const [count, setCount] = useState(count0)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const view = connectionView(sync)

  const refused = sync?.status === 'auth'
  const finish = (r: LeaveResult) => { close(); done(r) }
  const retry = async () => {
    if (!valid()) return
    setBusy(true)
    await useStore.getState().syncNow()
    // Past the refusals too, as the Settings row does: a proxy's limit or the server's caps may
    // have been fixed since, and a file refused for good would otherwise hold this sheet open on
    // every try.
    if (!valid()) { setBusy(false); return }
    const r = await attempt(kind, callerValid ? {valid:()=>valid()} : undefined)
    setBusy(false)
    if (!valid(true)) return
    if (!r) return
    if (!r.owed || r.stashed) return finish(r)
    setCount(r.count); setTried(true)
  }
  const anyway = async () => {
    if (!valid()) return
    setBusy(true)
    const r = await attempt(kind, { force: true, ...(callerValid ? {valid:()=>valid()} : {}) })
    setBusy(false)
    if (!valid(true)) return
    if (!r) return
    if (r.owed && !r.stashed) { toast(t('Couldn’t keep a copy of the changes on this device. Nothing was removed.')); return }
    finish(r)
  }
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{t('Not everything is on your server yet')}</h3>
    {true && <div style={{ marginBottom: 6, fontWeight: 600 }}>
      {(count ?? 0) > 0 ? t('Not on your server yet: {0}', changeCount(count!)) : t('Some changes on this device have not reached your server.')}
    </div>}
    {(tried || refused) && view && <div className="small" style={{ color: 'var(--red)', marginBottom: 6 }}>{view.line}</div>}
    {/* It names the button below it: Try again, or Pair again / Sign in where the server refuses. */}
    <div className="muted small" style={{ marginBottom: 18, lineHeight: 1.5 }}>
      {refused
        ? (t('Sign in again, or export a backup first. Going ahead anyway keeps a copy of these changes on this device until it connects to this server as this account again. Then they’re added back.'))
        : t('Try again, or export a backup first. Going ahead anyway keeps a copy of these changes on this device until it connects to this server as this account again. Then they’re added back.')}
    </div>

    {refused && canSignIn() && <><button className="btn primary" disabled={busy} onClick={() => { close(); signInAgain() }}>{usesPairing() ? t('Pair again') : t('Sign in with passkey')}</button><div style={{ height: 8 }} /></>}
    {!refused && <><button className="btn primary" disabled={busy} onClick={retry}>{busy ? t('Syncing…') : t('Try again')}</button><div style={{ height: 8 }} /></>}
    <Button icon="share" disabled={busy} onClick={() => { if (valid()) exportBackup() }}>{t('Export backup (JSON)')}</Button>
    <div style={{ height: 8 }} />
    <button className="btn danger" disabled={busy} onClick={anyway}>{LEAVE[kind].anyway()}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </div>
}

/* ---------------------------------------------------------------- Settings ------------------- */
const TINT = { ok: 'var(--green)', wait: 'var(--orange)', off: 'var(--grey)', bad: 'var(--red)', quiet: 'var(--grey)' }

export function ServerSyncSection({ children }: { children?: ReactNode }) {
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  useStore(s => s.S)   // the count of waiting changes follows every edit
  const unsynced = useStore(s => s.unsyncedChanges)
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  // "Last synced: 3 minutes ago" goes stale on an open screen; a re-render now and then keeps it true.
  const [, tick] = useState(0)
  useEffect(() => { const iv = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(iv) }, [])
  if (!user || !sync) return null
  const view = connectionView(sync, { online })!
  // While everything is fine, a change still in its short debounce is not news; once anything
  // is wrong, how much is waiting is exactly what the person needs.
  const owed = sync.status !== 'ok' && typeof unsynced === 'function' ? unsynced() : { owed: false }
  const sub = [
    sync.lastSynced ? t('Last synced: {0}', fmtAgo(sync.lastSynced)) : t('Not synced with this server yet'),
    owed.owed && (owed.count > 0 ? t('Not on your server yet: {0}', changeCount(owed.count)) : owed.count == null ? t('Some changes on this device have not reached your server.') : null),
  ].filter(Boolean).join(' · ')
  const now = async () => {
    if (busy) return
    setBusy(true)
    try { await syncNowWithToast() } finally { setBusy(false) }
  }
  return <Section title={t('Server & sync')}>

    <Row icon="globe" iconTint="var(--blue)" title={sync.server ? hostOf(sync.server) : t('Server address unknown')}
      subtitle={t('Signed in as {0}', user.name)} />
    <Row icon={view.icon} iconTint={TINT[view.tone]} title={view.line} subtitle={sub} className="sync-status" />
    <Row icon="reset" iconTint="var(--acc)" title={busy ? t('Syncing…') : t('Sync now')} onClick={now} />

    {sync.status === 'auth' && (canSignIn() && <Row icon={usesPairing() ? 'qr' : 'fingerprint'} iconTint="var(--blue)" title={usesPairing() ? t('Pair again') : t('Sign in with passkey')} subtitle={t('Your changes are kept here, and merged into your account once you are signed in again.')} accessory="chevron" onClick={signInAgain} />)}
    {/* another account's, kept when this one signed in over a copy that still owed them */}
    <KeptChangesRows />
    {children}
  </Section>
}

// The changes a forced sign-out or disconnect kept on this device, waiting for their server and
// account — so a device that went ahead anyway still says what it holds and for whom.
export function KeptChangesRows() {
  const kept = useStore(s => s.keptChanges)
  const rev = useStore(s => s.keptRev)
  const user = useStore(s => s.user)
  const [rows, setRows] = useState<{server: string; uid: string; name?: string}[]>([])
  // Asked again when the account changes and whenever the kept changes do — the ones handed
  // back on a sign-in go some moments after it.
  useEffect(() => {
    let gone = false
    if (typeof kept === 'function') kept().then((r: {server: string; uid: string; name?: string}[]) => { if (!gone) setRows(r || []) }).catch(() => {})
    return () => { gone = true }
  }, [kept, user?.id, rev])
  // A copy kept for an account that may never come back here (its server lost it, or it was
  // deleted) is saved as a backup file, to import into another profile with "Merge them in".
  const save = async (k: {server: string; uid: string; name?: string}, valid: () => boolean) => {
    if (!valid()) return
    try {
      const state = await useStore.getState().keptState(k.server, k.uid)
      if (!state || !valid()) return
      const json = JSON.stringify(state, null, 2)
      const name = 'opengym-kept-' + String(k.name || k.uid).replace(/[^\w-]+/g, '_') + '-' + new Date().toISOString().slice(0, 10) + '.json'
      await authUiServices().download(json, name)
      if (valid()) toast(t('Backup exported'))
    } catch { if (valid()) toast(t('Could not export the backup. The saved copy is still on this device.')) }
  }
  const openExport = (k: {server: string; uid: string; name?: string}) => {
    const owner = useStore.getState().user, server = clientPlatform().server.baseUrl()
    const valid = () => {
      const same = useStore.getState().user === owner && clientPlatform().server.baseUrl() === server
      if (!same) toast('The account changed. Open this action again.')
      return same
    }
    menuSheet({ title: t('Changes kept for {0}', k.name || k.uid), items: [{ icon: 'download', label: t('Save as a backup file'), onClick: () => save(k, valid) }] })
  }

  return rows.map(k => <Row key={(k.server || '') + '|' + k.uid} icon="history" iconTint="var(--orange)"
    title={t('Changes kept for {0}', k.name || k.uid)}
    subtitle={(k.server ? hostOf(k.server) + ' · ' : '') + t('Added back when this device connects as that account again.')}
    accessory="chevron"
    onClick={() => openExport(k)} />)
}
