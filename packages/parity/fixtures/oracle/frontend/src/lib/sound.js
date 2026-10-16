// WebAudio beeps + haptics (ported from the vanilla app). `enabled` gates sound.
//
// iOS needs three things a desktop browser does not (#152, "flash but no beep"):
//  1. The ring/silent switch mutes Web Audio. WebKit gives a page whose only audio is Web Audio
//     the Ambient category, and Ambient obeys the switch — at a gym the phone is usually on
//     silent, so the timer was mute exactly where it mattered. The only way out is the
//     'playback' audio-session type (iOS 17+), which is exclusive: it pauses whatever else the
//     phone is playing, and WebKit never tells that app it may resume. Hence a setting
//     (setPlayOnSilent), off by default, rather than something done for everyone.
//  2. Locking the screen or switching apps moves a running context to 'interrupted'. WebKit
//     only brings it back by itself if it was running when the interruption began; a context
//     that was suspended comes back suspended, and a suspended context makes no sound. So every
//     tone resumes the context first — allowed without a tap once the context has started
//     inside one.
//  3. A context created outside a tap starts 'suspended' and no timer tick can start it.
//     unlock() runs from the taps that lead to a timer (set check, hold start, turning Sounds
//     on) so the context has started before any tick needs it.
//
// The context is suspended again a second after the last tone: an idle context otherwise keeps
// rendering silence for the rest of the page, and under 'playback' keeps the phone's audio
// session busy. (Suspending does NOT hand the phone back to a paused music app — see 1.)
import { REST_SOUNDS } from './rest-sounds.js'

let audioCtx = null
let idleTm = null
let idleAt = 0

const ctxFor = () => {
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  return audioCtx
}

const wake = () => {
  const ctx = ctxFor()
  if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}) }
  return ctx
}

// Suspend once every scheduled tone is over. A burst schedules several tones in one go; the
// latest end wins, and a tone scheduled while the timer is pending pushes it out.
const sleepAfter = endSec => {
  const at = Date.now() + endSec * 1000 + 1000
  if (at <= idleAt && idleTm) return
  idleAt = at
  clearTimeout(idleTm)
  idleTm = setTimeout(() => {
    idleTm = null
    try { if (audioCtx && audioCtx.state === 'running') { const p = audioCtx.suspend(); if (p && p.catch) p.catch(() => {}) } } catch (e) { /* */ }
  }, at - Date.now())
}

// Timbres richer than a sine, as the strengths of the fundamental and its harmonics. `bright`
// (the fundamental plus three falling harmonics) carries over music and through a phone
// speaker's weak low end without a square wave's buzz; `bell` leans on the 3rd and 5th for a
// struck, glassy ring. The browser normalises a periodic wave to a peak of 1, so the gain alone
// decides how loud it gets. Built once per context; a browser without createPeriodicWave gets

export const TIMBRES = { bright: [1, 0.6, 0.35, 0.2], bell: [1, 0.25, 0.5, 0.1, 0.3] }
let waves = {}
let wavesCtx = null
const setTimbre = (ctx, o, name) => {
  if (typeof ctx.createPeriodicWave !== 'function') { o.type = 'triangle'; return }
  if (wavesCtx !== ctx) { wavesCtx = ctx; waves = {} }
  if (!waves[name]) {
    const h = TIMBRES[name]
    waves[name] = ctx.createPeriodicWave(new Float32Array(h.length + 1), new Float32Array([0, ...h]))
  }
  o.setPeriodicWave(waves[name])
}

