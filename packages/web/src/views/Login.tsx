import { authenticate } from '../lib/auth-transactions'
import { useSheetContext } from '../lib/sheet-context'
import { clientPlatform } from '../lib/client-io'
import { PairRedeemSheet } from '../components/Devices'
import { safeLoginError } from '../components/PasskeyProof'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore, hasData } from '../store/useStore'
import { useUI } from '../store/useUI'
import { webauthnOK, passkeyLogin, passkeyRegister, bio, type ClientError } from '../lib/api'
import { guestAllowed } from '../lib/guest'
import { t } from '../lib/i18n'
import { askAddDeviceData } from '../lib/auth-ui-services'
import { openDeviceLinkRedeem } from '../components/Passkeys'
import Icon from '../components/Icon'
import { Button } from '../components/ui'
export function RegisterSheet({ close }: { close(): void }) {
  const valid = useSheetContext()
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false)
  const inviteOnly = !!config?.invite_only, ref = useRef<HTMLInputElement>(null)
  useEffect(() => { const timer = setTimeout(() => ref.current?.focus(), 250); return () => clearTimeout(timer) }, [])
  useEffect(() => { loadConfig() }, [loadConfig])
  const go = async () => {
    if (busy) return
    if (clientPlatform().server.baseUrl()) { useUI.getState().toast('Use a pairing code to connect to this server.'); return }
    const n = name.trim(), toast = useUI.getState().toast
    if (!n) { toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    setBusy(true)
    try {
      const u = await authenticate(() => passkeyRegister(n, code.trim()), () => live.current && valid())
      if (!u) return
      close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created, and this device’s data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (caught) { const e = caught as ClientError; if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(safeLoginError(e, t('Registration failed'))) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey lives on your device, so no password needed.', bio())}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <><div style={{ height: 10 }} /><input className="input" placeholder={t('Invite code')} maxLength={40} value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} /><div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div></>}
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go} disabled={busy || !webauthnOK()}>{t('Create passkey')}</Button>
  </>
}
export default function Login() {
  const valid = useSheetContext()
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const { setUser, adoptProfile, setGuest } = useStore(), config = useStore(s => s.config), canGuest = guestAllowed(config)
  const remote = !!clientPlatform().server.baseUrl()
  const register = () => useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  const signIn = async () => {
    try { const u = await authenticate(passkeyLogin, () => live.current && valid(), { adopt: true }); if (!u) return; await adoptProfile(askAddDeviceData); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (caught) { const e = caught as ClientError; if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(safeLoginError(e, t('Sign-in failed'))) }
  }
  const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }
  return <div className="narrow" style={wrap}>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
    <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
    {!remote && webauthnOK() ? <>
      <Button variant="primary" icon="fingerprint" onClick={signIn}>{t('Sign in with passkey')}</Button><div style={{ height: 10 }} />
      <Button icon="plusCircle" onClick={register}>{t('Create new profile')}</Button><div style={{ height: 10 }} />
      <Button variant="ghost" className="dim" icon="qr" onClick={openDeviceLinkRedeem}>{t('Use a code from your other device')}</Button>{canGuest && <div style={{ height: 4 }} />}
    </> : remote ? <div className="card small muted">Use a pairing code from your other device to connect to this server.</div> : <div className="card small muted" style={{ textAlign: 'start' }}>{canGuest ? t("This browser doesn't do passkeys, but you can still use openGym locally on this device.") : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</div>}
    <Button variant="ghost" className="dim" icon="qr" onClick={() => useUI.getState().openSheet(close => <PairRedeemSheet close={close} />)}>Pair this device</Button>
    {canGuest && <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>}
    <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0}. No passwords to remember.', bio())}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
  </div>
}
