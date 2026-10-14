import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ux, vibrate } from '../platform/ux'
import type { PointerEvent as ReactPointerEvent } from 'react'
type Pointer = ReactPointerEvent<HTMLElement>
type Side = 'delete' | 'copy'
type Gesture = { id: number; x0: number; y0: number; o0: number; lock: 'x' | null; samples: [number, number][]; w?: number; target: SwipeOptions }
interface SwipeOptions { canDelete?: boolean; canCopy?: boolean; canSwipe?: () => boolean; onCommit?: (side: Side) => void; onBlocked?: () => void; onStart?: () => void; onCancelled?: () => void; closeKey?: unknown }

// Swipe on sets (v1.3.11): the gesture core behind components/SwipeRow.jsx. A set row swiped
// toward the start of the line (left in a left-to-right language, right in Arabic) deletes, toward
// the end copies. A short swipe leaves the row open on a button; a long one, or a flick, acts on
// release. Everything below is in that logical sense: a negative offset is toward the start and
// is turned into pixels only when painted, the way SwipeCards does it.
//
// The row is almost all controls (the set number, the steppers, the value fields, the tick), so a
// swipe may start on any of them, and a tap must still be a tap. Nothing is captured until the
// touch has gone 8 px and clearly sideways (1.5 times more x than y, the same lock SwipeCards
// uses); a touch that goes vertical first is the page's scroll for the rest of its life. Once
// locked, the pointer is captured, the next click is swallowed, so the ± or tick under the finger
// does not fire after the swipe, and a field that took focus on the way in lets it go again.
//
// Touches that start within 24 px of either screen edge are left alone: that is iOS Safari's back
// swipe and Android's gesture navigation. The page gutter and the card's padding are wider than
// that, so the zone costs almost no row.
//
// Mouse drags are not swipes: a desktop has the set-number menu and the keyboard.
//
// Plan's lists use the same gesture (v1.3.11): routines (delete, duplicate), the loop and a
// routine's exercises (remove only). A row with nothing on the end side (`canCopy` false) only
// gives a short rubber band that way, so it still feels alive but never shows an empty pane.

export const EDGE = 24
export const SLOP = 8
export const RATIO = 1.5
export const REVEAL = 76
export const OPEN_MIN = 40
export const DELETE_AT = 0.6
export const DELETE_FLING_AT = 0.4
export const COPY_AT = 0.4
export const COPY_FLING_AT = 0.25
export const FLING = 0.5
export const RESIST = 0.35
/** How far a row with no end-side action gives toward the end before it stops. */
export const BAND = 14
const PEEK = 32

/** +1 in a left-to-right page, -1 in a right-to-left one: logical offset × this = pixels. */
export const lineDir = () => (ux().document?.documentElement.dir === 'rtl' ? -1 : 1)

/** Whether a touch at clientX starts in the screen's edge zone (back gestures live there). */
export const inEdgeZone = (x: number, width: number) => x < EDGE || x > width - EDGE

/** The axis a move has settled on: null while under the slop, 'x' once clearly sideways, else 'y'. */
export function axisOf(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return null
  return Math.abs(dx) > RATIO * Math.abs(dy) ? 'x' : 'y'
}

/** Where the row sits for a raw logical drag `raw` on a row `w` wide: with the finger up to the
 *  commit point, then at a third of the pace beyond it, never past the row's own width. */
export function shapeOffset(raw: number, w: number, canCopy = true) {
  if (raw > 0 && !canCopy) return Math.min(BAND, raw * RESIST)
  const at = (raw < 0 ? DELETE_AT : COPY_AT) * w
  const d = Math.abs(raw)
  const out = d <= at ? d : at + (d - at) * RESIST
  return Math.sign(raw) * Math.min(w, out)
}

