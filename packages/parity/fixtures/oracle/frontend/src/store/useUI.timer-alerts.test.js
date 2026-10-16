// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))

import { useUI } from './useUI.js'
import { useStore } from './useStore.js'

import { alertBuzz, chime, vibrate } from '../lib/sound.js'

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useUI.setState({ timer: null, timerFlashId: 0 })
  for (const f of [alertBuzz, chime, vibrate]) f.mockClear()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState({ S: original })
  vi.useRealTimers()
})

const withSettings = over => useStore.setState({ S: { ...original, sound: false, ...over }, user: null })

describe('browser timer alerts', () => {

  // #306: the page plays the picked sound too, on screen, at the end of a rest.
  it('chimes the sound Settings → Sound picked', async () => {
    withSettings({ sound: true, restSound: 'soft' })
    useUI.getState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(chime).toHaveBeenCalledWith(true, 'soft')
  })

  it('the end of a rest seen on screen buzzes through alertBuzz', async () => {
    withSettings({ vibrate: true, })
    useUI.getState().startRest(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(alertBuzz).toHaveBeenCalledWith([200, 100, 200])
    expect(vibrate).not.toHaveBeenCalledWith([200, 100, 200])
  })

  it('a hold that ends early only ticks, the ordinary way', () => {
    withSettings({ vibrate: true, })
    useUI.getState().startWork(30, 'Plank', () => {})
    useUI.getState().finishWorkEarly()
    expect(vibrate).toHaveBeenCalledWith(30)
    expect(alertBuzz).not.toHaveBeenCalled()
  })

})
