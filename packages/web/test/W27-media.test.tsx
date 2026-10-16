// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Media, { Thumb, autoplayMuted } from '../src/components/Media'
import { createExerciseIndex, EXIDX, type Exercise } from '@opengym/core/exercises'
import { useStore, freshState } from '../src/store/useStore'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const ex = EXIDX['0025']!
function render(exercise = ex, minimizable = false) { act(() => root.render(<Media ex={exercise} minimizable={minimizable} />)) }
function click(selector: string) { act(() => host.querySelector<HTMLButtonElement>(selector)!.click()) }
function error(selector: string) { act(() => host.querySelector(selector)!.dispatchEvent(new Event('error'))) }
beforeEach(() => {
  useStore.setState({ S: { ...freshState(), gifSize: 'full' }, index: createExerciseIndex(), update: fn => { const S = structuredClone(useStore.getState().S); fn(S); useStore.setState({ S }) } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
it('autoplays a muted inline looping MP4 with the still as poster, and toggles playback by pointer or keyboard', () => {
  render()
  const video = host.querySelector('video')!
  expect(video.getAttribute('src')).toBe(`exercise-media/clip/${ex.gif}`)
  expect(video.getAttribute('poster')).toBe(`exercise-media/still/${ex.img}`)
  expect(video.hasAttribute('autoplay') && video.hasAttribute('loop') && video.muted && video.defaultMuted && video.hasAttribute('playsinline')).toBe(true)
  expect(video.hasAttribute('muted')).toBe(true)
  expect(video.play).toHaveBeenCalled()
  click('.exmedia-play'); expect(host.querySelector('video')).toBeNull(); expect(host.querySelector('img')!.src).toContain(ex.img)
  click('.exmedia-play'); expect(host.querySelector('video')).toBeTruthy()
})
it('falls from clip to still to a neutral tile, and retries on tap', () => {
  render(); error('video'); expect(host.querySelector('img')!.src).toContain(ex.img)
  error('img'); expect(host.querySelector('.exmedia.broken .exmedia-x')).toBeTruthy(); expect(host.querySelector('img,video')).toBeNull()
  click('.exmedia-play'); expect(host.querySelector('video')).toBeTruthy()
})
it('honours the drawing setting and resets a failed preview when the figure or exercise changes', () => {
  const dual = Object.values(EXIDX).find(e => e.fv)!
  render(dual); error('video'); error('img')
  act(() => useStore.setState({ S: { ...useStore.getState().S, exFigure: 'female' } }))
  expect(host.querySelector('video')!.src).toContain(`${dual.fv}.mp4`)
  expect(host.querySelector('video')!.getAttribute('poster')).toContain(`${dual.fv}.webp`)
  act(() => useStore.setState({ S: { ...useStore.getState().S, exFigure: undefined, body: 'female' } }))
  expect(host.querySelector('video')!.src).toContain(`${dual.fv}.mp4`)
  error('video'); error('img'); render(ex); expect(host.querySelector('video')).toBeTruthy()
})
it('renders nothing for custom exercises, including unflagged custom shadows with stray catalogue fields', () => {
  for (const custom of [{ ...ex, id: 'custom', custom: true }, { ...ex, n: 'Custom shadow' }]) {
    act(() => useStore.setState({ index: createExerciseIndex([custom]) }))
    render(custom); expect(host.innerHTML).toBe('')
    act(() => root.render(<Thumb ex={custom} />)); expect(host.innerHTML).toBe('')
  }
})
it('persists full/mini and respects off only for minimizable workout media', () => {
  render(ex, true); click('.giftoggle'); expect(useStore.getState().S.gifSize).toBe('mini'); expect(host.querySelector('.mini')).toBeTruthy()
  click('.giftoggle'); expect(useStore.getState().S.gifSize).toBe('full')
  act(() => useStore.setState({ S: { ...useStore.getState().S, gifSize: 'off' } })); expect(host.innerHTML).toBe('')
  render(ex); expect(host.querySelector('video')).toBeTruthy()
})
it('falls back for broken thumbs and retries when their source changes', () => {
  act(() => root.render(<Thumb ex={ex} />)); error('img'); expect(host.querySelector('.thumb-x')).toBeTruthy()
  act(() => root.render(<Thumb ex={EXIDX['0043']!} />)); expect(host.querySelector('img.thumb')).toBeTruthy()
})
it('handles missing media and rejected autoplay', async () => {
  render({ ...ex, gif: undefined } as Exercise); expect(host.innerHTML).toBe('')
  const el = document.createElement('video'); vi.mocked(el.play).mockRejectedValue(new Error('blocked'))
  autoplayMuted(el); await Promise.resolve(); expect(el.muted).toBe(true)
})
