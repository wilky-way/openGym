/** W04's injectable browser UX capabilities. Configured by the shell at boot. */
export interface UxAudio {
  createContext(): AudioContext
  appleTouchDevice(): boolean
  playOnSilentSupported(): boolean
  setPlayOnSilent(on: boolean): void
  vibrateSupported(): boolean
  vibrate(pattern: number | number[]): void
}
export interface UxWakeLock {
  supported(): boolean
  visible(): boolean
  request(): Promise<WakeLockSentinel>
  subscribe(listener: () => void): () => void
}
export interface UxPlatform {
  window: Window | null
  document: Document | null
  audio: UxAudio
  wakeLock: UxWakeLock
  path2D(path: string): Path2D
  reducedMotion(): boolean
  observeIntersection(callback: IntersectionObserverCallback, options: IntersectionObserverInit): IntersectionObserver | null
}
const unavailable: UxPlatform = {
  window: null, document: null,
  audio: {
    createContext() { throw new Error('Audio is unavailable') },
    appleTouchDevice: () => false, playOnSilentSupported: () => false,
    setPlayOnSilent() {}, vibrateSupported: () => false, vibrate() {},
  },
  wakeLock: { supported: () => false, visible: () => false,
    request: () => Promise.reject(new Error('Wake lock is unavailable')), subscribe: () => () => {} },
  path2D() { throw new Error('Canvas paths are unavailable') },
  reducedMotion: () => false, observeIntersection: () => null,
}
let current = unavailable
export function configureUx(adapter: UxPlatform): void { current = adapter }
export function ux(): UxPlatform { return current }
let buzz = true
export function setVibrationEnabled(on?: boolean): void { buzz = on !== false }
export function vibrate(pattern: number | number[]): void {
  if (!buzz) return
  try { current.audio.vibrate(pattern) } catch { /* unsupported/refused */ }
}

interface AudioNavigator extends Navigator { audioSession?: { type: string } }
interface AudioWindow extends Window { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
/** Only this adapter touches browser globals. A Tauri shell supplies the same capabilities. */
export function createBrowserUx(): UxPlatform {
  const win = typeof window === 'undefined' ? null : window
  const doc = typeof document === 'undefined' ? null : document
  const nav = typeof navigator === 'undefined' ? null : navigator as AudioNavigator
  const appleTouchDevice = () => {
    const ua = nav?.userAgent || ''
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints || 0) > 1)
  }
  const playOnSilentSupported = () => !!nav?.audioSession && appleTouchDevice()
  return {
    window: win, document: doc,
    audio: {
      createContext() {
        const Ctx = (win as AudioWindow | null)?.AudioContext || (win as AudioWindow | null)?.webkitAudioContext
        if (!Ctx) throw new Error('Audio is unavailable')
        return new Ctx()
      },
      appleTouchDevice, playOnSilentSupported,
      setPlayOnSilent(on) { if (playOnSilentSupported() && nav?.audioSession) nav.audioSession.type = on ? 'playback' : 'auto' },
      vibrateSupported: () => typeof nav?.vibrate === 'function',
      vibrate(pattern) { nav?.vibrate?.(pattern) },
    },
    wakeLock: {
      supported: () => !!nav && 'wakeLock' in nav,
      visible: () => doc?.visibilityState === 'visible',
      request: () => nav?.wakeLock.request('screen') ?? Promise.reject(new Error('Wake lock is unavailable')),
      subscribe(listener) { doc?.addEventListener('visibilitychange', listener); return () => doc?.removeEventListener('visibilitychange', listener) },
    },
    path2D(path) {
      const Ctor = (win as (Window & { Path2D?: typeof Path2D }) | null)?.Path2D
      if (!Ctor) throw new Error('Canvas paths are unavailable')
      return new Ctor(path)
    },
    reducedMotion: () => win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    observeIntersection: (callback, options) => typeof IntersectionObserver === 'function' ? new IntersectionObserver(callback, options) : null,
  }
}