// One tone. The defaults are every beep the app has always made: a sine that reaches 0.35 and
// fades from there at once. `peak`, `hold` (the share of the tone kept at its peak before the
// fade), `timbre` (one of TIMBRES; `bright: true` is the chime's) and `glide` (a frequency the
// tone slides to by its end, for the whistle) exist for the end-of-rest sounds below.
const tone = (freq, dur, when, { peak = 0.35, hold = 0, bright = false, timbre = bright ? 'bright' : null, glide = 0 } = {}) => {
  const ctx = wake()
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.connect(g); g.connect(ctx.destination)
  if (timbre && TIMBRES[timbre]) setTimbre(ctx, o, timbre); else o.type = 'sine'
  const t0 = ctx.currentTime + when
  o.frequency.value = freq
  if (glide > 0) { o.frequency.setValueAtTime(freq, t0); o.frequency.linearRampToValueAtTime(glide, t0 + dur) }
  g.gain.setValueAtTime(0.001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
  if (hold > 0) g.gain.setValueAtTime(peak, t0 + dur * hold)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  o.start(t0); o.stop(t0 + dur + 0.05)
  sleepAfter(when + dur + 0.05)
}

export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try { tone(freq || 880, dur || 0.18, when || 0) } catch (e) { /* */ }
}

//
// Settings → Sound (#306) adds a few more to pick from. Each is notes of [freq, dur, when] (and a
// frequency to glide to, for the whistle) played with one shape: a peak, a hold and a timbre.
// Notes that overlap (the bell's ring, the soft one's) have peaks low enough that, decaying from

// one of these, number for number. The table itself is lib/rest-sounds.js, which has no audio in

export { CHIME_PEAK, REST_SOUNDS, REST_SOUND_IDS, restSoundOf } from './rest-sounds.js'
// `kind` is a REST_SOUNDS id; `true` (the old "classic" switch) still means the classic beeps.
export function chime(enabled, kind) {
  if (!enabled) return
  const id = kind === true ? 'classic' : kind
  const snd = Object.hasOwn(REST_SOUNDS, id) ? REST_SOUNDS[id] : REST_SOUNDS.chime
  try {
    for (const [freq, dur, when, glide] of snd.notes) {
      tone(freq, dur, when, snd === REST_SOUNDS.classic ? {} : { peak: snd.peak, hold: snd.hold, timbre: snd.timbre, glide })
    }
  } catch (e) { /* */ }
}

// Call from inside a tap. Gets the context created and running while the browser still counts
// this as a user gesture; it goes back to sleep on its own. Nothing audible.
export function unlock(enabled) {
  if (!enabled) return
  try { wake(); sleepAfter(0) } catch (e) { /* */ }
}

// Settings → "Play sounds when the phone is on silent". Offered only where it means something:
// a WebKit with the audio-session API (iOS 17+) on a device that has a ring/silent switch or its
// Control Centre equivalent — iPhone, or an iPad (which reports itself as a Mac with a touch
// screen). macOS Safari has the API but no switch, and other browsers have neither.
// 'playback' ignores the switch; 'auto' is the browser's own choice (Ambient for a page like
// this one). Applied by App.jsx whenever the setting is loaded or changed.
export const playOnSilentSupported = () => {
  if (typeof navigator === 'undefined' || !navigator.audioSession) return false
  return appleTouchDevice()
}
// An iPhone or iPad, in Safari, or a home-screen web app (an iPad reports itself as
// a Mac with a touch screen). Settings says "Not on iPhone" on the Vibrate row here.
export const appleTouchDevice = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
export function setPlayOnSilent(on) {
  if (!playOnSilentSupported()) return
  try { navigator.audioSession.type = on ? 'playback' : 'auto' } catch (e) { /* */ }
}

// Settings → "Vibrate" (Discord, asierlama): the buzz at the end of a rest or a hold and on a set
// tick, switched on its own the way Sounds is. A page-level switch like setPlayOnSilent, applied
// by App.jsx, so the places that buzz do not each have to read the profile. On by default.
let buzz = true
export function setVibrate(on) { buzz = on !== false }
export const vibrateSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
export function vibrate(p) {
  if (!buzz) return
  try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ }
}

// The end of a rest uses the browser vibration setting.
export function alertBuzz(pattern) { vibrate(pattern) }
