const uiState = (): any => useUI.getState()
import { installUIEnvironment } from './environment'
const { api } = vi.hoisted(() => ({ api: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ ok: true })) }))
// Ported legacy twin; malformed fixtures intentionally retain tolerant JS shapes.
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/sound', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

import { useUI } from '../../src/store/useUI'
import { useStore } from '../../src/store/useStore'

import { alertBuzz, chime, vibrate } from '../../src/lib/sound'

// Inject browser capabilities and pin the clock for every legacy timer case.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  installUIEnvironment(api)
})

let original: any
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useUI.setState({ timer: null, timerFlashId: 0 })
  for (const f of [alertBuzz, chime, vibrate]) vi.mocked(f).mockClear()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => {
  uiState().stopRest()
  useStore.setState({ S: original })
  vi.useRealTimers()
})

const withSettings = (over: any) => useStore.setState({ S: { ...original, sound: false, ...over }, user: null })

describe('browser timer alerts', () => {

  // #306: the page plays the picked sound too, on screen, at the end of a rest.
  it('chimes the sound Settings → Sound picked', async () => {
    withSettings({ sound: true, restSound: 'soft' })
    uiState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(chime).toHaveBeenCalledWith(true, 'soft')
  })

  it('the end of a rest seen on screen buzzes through alertBuzz', async () => {
    withSettings({ vibrate: true, })
    uiState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(alertBuzz).toHaveBeenCalledWith([200, 100, 200])
    expect(vibrate).not.toHaveBeenCalledWith([200, 100, 200])
  })

  it('a hold that ends early only ticks, the ordinary way', () => {
    withSettings({ vibrate: true, })
    uiState().startWork(30, 'Plank', () => {})
    uiState().finishWorkEarly()
    expect(vibrate).toHaveBeenCalledWith(30)
    expect(alertBuzz).not.toHaveBeenCalled()
  })

})