/** Whether an offset is past the commit point, i.e. letting go now acts. */
export function armedFor(o: number, w: number, canCopy = true) {
  if (o < 0) return -o >= DELETE_AT * w - 0.5 ? 'delete' : null
  if (o > 0) return canCopy && o >= COPY_AT * w - 0.5 ? 'copy' : null
  return null
}

/** What letting go does, for a row resting at logical offset `o` on a row `w` wide, released at
 *  logical velocity `v` (px/ms): 'delete' | 'copy' act; 'open-delete' | 'open-copy' leave the row
 *  open on its button; 'close' snaps it shut. A flick back the other way always closes. A row
 *  with no end-side action (`canCopy` false) only ever closes from that side. */
export function commitFor(o: number, w: number, v = 0, canCopy = true) {
  if (o < 0) {
    const d = -o
    if (d >= DELETE_AT * w || (d >= DELETE_FLING_AT * w && -v > FLING)) return 'delete'
    if (v > FLING) return 'close'
    return d >= OPEN_MIN ? 'open-delete' : 'close'
  }
  if (o > 0) {
    if (!canCopy) return 'close'
    if (o >= COPY_AT * w || (o >= COPY_FLING_AT * w && v > FLING)) return 'copy'
    if (-v > FLING) return 'close'
    return o >= OPEN_MIN ? 'open-copy' : 'close'
  }
  return 'close'
}

/** Logical velocity over the last 100 ms of [time, offset] samples. */
export function velocityOf(samples: [number, number][]) {
  if (samples.length < 2) return 0
  const a = samples[0]!, b = samples[samples.length - 1]!
  const dt = b[0] - a[0]
  return dt > 0 ? (b[1] - a[1]) / dt : 0
}

export const reducedMotion = () => {
  try { return ux().reducedMotion() } catch { return false }
}

// One open row at a time, and the click a swipe leaves behind. Shared by every row on the page.
type OpenRow = { el: HTMLElement; close: (instant?: boolean) => void; dragging: () => boolean }
const shared: { open: OpenRow | null; swallow: boolean; swallowTm: ReturnType<typeof setTimeout> | null; installed: boolean } = { open: null, swallow: false, swallowTm: null, installed: false }
const swallowNextClick = () => {
  shared.swallow = true
  if (shared.swallowTm) clearTimeout(shared.swallowTm)
  shared.swallowTm = setTimeout(() => { shared.swallow = false }, 600)
}
/** Closes whichever row is resting open, if any. */
export function closeOpenRow(instant = false) {
  const o = shared.open
  shared.open = null
  o?.close(instant)
}
function install() {
  const doc = ux().document, win = ux().window
  if (shared.installed || !doc || !win) return
  shared.installed = true
  // Any touch elsewhere closes the open row. A tap that lands on another set only closes, so a
  // tick meant as "close that" does not tick (iOS Mail does the same).
  doc.addEventListener('pointerdown', e => {
    shared.swallow = false
    const o = shared.open
    if (o && !o.el.contains(e.target as Node)) {
      closeOpenRow()
      if ((e.target as Element | null)?.closest?.('.swrow')) swallowNextClick()
    }
  }, true)
  doc.addEventListener('click', e => {
    if (shared.swallow) {
      shared.swallow = false
      e.stopPropagation(); e.preventDefault()
      return
    }
    // A tap on the open row itself (not its button) shuts it and does nothing else.
    const o = shared.open
    if (o && o.el.contains(e.target as Node) && !(e.target as Element | null)?.closest?.('.swpane')) {
      e.stopPropagation(); e.preventDefault()
      closeOpenRow()
    }
  }, true)
  win.addEventListener('scroll', () => { if (shared.open && !shared.open.dragging()) closeOpenRow() }, { passive: true, capture: true })
}

