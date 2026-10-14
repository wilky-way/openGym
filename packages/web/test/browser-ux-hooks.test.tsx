// @vitest-environment happy-dom
import { act, useRef } from 'react'
import type { PointerEvent as ReactPointer } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureUx, createBrowserUx, ux } from '../src/platform/ux'
import { useAutoMore } from '../src/lib/use-auto-more'
import { useListReorder, moved } from '../src/lib/use-list-reorder'
import { useSheetKeyboard, useRevealActiveChip, tappable } from '../src/lib/use-sheet-keyboard'
import { useSwipeRow, closeOpenRow } from '../src/lib/use-swipe-row'
import { setVibrate } from '../src/lib/sound'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  configureUx(createBrowserUx())
  setVibrate(true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => { root.unmount(); closeOpenRow(true) })
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('injected UX hooks', () => {
  it('observes a paging button, uses the latest callback, and disconnects on unmount', () => {
    let observerCallback: IntersectionObserverCallback | undefined
    const disconnect = vi.fn(), observe = vi.fn()
    const factory = vi.fn((callback: IntersectionObserverCallback) => {
      observerCallback = callback
      return { disconnect, observe } as unknown as IntersectionObserver
    })
    configureUx({ ...ux(), observeIntersection: factory })
    const first = vi.fn(), next = vi.fn()
    function Paging({ onMore }: { onMore: () => void }) { return <button ref={useAutoMore(onMore)}>More</button> }
    act(() => root.render(<Paging onMore={first} />))
    expect(factory).toHaveBeenCalledWith(expect.any(Function), { rootMargin: '0px 0px 100% 0px' })
    expect(observe).toHaveBeenCalledWith(container.querySelector('button'))
    act(() => root.render(<Paging onMore={next} />))
    observerCallback!([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    expect(next).not.toHaveBeenCalled()
    observerCallback!([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    expect(first).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
    act(() => root.render(null))
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('retains manual paging when the shell has no observer', () => {
    configureUx({ ...ux(), observeIntersection: () => null })
    const more = vi.fn()
    function Paging() { return <button ref={useAutoMore(more)} onClick={more}>More</button> }
    act(() => root.render(<Paging />))
    container.querySelector('button')!.click()
    expect(more).toHaveBeenCalledOnce()
  })

  it('measures the injected viewport and clears sheet properties when disabled', () => {
    const viewport = new EventTarget()
    Object.assign(viewport, { height: 400, offsetTop: 20 })
    const shellWindow = { visualViewport: viewport, innerHeight: 800 } as unknown as Window
    configureUx({ ...ux(), window: shellWindow })
    function Picker({ enabled }: { enabled: boolean }) {
      const ref = useRef<HTMLInputElement>(null)
      const sync = useSheetKeyboard(ref, enabled)
      return <div className="sheet"><input ref={ref} onFocus={sync} /></div>
    }
    act(() => root.render(<Picker enabled />))
    const sheet = container.querySelector<HTMLElement>('.sheet')!
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe('380px')
    expect(sheet.style.getPropertyValue('--picker-visual-height')).toBe('400px')
    Object.assign(viewport, { height: 600 })
    viewport.dispatchEvent(new Event('resize'))
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe('180px')
    act(() => root.render(<Picker enabled={false} />))
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe('')
    viewport.dispatchEvent(new Event('scroll'))
    expect(sheet.style.getPropertyValue('--picker-visual-height')).toBe('')
  })

  it('reveals the active chip along its strip after the filter changes', () => {
    function Chips({ active }: { active: number }) {
      const ref = useRef<HTMLDivElement>(null)
      useRevealActiveChip(ref, active)
      return <div ref={ref} {...tappable(() => {})}><span className="chip on" /></div>
    }
    act(() => root.render(<Chips active={0} />))
    const strip = container.firstElementChild as HTMLElement
    const chip = strip.firstElementChild as HTMLElement
    Object.defineProperty(strip, 'clientWidth', { value: 300 })
    strip.getBoundingClientRect = () => ({ left: 20, width: 300 }) as DOMRect
    chip.getBoundingClientRect = () => ({ left: 520, width: 80 }) as DOMRect
    act(() => root.render(<Chips active={1} />))
    expect(strip.scrollLeft).toBe(296)
  })

  it('reorders by pointer and keyboard and cancels a held move', () => {
    const move = vi.fn()
    let list: ReturnType<typeof useListReorder>
    function List() {
      list = useListReorder(3, move)
      return <div ref={list.listRef}>{[0, 1, 2].map(i => <div key={i} data-reorder-row style={list.rowStyle(i)}><button {...list.handle(i)} /></div>)}</div>
    }
    act(() => root.render(<List />))
    const rows = [...container.querySelectorAll('[data-reorder-row]')]
    rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 50, height: 40 }) as DOMRect })
    const button = container.querySelector('button')!
    const p = (y: number) => ({ button: 0, pointerId: 1, clientY: y, currentTarget: button, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as ReactPointer<HTMLElement>
    act(() => list.handle(0).onPointerDown(p(0)))
    act(() => list.handle(0).onPointerMove(p(110)))
    expect(list!.drag?.to).toBe(2)
    expect(list!.rowStyle(1)).toEqual({ transform: 'translateY(-50px)' })
    act(() => list.handle(0).onPointerUp(p(110)))
    expect(move).toHaveBeenCalledWith(0, 2)
    expect(moved(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    act(() => button.dispatchEvent(key))
    expect(move).toHaveBeenLastCalledWith(0, 1)
    act(() => list.handle(0).onPointerDown(p(0)))
    act(() => list.handle(0).onPointerMove(p(110)))
    act(() => list.handle(0).onPointerCancel())
    expect(move).toHaveBeenCalledTimes(2)
    expect(list!.drag).toBeNull()
  })

  it('uses the final swipe position, closes on owner changes and honors the shared vibration switch', () => {
    const commit = vi.fn(), vibrate = vi.fn()
    configureUx({ ...ux(), reducedMotion: () => true, audio: { ...ux().audio, vibrate } })
    let swipe: ReturnType<typeof useSwipeRow>
    function Row({ owner }: { owner: number }) {
      swipe = useSwipeRow({ onCommit: commit, closeKey: owner })
      return <div ref={swipe.outerRef} className="swrow" {...swipe.handlers}><div ref={swipe.frontRef} /></div>
    }
    act(() => root.render(<Row owner={0} />))
    const outer = container.firstElementChild as HTMLDivElement
    Object.defineProperty(outer, 'clientWidth', { value: 360 })
    const p = (x: number) => ({ pointerType: 'touch', pointerId: 1, clientX: x, clientY: 0, timeStamp: 100, target: outer }) as unknown as ReactPointer<HTMLElement>
    setVibrate(false)
    act(() => swipe.handlers.onPointerDown(p(300)))
    act(() => swipe.handlers.onPointerMove(p(250)))
    act(() => swipe.handlers.onPointerUp(p(60)))
    expect(commit).toHaveBeenCalledWith('delete')
    expect(vibrate).not.toHaveBeenCalled()
    act(() => root.render(<Row owner={1} />))
    expect(swipe!.frontRef.current!.style.transform).toBe('')
    setVibrate(true)
    act(() => swipe.handlers.onPointerDown(p(110)))
    act(() => swipe.handlers.onPointerMove(p(180)))
    act(() => swipe.handlers.onPointerUp(p(180)))
    expect(swipe!.openSide).toBe('copy')
    act(() => root.render(<Row owner={2} />))
    expect(swipe!.openSide).toBeNull()
    act(() => swipe.pressCopy())
    expect(commit).toHaveBeenLastCalledWith('copy')
    expect(vibrate).toHaveBeenCalledWith(15)
  })
})
