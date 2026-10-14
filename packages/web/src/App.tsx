import { ux } from './platform/ux'
import { captureSheetTarget } from './lib/sheet-target'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore'
import { useUI } from './store/useUI'
import { bindUI } from './components/ui'
import { setWeightDecimals } from '@opengym/core/format'
import { accentValue, applyAccent } from './lib/accent'
import { setLang, useLang, baseLang } from './lib/i18n'
import { effectiveLang } from './lib/default-lang'
import { setPlayOnSilent, setVibrate } from './lib/sound'
import { setNav } from './lib/nav'
import { useWakeLock } from './lib/wakelock'
import { installViewportGuard } from './lib/viewport-guard'
import { installChipDrag } from './lib/hchips'
import { syncPushSubscription } from './lib/push'
import { exitWorkoutEdit, startFlow } from './sheets'
import Icon from './components/Icon'
import TabBar from './components/TabBar'
import ErrorBoundary from './components/ErrorBoundary'
import Modals from './components/Modals'
import Toast from './components/Toast'
import SyncBanner from './components/SyncBanner'
import OwnershipRecovery from './components/OwnershipRecovery'
import RestTimer from './components/RestTimer'
import TimerFlash from './components/TimerFlash'
import { openDeviceLinkRedeem } from './components/Passkeys'
import Login from './views/Login'
import Home from './views/Home'
import CheckIn from './views/CheckIn'
import Plan from './views/Plan'
import RoutineEdit from './views/RoutineEdit'
import Workout from './views/Workout'
import Stats from './views/Stats'
import History from './views/History'
import Library from './views/Library'
import Muscles from './views/Muscles'
import StructuralBalance from './views/StructuralBalance'
import { SettingsRoute } from './views/Settings'
import Admin from './views/Admin'
import Measurements from './views/Measurements'

