import { useEffect, useRef, useState } from 'react'
import type { Proof } from '@opengym/contract/http/api'
import { t } from '@opengym/core/i18n-core'
import { useStore } from '../store/useStore'
import { passkeyAssertion, webauthnOK, type ClientError } from '../lib/api'
import { Button } from './ui'
export function proofError(e?: ClientError | null): string {
  if (e?.status === 429 || e?.data?.code === 'locked') {
    const seconds = Number(e.data?.retryAfter) || 60
    const n = seconds < 60 ? Math.max(1, Math.round(seconds)) : seconds < 3600 ? Math.ceil(seconds / 60) : Math.ceil(seconds / 3600)
    const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : 'hour'
    return t('Too many attempts. Try again {0}.', new Intl.RelativeTimeFormat('en-US', { numeric: 'always' }).format(n, unit))
  }
  if (e?.data?.code === 'passkey') return t('Your passkey could not be confirmed.')
  return t('Could not confirm that it is you. Try again.')
}
export const notReached = (e?: ClientError) => e?.status == null || e.status >= 500
export function useAgainOnceReached(unreached: boolean, load: () => unknown): void {
  const reachedAt = useStore(s => s.sync?.lastSynced)
  useEffect(() => { if (unreached) load() }, [reachedAt])
}
/** Passkey-only owner proof. A closed sheet cannot submit a late ceremony. */
export function ProveOwner({ passkey, onProof, explain = proofError, danger = false, valid }: {
  passkey: boolean; onProof(proof: Proof): Promise<unknown>; explain?(e: ClientError): string; danger?: boolean; submitText?: string; valid?(): boolean
}) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null)
  const live = useRef(true), prompt = useRef<AbortController | null>(null)
  useEffect(() => { live.current = true; return () => { live.current = false; prompt.current?.abort() } }, [])
  const run = async () => {
    if (prompt.current || (valid && !valid())) return
    const ctl = new AbortController(); prompt.current = ctl
    setBusy(true); setErr(null)
    try { const body = await passkeyAssertion({ signal: ctl.signal }); if (live.current && (!valid || valid())) await onProof(body) }
    catch (caught) { const e = caught as ClientError; if (live.current && e.name !== 'AbortError' && e.name !== 'NotAllowedError') setErr(explain(e)) }
    finally { if (prompt.current === ctl) prompt.current = null; if (live.current) setBusy(false) }
  }
  const available = passkey && webauthnOK()
  return <>
    {available ? <Button variant={danger ? 'danger' : 'primary'} icon="fingerprint" disabled={busy} onClick={run}>{t('Confirm with a passkey')}</Button>
      : <div className="dim small">{passkey ? t('This browser cannot confirm with your passkey. Do this on a device that holds one.') : t('This profile has no passkey, and this server does not take passwords, so nothing here can confirm that it is you. Ask your admin.')}</div>}
    {err && <div role="alert" className="small" style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
  </>
}

/** Never render untrusted server/browser error text from an authentication exchange. */
export function safeLoginError(e: ClientError, fallback: string): string {
  switch (e.data?.code) {
    case 'invite': return t('That invite code is not valid.')
    case 'unknown-credential': return t('This server doesn’t know that passkey. Make a profile first.')
    case 'disabled': return t('This account has been disabled.')
    case 'challenge-expired': return t('That took a little too long. Give it another go.')
    default: return fallback
  }
}
