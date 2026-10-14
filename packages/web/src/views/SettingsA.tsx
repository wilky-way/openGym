import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
import { api, webauthnOK } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { clientCapabilities, clientPlatform } from '../lib/client-io'
import { settingsAServices } from '../lib/settings-a-services'
import { settingsAction, settingsTarget, settingsUpdate, type SettingsTarget } from '../lib/settings-target'
import { captureSheetContext } from '../lib/sheet-context'
import { ServerSyncSection, KeptChangesRows, leaveServer, passkeySignIn } from '../components/ServerSync'
import { PasskeysRow, DeviceLinkRow, usePasskeys, openDeviceLinkRedeem } from '../components/Passkeys'
import { DevicesRow, PairingSheet, PairRedeemSheet } from '../components/Devices'
import { RegisterSheet } from './Login'
import { showsConnection, showsLocalLine } from '../components/SyncBanner'
import { Section, Row, Button, Switch, SelectRow } from '../components/ui'
import { enablePush, disablePush, sendTestPush, syncPushSubscription, pushSupported } from '../lib/push'
import { hasPrivateProgrammes } from '@opengym/core/programme-import'
import { readZip } from '@opengym/core/zip'
import { todayISO } from '@opengym/core/format'
import { NUDGE_COPY, toneOf } from '@opengym/core/nudge'
import { t } from '../lib/i18n'
export { configureSettingsA } from '../lib/settings-a-services'
const toast = (message: string) => useUI.getState().toast(message)
const recoveryPointer = 'gym_state_v1_corrupt_key'
export async function exportSettingsBackup(target = settingsTarget()) {
  if (!settingsUpdate(target)) return
  const state = useStore.getState().S
  try {
    await settingsAServices().download(JSON.stringify(state, null, 2), 'opengym-backup-' + todayISO() + '.json')
    if (settingsUpdate(target)) toast(hasPrivateProgrammes(state) ? 'Backup includes private program prescriptions and notes. Keep it for personal use.' : 'Backup exported')
  } catch { toast('Could not export the backup. The saved copy is still on this device.') }
}
/** No state/media writes before the person confirms and the captured scope is revalidated. */
export async function importSettingsBackup(file: File, target = settingsTarget()) {
  if (!settingsUpdate(target)) return
  let backup: StoreDocument
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4
    const json = zip ? (await readZip(file)).find(entry => entry.name === 'opengym-backup.json')?.blob : file
    if (!json) throw new Error('shape')
    backup = JSON.parse(await json.text())
    if (!backup || typeof backup !== 'object' || Array.isArray(backup) || !Array.isArray(backup.workouts) || !Array.isArray(backup.routines)) throw new Error('shape')
  } catch { toast('That file is not an openGym backup'); return }
  if (!settingsUpdate(target)) return
  const conflict = await useStore.getState().importConflict(backup)
  if (!settingsUpdate(target)) return
  const apply = (mergeWith: unknown) => {
    try {
      if (settingsAction(target, () => useStore.getState().importBackup(backup, { mergeWith, durable:true }))) toast('Backup imported')
    } catch { toast('Could not import the backup. Your previous data is kept.') }
  }
  if (conflict) {
    const n = conflict.workouts
    settingsAServices().menuSheet({ title: 'Import backup?', subtitle: n === 1
      ? 'The server has 1 workout that is not in this backup, logged since it was made or on another device. Replacing deletes it.'
      : `The server has ${n} workouts that are not in this backup, logged since it was made or on another device. Replacing deletes them.`,
    items: [{ icon: 'trash', label: 'Replace anyway', danger: true, onClick: () => apply(null) }, { icon: 'merge', label: 'Merge them in', onClick: () => apply(conflict) }, { icon: 'xmark', label: 'Cancel', onClick() {} }] })
  } else settingsAServices().confirmSheet({ title: 'Import backup?', message: 'This replaces all current data with the backup file.', confirmText: 'Import', danger: true, onConfirm: () => apply(null) })
}
function RecoveryCopy() {
  const [, refresh] = useState(0)
  const kv = clientPlatform().kv
  let key: string | null = null, raw: string | null = null
  try { key = kv.get(recoveryPointer); raw = key ? kv.get(key) : null } catch { /* storage unavailable */ }
  if (!key || !/^gym_state_v1\.corrupt-\d+(?:-\d+)?$/.test(key) || raw === null) return null
  const capturedKey = key, capturedRaw = raw
  const openExport = async () => {
    const target = settingsTarget(), same = () => kv.get(recoveryPointer) === capturedKey && kv.get(capturedKey) === capturedRaw
    if (!settingsUpdate(target, undefined, same)) return
    try { await settingsAServices().download(capturedRaw, capturedKey + '.txt'); if (settingsUpdate(target, undefined, same)) toast('Recovery copy exported') }
    catch { toast('Could not export the recovery copy. It is still on this device.') }
  }
  const remove = () => {
    const target = settingsTarget()
    settingsAServices().confirmSheet({ title: 'Delete recovery copy?', message: 'Deletes the unreadable saved record kept on this device. Export it first if you want to keep it.', confirmText: 'Delete copy', danger: true,
      onConfirm: () => {
        try {
          if (!settingsAction(target, () => { kv.remove(capturedKey); kv.remove(recoveryPointer) }, () => kv.get(recoveryPointer) === capturedKey && kv.get(capturedKey) === capturedRaw)) return
          refresh(n => n + 1); toast('Recovery copy deleted')
        } catch { toast('Could not delete the recovery copy.') }
      } })
  }
  return <Section title="Recovery copy" footer="An unreadable saved record was kept on this device.">
    <Row icon="download" title="Export recovery copy" onClick={openExport} />
    <Row icon="trash" title="Delete recovery copy" danger onClick={remove} />
  </Section>
}
export default function SettingsA(props: { page?: string }) {
  try { clientPlatform().server.baseUrl() } catch { return <ServerAddress /> }
  return <SettingsBody {...props} />
}
function SettingsBody({ page = 'account' }: { page?: string }) {
  const nav = useNavigate(), S = useStore(s => s.S), user = useStore(s => s.user)
  const passkeys = usePasskeys(!!user && page === 'account')
  const fileRef = useRef<HTMLInputElement>(null), importRef = useRef<HTMLInputElement>(null)
  const fileTarget = useRef<SettingsTarget | null>(null), appTarget = useRef<SettingsTarget | null>(null)
  const signout = (kind: 'signout' | 'everywhere') => {
    const target = settingsTarget()
    const document = JSON.stringify(useStore.getState().S)
    const valid = captureSheetContext({updater:true,target:draft=>JSON.stringify(draft)===document})
    settingsAServices().confirmSheet({ title: kind === 'signout' ? 'Sign out?' : 'Sign out everywhere?', confirmText: kind === 'signout' ? 'Sign out' : 'Sign out everywhere', danger: true,
      message: (kind === 'signout'
        ? 'Your data is removed from this browser; your profile on the server keeps it. First it checks that the server has every change. If not, you choose what happens to them.'
        : 'Signs this profile out on every device, including this one. Your passkeys keep working, so you can sign in with them again anytime.')
        + (S.active ? ' You have a workout running. It waits on this device until you’re back on this account.' : ''),
      onConfirm: () => {
        if (!valid()) return
        return leaveServer(kind, { valid, exportBackup: () => exportSettingsBackup(target), done: r => {
          nav('/home')
          if (r.stashed) toast('The changes your server has not seen are kept on this device, and added back when it connects as this account again.')
          else if (kind === 'everywhere') toast('Signed out on all devices')
        } })
      } })
  }
  const reset = () => {
    const target = settingsTarget()
    settingsAServices().confirmSheet({ title: 'Reset everything?', message: user
      ? 'Deletes your plan, workouts, body weight, photos and videos from your profile on this server and on every signed-in device. This cannot be undone.'
      : 'Deletes your plan, workouts, body weight, photos and videos on this device. This cannot be undone.', confirmText: 'Delete everything', danger: true,
      onConfirm: async () => {
        try {
          let pending: Promise<unknown> | undefined
          if (!settingsAction(target, () => { pending = useStore.getState().resetEverything({durable:true}) })) return
          const resetContent = (draft: StoreDocument) => JSON.stringify({...draft,resetIds:null,_ts:0})
          const expected = resetContent(useStore.getState().S)
          const valid = captureSheetContext({updater:true,target:draft=>resetContent(draft)===expected})
          await pending
          if (valid()) { nav('/home'); toast('All data reset') }
        } catch { toast('Could not finish resetting your data. Your saved copy is kept.') }
      } })
  }
  const read = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]; ev.target.value = ''
    if (file && fileTarget.current) void importSettingsBackup(file, fileTarget.current)
  }
  if (page === 'data') return <>
    <Section title="Back up">
      {hasPrivateProgrammes(S) && <p className="sect-f">Exports include private program prescriptions and notes. Keep them for personal use.</p>}
      <Row icon="share" title="Export backup (JSON)" accessory="chevron" onClick={() => exportSettingsBackup()} />
    </Section>
    <Section title="Bring data in">
      <Row icon="download" title="Import backup" accessory="chevron" onClick={() => { fileTarget.current = settingsTarget(); fileRef.current?.click() }} />
      <Row icon="download" title="Import from another app" subtitle="FitNotes, Strong, Hevy, or body weight from Apple Health" accessory="chevron" onClick={() => { appTarget.current = settingsTarget(); importRef.current?.click() }} />
      <Row icon="key" title="Import from Hevy" subtitle="Pull your history with a Hevy Pro API key" accessory="chevron" onClick={() => settingsAServices().importFromHevy(settingsTarget())} />
    </Section>
    <RecoveryCopy />
    <Section><Row icon="trash" title="Reset everything" danger onClick={reset} /></Section>
    <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={read} />
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" hidden onChange={ev => {
      const file = ev.target.files?.[0]; ev.target.value = ''
      if (file && appTarget.current && settingsUpdate(appTarget.current)) settingsAServices().importFromApp(file, appTarget.current)
    }} />
  </>
  if (page === 'reminders') return user ? <PushCard /> : null
  if (page !== 'account') return null
  const remote = !!clientPlatform().server.baseUrl()
  return <>
    {user && <ServerSyncSection />}
    <ServerAddress />
    <Section title="Account">
      {user ? <>
        {user.admin && <Row icon="crown" title="Admin dashboard" accessory="chevron" onClick={() => nav('/admin')} />}
        <PasskeysRow state={passkeys.st} changed={() => { void passkeys.load() }} />
        <DeviceLinkRow state={passkeys.st} />
        <Row icon="qr" title="Pair an agent or device" subtitle="Create a one-time code for an agent or device." accessory="chevron" onClick={() => useUI.getState().openSheet(close => <PairingSheet close={close} />)} />
        <DevicesRow />
        <Row icon="signOut" title="Sign out" danger onClick={() => signout('signout')} />
        <Row icon="shield" title="Sign out everywhere" subtitle="Ends this profile’s sessions on all your devices." danger onClick={() => signout('everywhere')} />
        <AccountIdRow id={user.id} />
      </> : <>
        {!remote && webauthnOK() ? <>
          <Row icon="plusCircle" title="Create passkey profile" subtitle="Keeps your data safe and separate per person." accessory="chevron" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)} />
          <Row icon="fingerprint" title="Sign in with passkey" accessory="chevron" onClick={passkeySignIn} />
          <Row icon="qr" title="Use a code from your other device" accessory="chevron" onClick={openDeviceLinkRedeem} />
        </> : <Row icon="lock" title={remote ? 'Use a pairing code to connect to this server.' : 'Passkeys not supported in this browser.'} />}
        <Row icon="qr" title="Pair this device" accessory="chevron" onClick={() => useUI.getState().openSheet(close => <PairRedeemSheet close={close} />)} />
        <KeptChangesRows />
      </>}
    </Section>
    {!user && !(showsConnection(S) && showsLocalLine(S)) && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>Guest mode: your data lives only in this browser.</p>}
  </>
}
function AccountIdRow({ id }: { id: string }) {
  if (!id) return null
  return <Row icon="personCircle" title="Account ID" subtitle={<span className="acct-id">{id}</span>} onClick={async () => {
    const target = settingsTarget()
    if (settingsUpdate(target) && await copyText(id) && settingsUpdate(target)) toast('Account ID copied')
  }} />
}
/** A malformed saved endpoint must be recoverable without trying to call that endpoint. */
function ServerAddress() {
  const raw = clientPlatform().kv.get('gym_server_url')
  let malformed = false
  try { clientPlatform().server.baseUrl() } catch { malformed = true }
  if (!raw || !malformed) return null
  const reset = () => {
    const target = settingsTarget(), value = raw
    settingsAServices().confirmSheet({ title: 'Reset server address?', message: 'Use the server hosting this app again. Your saved workout data is kept.', confirmText: 'Reset address', onConfirm: () => {
      try {
        if (!settingsAction(target, () => clientPlatform().kv.remove('gym_server_url'), () => clientPlatform().kv.get('gym_server_url') === value)) return
        clientPlatform().nav.reload()
      } catch { toast('Could not reset the server address. Your saved data is kept.') }
    } })
  }
  return <Section title="Server"><Row icon="globe" title="Invalid server address" subtitle={raw} /><Row icon="reset" title="Reset server address" onClick={reset} /></Section>
}
export function PushCard() {
  const S = useStore(s => s.S), user = useStore(s => s.user)
  // SelectRow keeps this callback when its picker opens; capture this rendered owner.
  const renderTarget = settingsTarget()
  const [on, setOn] = useState(false), [busy, setBusy] = useState(false)
  const supported = pushSupported()
  useEffect(() => {
    if (!supported) return
    let gone = false
    const target = settingsTarget()
    syncPushSubscription(() => !gone && settingsUpdate(target)).then(ok => { if (!gone && settingsUpdate(target)) setOn(ok) })
      .catch(() => clientCapabilities().push.ready().then(reg => reg.pushManager.getSubscription()).then(sub => { if (!gone && settingsUpdate(target)) setOn(!!sub) }).catch(() => {}))
    return () => { gone = true }
  }, [supported, user])
  const patch = (change: Record<string, unknown>) => settingsUpdate(renderTarget, draft => { draft.reminder = { ...draft.reminder, ...change, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })
  const toggle = async (value: boolean) => {
    const target = settingsTarget(); if (!settingsUpdate(target)) return
    setBusy(true)
    try { if (value) await enablePush(() => settingsUpdate(target)); else await disablePush(() => settingsUpdate(target)); if (settingsUpdate(target)) { setOn(value); toast(value ? 'Notifications on' : 'Notifications off') } }
    catch { toast('Could not change notification settings') } finally { setBusy(false) }
  }
  if (!supported) return <Section title="Notifications"><Row icon="bellSlash" title="Not supported in this browser." /></Section>
  return <>
    <Section title="Notifications" footer={on && S.reminder?.on ? "Only sent on days you have a routine planned and haven't logged a workout yet." + (S.reminder.tz ? ` Timezone: ${S.reminder.tz} (auto-detected, updates if you travel).` : '') + (S.reminder.nudge ? ' One nudge in the evening of a planned day with nothing logged, between 20:00 and 21:30. After 3 missed days in a row it goes quiet until your next workout.' : '') : null}>
      <Row icon="bell" title="Push notifications" subtitle="Rest-timer alerts, even if openGym is closed."><Switch checked={on} disabled={busy} onChange={toggle} /></Row>
      {on && <Row icon="calendar" title="Workout day reminder"><Switch checked={!!S.reminder?.on} onChange={value => patch({ on: value })} /></Row>}
      {on && S.reminder?.on && <>
        <Row icon="clock" title="Reminder time"><input type="time" className="timef" value={S.reminder.time || '17:30'} onChange={ev => patch({ time: ev.target.value })} /></Row>
        <Row icon="bell" title="Nudge me when I skip a planned workout"><Switch checked={!!S.reminder.nudge} onChange={nudge => patch({ nudge })} /></Row>
        {S.reminder.nudge && <SelectRow icon="chat" title="Nudge tone" value={toneOf(S.reminder)} options={[{ value: 'friendly', label: 'Friendly', subtitle: t(NUDGE_COPY.friendly.title) }, { value: 'guilt', label: 'Guilt trip', subtitle: t(NUDGE_COPY.guilt.title) }, { value: 'drill', label: 'Drill sergeant', subtitle: t(NUDGE_COPY.drill.title) }]} onChange={tone => patch({ tone })} />}
      </>}
    </Section>
    {on && <Button icon="bell" onClick={async () => { const target = settingsTarget(); if (!settingsUpdate(target)) return; try { await sendTestPush(() => settingsUpdate(target)); if (settingsUpdate(target)) toast('Test sent! Should pop up any second') } catch { toast('Test failed') } }}>Send test notification</Button>}
  </>
}