// last known scrollY per route, so back-navigation can put the page where it was
const scrollPositions = new Map<string | null, number>()

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = (theme: unknown) => theme === 'light' || theme === 'dark'
  ? theme
  : (ux().window!.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

export function applyPrefs(theme: unknown, accent: string) {
  const de = ux().document!.documentElement
  de.dataset.skin = 'logbook'
  de.dataset.theme = resolveTheme(theme)
  applyAccent(de, accent, de.dataset.theme)
  const meta = ux().document!.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#F2EBE8' : '#1A1415'

}

export function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const navType = useNavigationType()
  const { S, user, ready } = useStore()
  const recovery = useStore(s => s.sync?.recovery)
  // iOS: whether timer sounds get past the ring/silent switch (Settings → Sounds). Page-level,
  // so it is applied here on load and on change rather than at each beep.
  useEffect(() => { setPlayOnSilent(!!S.soundOnSilent) }, [S.soundOnSilent])
  // Settings → Vibrate, the same way: one page-level switch rather than a check at each buzz.
  useEffect(() => { setVibrate(S.vibrate !== false) }, [S.vibrate])
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav((to,opts)=>navigate(to,opts)) }, [navigate])
  const lastEditPath = useRef(loc.pathname)
  // Any in-app route exit, browser back included, returns to the persisted draft and asks for a
  // save decision. Reload needs no prompt because the draft itself is already in local storage.
  useEffect(() => {
    const previous = lastEditPath.current
    lastEditPath.current = loc.pathname
    // The live store, not this render's S: a save that just closed the editor may not have
    // reached this render yet, and asking again would offer to delete the workout it saved.
    if (previous !== '/workout' || !useStore.getState().S.active?.editingWorkoutId || loc.pathname === '/workout') return
    const destination = loc.pathname + loc.search
    navigate('/workout', { replace: true })
    exitWorkoutEdit(() => navigate(destination, { replace: true }))
  }, [loc.pathname, loc.search, S.active?.editingWorkoutId, navigate])
  // A preset key, or the user's own colour as '#rrggbb' (lib/accent.js), already checked.
  const accent = accentValue(S)
  useEffect(() => { applyPrefs(S.theme, accent!) }, [S.theme, accent!])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (S.theme !== 'system' || !ux().window!.matchMedia) return
    const mql = ux().window!.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(S.theme, accent!)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [S.theme, accent!])
  // A profile that never picked a language follows the instance default or the browser (#303) —
  // worked out here, on this device, and never written into the synced state (lib/default-lang.js).
  const config = useStore(s => s.config)
  const lang = effectiveLang(S, config)
  useEffect(() => { setLang(lang, S.enParens?.[baseLang(lang)] ?? true, S.enOnly?.[baseLang(lang)] === true) }, [lang, S.enParens, S.enOnly])
  // Same shape as the language: a module-level display setting, pushed when it changes (#139).
  useEffect(() => { setWeightDecimals(S.wdec) }, [S.wdec])
  useEffect(() => { ux().document!.documentElement.lang = lang }, [langV, lang])
  // Forward navigation starts at the top; going back lands where you left off.
  // The position is recorded from scroll events rather than read at route
  // change, because by then a shorter page may already have clamped it.
  const pathRef = useRef<string | null>(null)
  // iOS leaves the page displaced after the keyboard goes away (see lib/viewport-guard.js).
  useEffect(() => installViewportGuard(), [])
  // Click-drag a horizontal chip strip to scroll it sideways (lib/hchips.js) — on a desktop
  // browser there's otherwise no way to reach the filters past the edge.
  useEffect(() => installChipDrag(), [])
  // Once per signed-in boot, hand the server this browser's push subscription again (see
  // lib/push.js): a subscription the instance lost is back before the next reminder is due,
  // with nobody having to visit Settings. Web only — the APK has no service worker.
  useEffect(() => {
    if (!user || !ready || recovery) return
    const target = captureSheetTarget()
    let live = true
    syncPushSubscription(() => live && useStore.getState().user?.id === user.id && target()).catch(() => {})
    return () => { live = false }
  }, [user?.id, ready, recovery])
  // Opened from a device-link QR code (#95): once boot knows who is here, the sheet that redeems
  // it opens by itself — over the sign-in screen, or over the app for a guest or a signed-in
  // browser. Once per visit; closed, the code stays for the sign-in screen's own button.
  const linkCode = useStore(s => s.linkCode)
  const linkOffered = useRef(false)
  useEffect(() => {
    if (!ready || !linkCode || linkOffered.current) return
    linkOffered.current = true
    openDeviceLinkRedeem()
  }, [ready, linkCode])
  useEffect(() => {
    const onScroll = () => {
      // Modals pins the body while a sheet is open; scrollY is 0 then, not a position.
      if (ux().document!.body.style.position === 'fixed') return
      scrollPositions.set(pathRef.current, ux().window!.scrollY)
    }
    ux().window!.addEventListener('scroll', onScroll, { passive: true })
    return () => ux().window!.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    const first = pathRef.current === null
    const samePath = pathRef.current === loc.pathname
    pathRef.current = loc.pathname
    // A fresh load arrives as a POP with nothing remembered. It goes to the top like any new
    // route — now, not a frame later: that frame landed on top of a scroll a view made on mount
    // (the superset card centring its row, views/Workout.jsx), and a smooth scroll cut off by a
    // scrollTo is simply gone.
    if (navType !== 'POP' || first) { ux().window!.scrollTo(0, 0); return }
    // A POP that stays on the route we are on is not a back-navigation: it is the history
    // entry a sheet pushed (Modals.jsx, #63) being unwound as the sheet closes. Nothing new
    // mounted, Modals puts the page back where it was itself, and a view that scrolled on
    // purpose because the sheet closed — the workout list going to the current exercise after
    // ⋯ → Layout → List (#224) — must not be dragged back to a position recorded before that
    // scroll's event had even been dispatched.
    if (samePath) return
    const y = scrollPositions.get(loc.pathname) || 0
    // the restored view needs a layout pass before it is tall enough to scroll to y
    const frame = ux().window!.requestAnimationFrame(() => ux().window!.scrollTo(0, y))
    return () => ux().window!.cancelAnimationFrame(frame)
  }, [loc.pathname, navType])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!recovery && !!S.active && !S.active.editingWorkoutId && S.keepAwake !== false)
  // A running workout has the whole screen (v1.3.11): no tab bar, and the rest bar docks to the
  // bottom edge in its place. Its header's ⌄ goes back to the app, where the tab bar's Resume
  // brings it back.
  const inWorkout = loc.pathname === '/workout' && !!S.active
  useEffect(() => {
    ux().document!.body.classList.toggle('no-tabbar', inWorkout)
    return () => ux().document!.body.classList.remove('no-tabbar')
  }, [inWorkout])
  const noTabs = inWorkout

  if (recovery) return <><div id="app"><OwnershipRecovery /></div><Modals /><Toast /></>

  const authed = user || isGuest
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : (
            <Routes>
              <Route path="/home" element={<Home />} />
              {/* Gym check-in — switched off in Settings, the route falls through to the
                  catch-all redirect below. */}
              {S.checkIn !== false && <Route path="/checkin" element={<CheckIn />} />}
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/muscles" element={<Muscles />} />
              <Route path="/structural-balance" element={<StructuralBalance />} />
              <Route path="/measurements" element={<Measurements />} />
              <Route path="/settings" element={<SettingsRoute />} />
              <Route path="/settings/:page" element={<SettingsRoute />} />

              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </div>
      {/* Outside #app: the view's fade-in animates a transform, and a fixed element inside it
          would ride along with the page for the length of it. Decides for itself when to show —
          including on the sign-in screen, when the server has just ended the session. */}
      <SyncBanner />
      {!noTabs && <TabBar onStart={startFlow} />}
      <RestTimer />
      <Modals />
      <Toast />
      <TimerFlash />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