/**
 * The gesture for one row. `onCommit('delete' | 'copy')` acts; `canDelete` false greys the delete
 * side and turns a delete into a rubber band and `onBlocked()`. `closeKey` closes the row whenever
 * it changes (the entry's rows were added or removed, a tick, a timer start: the row under the
 * finger may no longer be the set it was). `onStart` runs when a swipe locks (the hint chip goes).
 * `canCopy` false is a delete-only row. `canSwipe()`, when given, is asked as a touch starts and
 * again before it locks: false leaves the touch to someone else (the routine editor's long-press
 * reorder, once it has picked a row up).
 */
export function useSwipeRow({ canDelete = true, canCopy = true, canSwipe, onCommit, onBlocked, onStart, onCancelled, closeKey }: SwipeOptions) {
  const outerRef = useRef<HTMLDivElement | null>(null)
  const frontRef = useRef<HTMLDivElement | null>(null)
  const delRef = useRef<HTMLDivElement | null>(null)
  const cpRef = useRef<HTMLDivElement | null>(null)
  const action = useRef<SwipeOptions | null>(null) // pointer-down binding, also retained for revealed buttons
  const g = useRef<Gesture | null>(null)          // the gesture in progress
  const o = useRef(0)             // current logical offset
  const busy = useRef(false)      // an act is animating
  const peeking = useRef<ReturnType<typeof setTimeout> | null>(null)    // the first-use hint's pending timer while it plays
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const anim = useRef<Animation | null>(null)
  const [openSide, setOpenSide] = useState<Side | null>(null)
  const props = useRef<SwipeOptions>({})
  props.current = { canDelete, canCopy, canSwipe, onCommit, onBlocked, onStart, onCancelled, closeKey }

  const later = (fn: () => void, ms: number) => { const id = setTimeout(fn, ms); timers.current.push(id); return id }
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }

  const paint = useCallback((off: number, ms = 0) => {
    const outer = outerRef.current, front = frontRef.current
    if (!outer || !front) return
    // Mid-drag the row's width is the one read as the swipe locked: reading it again on every
    // move, right after the last move wrote the panes' widths, forced a layout per frame (#431).
    const w = g.current?.w || outer.clientWidth || 1
    const copy = props.current.canCopy !== false
    const prevArmed = armedFor(o.current, w, copy)
    o.current = off
    const tr = ms && !reducedMotion() ? `${ms}ms cubic-bezier(.32,.72,0,1)` : ''
    front.style.transition = tr ? `transform ${tr}` : 'none'
    front.style.transform = off ? `translateX(${off * lineDir()}px)` : ''
    const del = delRef.current, cp = cpRef.current
    for (const [pane, width] of [[del, Math.max(0, -off)], [cp, Math.max(0, off)]] as const) {
      if (!pane) continue
      pane.style.transition = tr ? `width ${tr}` : 'none'
      pane.style.width = width + 'px'
    }
    const armed = armedFor(off, w, copy)
    del?.classList.toggle('armed', armed === 'delete')
    cp?.classList.toggle('armed', armed === 'copy')
    outer.classList.toggle('go-del', off < 0)
    outer.classList.toggle('go-cp', off > 0)
    // A tiny buzz crossing the commit point, either way (Android; Safari has no vibrate).
    if (!ms && armed !== prevArmed && g.current?.lock) {
      const deleting = armed === 'delete' || prevArmed === 'delete'
      if (!(deleting && props.current.canDelete === false)) vibrate(8)
    }
  }, [])

  const reset = useCallback(() => {
    const cancelled = busy.current && action.current?.onCancelled
    clearTimers()
    if (peeking.current) clearTimeout(peeking.current); peeking.current = null
    anim.current?.cancel?.()
    anim.current = null
    busy.current = false
    g.current = null
    action.current = null
    if (outerRef.current) outerRef.current.classList.remove('dragging', 'flash-red')
    paint(0)
    setOpenSide(null)
    if (shared.open?.el === outerRef.current) shared.open = null
    if (cancelled) cancelled()
  }, [paint])

  const close = useCallback((instant = false) => {
    if (shared.open?.el === outerRef.current) shared.open = null
    setOpenSide(null)
    paint(0, instant ? 0 : 260)
  }, [paint])

  const openTo = (side: Side) => {
    if (shared.open && shared.open.el !== outerRef.current) closeOpenRow()
    paint(side === 'delete' ? -REVEAL : REVEAL, 260)
    setOpenSide(side)
    shared.open = { el: outerRef.current!, close, dragging: () => !!g.current?.lock }
  }

  const currentTarget = () => action.current ?? { ...props.current }
  const isCurrent = (target: SwipeOptions) => Object.is(target.closeKey, props.current.closeKey)
  const doDelete = (target = currentTarget()) => {
    if (!isCurrent(target)) { reset(); return }
    const commit = target.onCommit
    const outer = outerRef.current
    if (!outer) return
    if (shared.open?.el === outer) shared.open = null
    setOpenSide(null)
    if (target.canDelete === false) {
      paint(0, 380)
      outer.classList.remove('flash-red'); void outer.offsetWidth; outer.classList.add('flash-red')
      later(() => outer.classList.remove('flash-red'), 520)
      target.onBlocked?.()
      return
    }
    vibrate(15)
    if (reducedMotion()) { paint(0); commit?.('delete'); return }
    busy.current = true
    paint(-(outer.clientWidth || 300), 170)
    later(() => {
      if (!isCurrent(target)) { reset(); return }
      const h = outer.offsetHeight
      outer.style.overflow = 'hidden'
      const done = () => {
        if (!isCurrent(target)) { reset(); return }
        busy.current = false
        commit?.('delete')
        // The row at this index now shows the next set (rows are keyed by index); the closeKey
        // effect puts it back. If nothing changed after all, this does.
        later(() => { if (anim.current) reset() }, 300)
      }
      if (typeof outer.animate === 'function') {
        anim.current = outer.animate([{ height: h + 'px' }, { height: '0px' }], { duration: 180, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' })
        anim.current.onfinish = done
      } else done()
    }, 170)
  }

  const doCopy = (target = currentTarget()) => {
    if (!isCurrent(target)) { reset(); return }
    const commit = target.onCommit
    if (target.canCopy === false) { close(); return }
    if (shared.open?.el === outerRef.current) shared.open = null
    setOpenSide(null)
    vibrate(15)
    if (reducedMotion()) { paint(0); commit?.('copy'); return }
    busy.current = true
    paint(0, 220)
    later(() => { if (!isCurrent(target)) { reset(); return }; busy.current = false; commit?.('copy') }, 200)
  }

  const release = (v: number, target: SwipeOptions) => {
    if (!isCurrent(target)) { reset(); return }
    const outer = outerRef.current
    if (!outer) return
    const act = commitFor(o.current, outer.clientWidth || 1, v, target.canCopy !== false)
    if (act === 'delete') doDelete(target)
    else if (act === 'copy') doCopy(target)
    else if (act === 'open-delete') openTo('delete')
    else if (act === 'open-copy') openTo('copy')
    else close()
  }

  // Any change the row's owner names closes it at once and drops a gesture mid-way.
  useLayoutEffect(() => { reset() }, [closeKey, reset])
  useEffect(() => () => { clearTimers(); if (peeking.current) clearTimeout(peeking.current); anim.current?.cancel?.(); if (shared.open?.el === outerRef.current) shared.open = null }, [])

  // touchmove is attached by hand and not passive, so a locked sideways swipe can keep the page
  // from scrolling under it on browsers that do not honour touch-action on the row: React's own
  // touch handlers are passive, and on iOS Safari a touch that starts on a row is claimed for the
  // page's scroll before a passive handler gets a say. Before the lock it does nothing.
  useEffect(() => {
    install()
    const el = outerRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => { if (g.current?.lock === 'x' && e.cancelable) e.preventDefault() }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const onPointerDown = (e: Pointer) => {
    if (busy.current || g.current) return
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    if ((e.target as Element | null)?.closest?.('.subrow,.swpane')) return
    if (props.current.canSwipe && !props.current.canSwipe()) return
    const width = ux().window?.innerWidth || 0
    if (width && inEdgeZone(e.clientX, width)) return
    // A real touch beats the first-use hint: it stops where it is and the row is the finger's
    // (QA 10-06: a swipe in the hint's first two seconds used to be swallowed).
    if (peeking.current) { if (peeking.current) clearTimeout(peeking.current); peeking.current = null; paint(0) }
    action.current = { ...props.current }
    g.current = { target: action.current, id: e.pointerId, x0: e.clientX, y0: e.clientY, o0: o.current, lock: null, samples: [] }
  }
  const onPointerMove = (e: Pointer) => {
    const d = g.current
    if (!d || d.id !== e.pointerId) return
    if (!isCurrent(d.target)) { reset(); return }
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0
    if (!d.lock) {
      const axis = axisOf(dx, dy)
      if (!axis) return
      if (axis === 'y') { g.current = null; return }
      if (props.current.canSwipe && !props.current.canSwipe()) { g.current = null; return }
      d.lock = 'x'
      d.w = outerRef.current?.clientWidth || 1
      try { outerRef.current?.setPointerCapture?.(e.pointerId) } catch { /* the gesture still tracks */ }
      swallowNextClick()
      const a = ux().document?.activeElement as HTMLElement | null
      if (a && a !== ux().document?.body && outerRef.current?.contains(a)) a.blur?.()
      if (shared.open && shared.open.el !== outerRef.current) closeOpenRow()
      outerRef.current?.classList.add('dragging')
      props.current.onStart?.()
    }
    follow(d, e)
  }
  // The row under the finger, and a sample for the release's speed.
  const follow = (d: Gesture, e: Pointer) => {
    const logical = (e.clientX - d.x0) * lineDir()
    const now = e.timeStamp || Date.now()
    d.samples.push([now, logical])
    while (d.samples.length > 2 && now - d.samples[0]![0] > 100) d.samples.shift()
    const w = d.w || outerRef.current?.clientWidth || 1
    paint(Math.max(-w, Math.min(w, shapeOffset(d.o0 + logical, w, props.current.canCopy !== false))))
  }
  const end = (e: Pointer, cancelled: boolean) => {
    const d = g.current
    if (!d || d.id !== e.pointerId) return
    g.current = null
    if (!d.lock) return
    outerRef.current?.classList.remove('dragging')
    // Where the finger lifted counts: a busy phone can drop the last moves of a fast swipe, and
    // the row then stopped short of where the finger was and only opened (QA 2026-10-06).
    if (!cancelled && Number.isFinite(e.clientX)) follow(d, e)
    if (cancelled) { reset(); return }
    release(velocityOf(d.samples), d.target)
  }

  // The first-use hint: a nudge toward the start (red shows), back, toward the end, back. A
  // delete-only row nudges toward the start only.
  const peek = useCallback(() => {
    if (reducedMotion() || busy.current || peeking.current || g.current) return
    const steps: [number, number][] = [[-PEEK, 250], [0, 250], ...(props.current.canCopy === false ? [] : [[PEEK, 250], [0, 250]] as [number, number][]) ]
    let k = 0
    const step = () => {
      if (k >= steps.length) { peeking.current = null; return }
      const [off, ms] = steps[k++]!
      paint(off, ms)
      peeking.current = setTimeout(step, ms + 50)
    }
    step()
  }, [paint])

  return {
    outerRef, frontRef, delRef, cpRef, openSide, peek,
    pressDelete: () => doDelete(), pressCopy: () => doCopy(),
    handlers: {
      onPointerDown, onPointerMove,
      onPointerUp: (e: Pointer) => end(e, false),
      onPointerCancel: (e: Pointer) => end(e, true),
    },
  }
}
