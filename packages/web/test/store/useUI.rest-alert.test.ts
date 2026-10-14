const uiState = (): any => useUI.getState()
import { installUIEnvironment } from './environment'
const { api } = vi.hoisted(() => ({ api: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ ok: true })) }))
// Ported legacy twin; malformed fixtures intentionally retain tolerant JS shapes.
// @vitest-environment happy-dom
// Issue #239: the local "rest over" alert ignored the Push switch in Settings. Every rest asked
// for the notification permission on its own, and once granted it fired with the switch off —
// a page cannot give a permission back. "On" is this browser holding a push subscription.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from '../../src/store/useUI'
import { useStore } from '../../src/store/useStore'

// Inject browser capabilities and pin the clock for every legacy timer case.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  installUIEnvironment(api)
})

let showNotification: any, requestPermission: any, subscription: any, originalSettings: any
const hide = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
}
const runOut = async () => {
  uiState().startRest(2)
  hide(true)
  await vi.advanceTimersByTimeAsync(3000)
}

beforeEach(() => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  useStore.setState({ S: { ...originalSettings, sound: false }, user: null })
  useUI.setState({ timer: null })
  showNotification = vi.fn()
  requestPermission = vi.fn(async () => 'granted')
  subscription = null
  ;(globalThis as any).Notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission })
  ;(window as any).Notification = (globalThis as any).Notification
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ showNotification, pushManager: { getSubscription: async () => subscription } }) },
  })
})
afterEach(() => {
  uiState().stopRest()
  hide(false)
  useStore.setState({ S: originalSettings })
  delete (globalThis as any).Notification
  vi.useRealTimers()
})

describe('the local rest-over alert follows the Push switch', () => {
  it('stays silent with the switch off, even though the permission is granted', async () => {
    await runOut()
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('fires once with the switch on, tagged like the server push, without repeating the title', async () => {
    subscription = { endpoint: 'https://push.example/x' }
    await runOut()
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, opts] = showNotification.mock.calls[0]
    expect(title).toBe('Rest’s over. Next set!')
    expect(opts.tag).toBe('rest-timer')
    expect(opts.body).toBeUndefined()
  })

  it('never asks for the permission by itself — only the switch does', async () => {
    (globalThis as any).Notification.permission = 'default'
    await runOut()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
  })
})
