import { useCallback, useEffect } from 'react'
import type { RefObject } from 'react'
import { ux } from '../platform/ux'

/* How far the keyboard reaches up the layout viewport, and the height left above it. */
export function sheetKeyboardInsets(win: { visualViewport?: { height: number; offsetTop: number } | null; innerHeight: number }) {
  const viewport = win.visualViewport
  const vh = Math.max(0, viewport?.height || win.innerHeight)
  const visualBottom = (viewport?.offsetTop || 0) + vh
  const bottomInset = Math.max(0, win.innerHeight - visualBottom)
  const visualHeight = vh
  return { bottomInset, visualHeight }
}

export function useSheetKeyboard(inputRef: RefObject<HTMLElement | null>, enabled = true) {
  const sync = useCallback(() => {
    const input = inputRef.current
    const sheet = input?.closest<HTMLElement>('.sheet')
    const viewport = ux().window?.visualViewport
    if (!sheet || !viewport) return
    const { bottomInset, visualHeight } = sheetKeyboardInsets(ux().window!)
    sheet.style.setProperty('--picker-keyboard-bottom', `${bottomInset}px`)
    sheet.style.setProperty('--picker-visual-height', `${visualHeight}px`)
  }, [inputRef])

  useEffect(() => {
    if (!enabled) return
    const viewport = ux().window?.visualViewport
    if (!viewport) return
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
        // The sheet element outlives this input when the sheet swaps content, so leave it
      // the way we found it rather than pinning a stale keyboard inset on it.
      const sheet = inputRef.current?.closest<HTMLElement>('.sheet')
      sheet?.style.removeProperty('--picker-keyboard-bottom')
      sheet?.style.removeProperty('--picker-visual-height')
    }
  }, [enabled, sync, inputRef])

  // Hand back as onFocus so the first measurement happens as the keyboard opens, before
  // the visualViewport events land (on iOS they can arrive a frame late).
  return sync
}

/* Chip strips scroll sideways, and a filter set from code ("★ Chosen", a reset) can land the
   active chip off-screen. Pull it into view along the strip only. This used to be
   scrollIntoView({block:'nearest'}), which also walks every scrollable ancestor: with the
   strip scrolled above the fold (Library, halfway down the list) a tap on a chip made the
   whole page jump up to show the row — the "swiping the chips scrolls the page" bug. Setting
   the strip's own scrollLeft cannot move anything but the strip.

   `pad` mirrors scroll-padding-inline in index.css so a revealed chip is not glued to the edge. */
interface MeasuredChip { getBoundingClientRect(): { left: number; width: number } }
interface MeasuredStrip extends MeasuredChip { scrollLeft: number; clientWidth: number }
export function revealChip(strip: MeasuredStrip | null, chip: MeasuredChip | null, pad = 16) {
  if (!strip || !chip || typeof strip.getBoundingClientRect !== 'function' || typeof chip.getBoundingClientRect !== 'function') return false
  const s = strip.getBoundingClientRect(), c = chip.getBoundingClientRect()
  const width = strip.clientWidth || s.width || 0
  if (!width) return false
  const left = c.left - s.left + (strip.scrollLeft || 0)   // chip's offset inside the strip's content
  const right = left + c.width
  let next = strip.scrollLeft || 0
  if (left - pad < next) next = Math.max(0, left - pad)
  else if (right + pad > next + width) next = right + pad - width
  if (next === (strip.scrollLeft || 0)) return false
  strip.scrollLeft = next
  return true
}

export function useRevealActiveChip(stripRef: RefObject<HTMLElement | null>, active: unknown) {
  useEffect(() => {
    const strip = stripRef.current
    const chip = strip?.querySelector?.('.chip.on')
    if (chip) revealChip(strip, chip)
  }, [stripRef, active])
}

/* Props that make a clickable <div> behave like a button for keyboard and screen-reader
   users. Kept as a div because some rows nest a real <Button> (Library), and a button inside
   a button is invalid HTML. Space is swallowed so the page does not scroll under the row. */
interface KeyEvent { target: unknown; currentTarget: unknown; key?: string; preventDefault(): void }
export function tappable<E extends KeyEvent>(onClick?: ((event: E) => void) | null) {
  if (!onClick) return {}
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e: E) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick(e)
      }
    }
  }
}
