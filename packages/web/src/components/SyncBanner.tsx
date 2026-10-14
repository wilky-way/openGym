import type { ClientError } from '../lib/api'
import { ux } from '../platform/ux'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { t } from '../lib/i18n'
import { connectionView, actionLabel, syncNowWithToast, signInAgain, useOnline } from './ServerSync'
import Icon from './Icon'

// How long a change may sit unsent while the server is reachable before it is worth a word: the
// push after an edit, or the one boot owes, lands well within this, and saying "not synced" for
// every one of them would only teach people to ignore the line.
export const PENDING_GRACE_MS = 5000

/* The connection, always in view while the app is not connected to a server: offline, the server
   unreachable or answering with an error (its HTTP code, for whoever runs it), a server that no
   longer accepts this device, an answer that is not openGym's, and a guest in a browser. A
   problem cannot be dismissed; it goes when the condition does — or when Settings → "Show
   connection status" is off, and then a dot on Home says a problem is there. The guest line alone
   has an ×, which hides it for good (#454): no server is a choice there, not a fault. The others say what is wrong and that the changes are kept here,
   with the one thing to do about it (retry or sign in).

   Pinned under the status bar, above the page and the pinned workout headers, below the
   tab bar, the timer and every sheet. Its height goes into --conn on the root, which the page's
   top padding and those headers add in, so it takes its own room instead of covering a control.
 */
// What the indicator would say right now, and whether it would say it: shared by the banner and
// by the dot that stands in for it when the banner is switched off (useConnectionTrouble).
function useConnection() {
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  const guest = useStore(s => s.isGuest())
  const online = useOnline()
  const [waited, setWaited] = useState(false)
  const status = sync?.status
  useEffect(() => {
    setWaited(false)
    if (status !== 'pending') return
    const tm = setTimeout(() => setWaited(true), PENDING_GRACE_MS)
    return () => clearTimeout(tm)
  }, [status])

  const view = connectionView(sync, { online })
  // Signed out on the web, the sign-in screen is the whole app: it hears only that the server
  // ended the session, and that the changes are still here.
  const show = !!view?.banner && (!!user || guest || status === 'auth') && (status !== 'pending' || waited)
  return { view, show, user, status }
}

// "Show connection status" (#369, #330): on by default, and an older profile without the key
// reads as on. Off hides the banner but a sync that is stuck still has to be noticed somewhere.
export const showsConnection = (S?: {connStatus?: boolean}) => S?.connStatus !== false

// The quiet "no server" line (#454): a guest has chosen that, and a line
// saying so on every screen, for good, is a nag. Its × sets this off; offline, an error or a
// refusal still show, since only the 'quiet' tone is ever hidden by it.
export const showsLocalLine = (S?: {connLocal?: boolean}) => S?.connLocal !== false

/* True while the banner is switched off and the connection has a problem worth seeing: offline,
   the server unreachable or answering with an error, refusing this device, a sign-in question
   still open, or changes waiting past the grace period. Never for a device with no server at all
   (a guest): that is a choice, not a fault. The Home tab and the Settings
   gear carry a dot for it. */
export function useConnectionTrouble() {
  const on = useStore(s => showsConnection(s.S))
  const { view, show } = useConnection()
  return !on && show && (view?.tone === 'off' || view?.tone === 'bad' || view?.tone === 'wait')
}

export default function SyncBanner() {
  const nav = useNavigate()
  const on = useStore(s => showsConnection(s.S))
  const local = useStore(s => showsLocalLine(s.S))
  const update = useStore(s => s.update)
  const conn = useConnection()
  const { view, user, status } = conn
  const quiet = view?.tone === 'quiet'
  const show = conn.show && on && (!quiet || local)
  const row = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = ux().document?.documentElement
    if (!root) return
    const el = row.current
    if (!show || !el) { root.style.removeProperty('--conn'); return }
    const fit = () => root.style.setProperty('--conn', el.offsetHeight + 'px')
    fit()
    const ro = (() => { const Observer = (ux().window as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver; return Observer ? new Observer(fit) : null })()
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--conn') }
  }, [show])

  if (!show || !view) return null
  const act = view.action ? {
    retry: () => { syncNowWithToast() },
    // Signed in, or with a session the server ended: the passkey right here. A guest goes to
    // Settings, where signing in sits next to creating a profile.
    signin: () => (user || status === 'auth' ? signInAgain() : nav('/settings/account')),
  }[view.action] : undefined
  const label = actionLabel(view)
  const inner = <>
    <Icon name={view.icon} />
    <span className="conn-t">{view.banner}</span>
    {act && label && <span className="conn-a">{label}</span>}
  </>
  return <div className={'conn-bar ' + view.tone}>
    <div className="conn-row" ref={row} role="status" aria-live="polite">
      {act ? <button className="conn" onClick={act}>{inner}</button> : <div className="conn">{inner}</div>}
      {/* Connecting or signing in is still in Settings, so hiding the line takes nothing away. */}
      {quiet && <button type="button" className="conn-x" aria-label={t('Close')} onClick={() => update(s => { s.connLocal = false })}><Icon name="xmark" /></button>}
    </div>
  </div>
}
