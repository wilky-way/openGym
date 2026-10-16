import { authenticate } from '../lib/auth-transactions'
import { useSheetContext } from '../lib/sheet-context'
import { useEffect, useState, useRef, type FormEvent } from 'react'
import type { DeviceRow, Routes } from '@opengym/contract/http/api'
import { api, pairRedeem, setRemoteAuth } from '../lib/api'
import { askAddDeviceData } from '../lib/auth-ui-services'
import { clientPlatform } from '../lib/client-io'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button, Row } from './ui'
import { notReached, useAgainOnceReached } from './PasskeyProof'
type DeviceList = Routes['GET /api/account/devices']['res']
const date = (at: number | null) => at ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
/** Only allow the metadata contract into UI state; bearer values never enter render state. */
function deviceList(r: DeviceList): DeviceList {
  if (!Array.isArray(r?.devices) || typeof r.current !== 'string') throw new Error('Invalid device list')
  return { current: r.current, devices: r.devices.map(({id, name, kind, created, lastSeen, revokedAt}) => ({id, name, kind, created, lastSeen, revokedAt})) }
}
export function DevicesRow() {
  return <Row icon="person" title="Signed-in devices" subtitle="Rename a device or revoke its access." accessory="chevron" onClick={() => useUI.getState().openSheet(close => <DevicesSheet close={close} />)} />
}
export function DevicesSheet({ close }: { close(): void }) {
  const user = useStore(s => s.user), [st, setSt] = useState<DeviceList | null>(null), [error, setError] = useState<string | null>(null), [unreached, setUnreached] = useState(false)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const load = async () => {
    const owner = useStore.getState().user?.id
    try { const r = deviceList(await api<DeviceList>('/api/account/devices')); if (live.current && owner === useStore.getState().user?.id) { setSt(r); setError(null); setUnreached(false) } }
    catch (e) { if (live.current) { setError('Could not load devices. Try again.'); setUnreached(notReached(e as {status?: number})) } }
  }
  useEffect(() => { setSt(null); if (user) void load() }, [user?.id])
  useAgainOnceReached(unreached, load)
  return <><h3>Signed-in devices</h3>
    <div className="muted small">Revoking a device ends its access. Your workouts stay on your server and on this device.</div>
    {error && <div role="alert">{error}</div>}
    {st?.devices.map(device => <Row key={device.id} icon="person" title={device.name || 'Unnamed device'} subtitle={[device.kind, device.id === st.current && 'This device', device.revokedAt ? 'Revoked' : device.lastSeen ? 'Last seen ' + date(device.lastSeen) : 'Added ' + date(device.created)].filter(Boolean).join(' · ')} accessory="chevron" onClick={() => useUI.getState().openSheet(c => <DeviceSheet device={device} current={device.id === st.current} close={c} changed={load} />)} />)}
    <Button onClick={load}>Refresh</Button><Button onClick={close}>Done</Button>
  </>
}
function DeviceSheet({ device, current, close, changed }: { device: DeviceRow; current: boolean; close(): void; changed(): Promise<void> }) {
  const valid = useSheetContext()
  const [name, setName] = useState(device.name || ''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [error, setError] = useState<string | null>(null)
  const run = async (revoke: boolean) => {
    if (busy || !valid()) return
    setBusy(true); setError(null)
    const owner = useStore.getState().user, server = clientPlatform().server.baseUrl()
    const sameOwner = () => valid() && useStore.getState().user === owner && clientPlatform().server.baseUrl() === server
    try {
      if (revoke && current) {
        // Revocation changes authorization only. Keep the complete local profile and let
        // the sync engine mark this session refused; signing back in adopts that copy.
        await api('/api/account/devices/revoke', { method: 'POST', body: JSON.stringify({ id: device.id }) })
        if (!sameOwner()) return
        await useStore.getState().syncNow()

      } else await api('/api/account/devices/' + (revoke ? 'revoke' : 'rename'), { method: 'POST', body: JSON.stringify(revoke ? { id: device.id } : { id: device.id, name }) })
      if ((!current || !revoke) && sameOwner()) await changed()
      if (!sameOwner()) return
      close(); useUI.getState().toast(revoke ? 'Device access revoked' : 'Device renamed')
    } catch { setError(revoke ? 'Could not revoke this device. Your data was kept.' : 'Could not rename this device. Try again.') }
    finally { setBusy(false) }
  }
  return <><h3>{device.name || 'Device'}</h3>
    <input className="input" placeholder="Device name" maxLength={80} value={name} onChange={e => setName(e.target.value)} />
    {error && <div role="alert">{error}</div>}
    <Button disabled={busy} onClick={() => run(false)}>Save</Button>
    {!device.revokedAt && (confirm ? <><div className="muted small">{current ? 'Revoke this device? Its saved data stays here. You will need to sign in or pair again.' : 'Revoke this device? It will need to sign in or pair again.'}</div><Button variant="danger" disabled={busy} onClick={() => run(true)}>Confirm revoke</Button></> : <Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>Revoke access</Button>)}
    <Button disabled={busy} onClick={close}>Cancel</Button>
  </>
}
export function PairingRow() {
  return <Row icon="qr" title="Pair another device" subtitle="Create a code that signs another device in to this profile." accessory="chevron" onClick={() => useUI.getState().openSheet(close => <PairingSheet close={close} />)} />
}
export function PairingSheet({ close }: { close(): void }) {
  const valid = useSheetContext()
  const user = useStore(s => s.user)
  const [code, setCode] = useState<{value: string; user: typeof user; server: string} | null>(null), [expired, setExpired] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    const unsubscribe = clientPlatform().kv.subscribe(() => { if (code && clientPlatform().server.baseUrl() !== code.server) setCode(null) })
    return () => { live.current = false; unsubscribe() }
  }, [code])
  useEffect(() => { setCode(null) }, [user])
  useEffect(() => { if (!code) return; const timer = setTimeout(() => setExpired(true), 5 * 60000); return () => clearTimeout(timer) }, [code])
  const create = async () => {
    if (busy || !valid()) return
    setBusy(true); setError(false)
    try {
      const owner = useStore.getState().user, server = clientPlatform().server.baseUrl()
      const r = await api<Routes['POST /api/pair/create']['res']>('/api/pair/create', {method: 'POST', body: '{}'})
      if (live.current && useStore.getState().user === owner && clientPlatform().server.baseUrl() === server) { setCode({value: r.code, user: owner, server}); setExpired(false) }
    } catch { if (live.current) setError(true) } finally { if (live.current) setBusy(false) }
  }
  const visible = code && code.user === user && code.server === clientPlatform().server.baseUrl()
  return <><h3>Pair another device</h3><div className="muted small">Enter this one-time code on your other device. It works once and lasts 5 minutes.</div>
    {visible && !expired && <div className="card" dir="ltr">{code.value}</div>}{expired && <div>This code has expired.</div>}{error && <div role="alert">Could not create a code. Try again.</div>}
    <Button disabled={busy} onClick={create}>{visible ? 'Make a new code' : 'Create pairing code'}</Button><Button onClick={close}>Done</Button></>
}
export function PairRedeemSheet({ close }: { close(): void }) {
  const opened = useRef({user: useStore.getState().user, server: clientPlatform().server.baseUrl()})
  const [server, setServer] = useState(() => { try { return clientPlatform().server.baseUrl() } catch { return '' } }), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return
    let base: string
    try { const url = new URL(server.trim()); if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(); base = url.origin }
    catch { setError('Enter an HTTPS server address without a path or credentials.'); return }
    if (!code.trim()) { setError('Enter the code from your other device.'); return }
    setBusy(true); setError(null)
    try {
    const platform = clientPlatform(), previous = opened.current.server, user = opened.current.user
    if (useStore.getState().user !== user || platform.server.baseUrl() !== previous) { useUI.getState().toast('The account changed. Open this action again.'); return }
    if (base !== previous && platform.kv.get('gym_owner')) { setBusy(false); setError('This device still has an account’s saved copy. Finish signing out before changing servers. Your data is kept here.'); return }
    if (user && !(useStore.getState().sync?.status === 'auth' && base === previous)) { setBusy(false); setError('Sign out before pairing to another server. Your data will be kept.'); return }
      const result = await authenticate(async () => {
        const response = await pairRedeem(base, code.trim())
        if (!live.current || useStore.getState().user !== user || clientPlatform().server.baseUrl() !== previous) throw new Error('Pairing interrupted')
        await setRemoteAuth(base, response.token)
        return response.user
      }, () => live.current && useStore.getState().user === user && [previous, base].includes(clientPlatform().server.baseUrl()), { adopt: { alwaysAsk: true } })
      if (!result) return
      close(); await useStore.getState().adoptProfile(askAddDeviceData, { alwaysAsk: true })
      useUI.getState().toast('Device paired')
    } catch { if (live.current) setError('Could not pair this device. Check the address and use a fresh code. Your data is kept here.') }
    finally { if (live.current) setBusy(false) }
  }
  return <><h3>Pair this device</h3><div className="muted small">Only use a code from a device of your own. Pairing signs this device in to that profile; what you log here goes to it.</div><form onSubmit={submit}>
    <input className="input" type="url" placeholder="https://your-server.example" value={server} onChange={e => setServer(e.target.value)} />
    <input className="input" placeholder="Pairing code" autoComplete="one-time-code" value={code} maxLength={20} onChange={e => setCode(e.target.value.toUpperCase())} />
    {error && <div role="alert">{error}</div>}<Button type="submit" disabled={busy}>Pair device</Button><Button disabled={busy} onClick={close}>Cancel</Button>
  </form></>
}
