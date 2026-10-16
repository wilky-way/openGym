// @vitest-environment happy-dom
// Android kills the app mid-rest (kill -9, low memory): sessionStorage dies with the process and
// so does the countdown notification, which lives in it. The rest is kept in localStorage, and
// coming back the app books its end again: one alarm with a fixed id, so it replaces the old
// one rather than adding a second. A paused rest is held again in the notification.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI, restoreRest, REST_KEY } from './useUI.js'
import { useStore } from './useStore.js'

let original
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useStore.setState({ S: { ...original, active: { id: 'a', entries: [] } } })
  useUI.setState({ timer: null, work: null })
  localStorage.clear(); sessionStorage.clear()
})
afterEach(() => {
  useUI.getState().stopRest()
  useStore.setState({ S: original })
  vi.useRealTimers()
})

describe('the rest timer after this browser is reopened', () => {
  it('is kept where a new process can read it', () => {
    useUI.getState().startRest(90, 0)
    expect(JSON.parse(localStorage.getItem(REST_KEY))).toMatchObject({ total: 90, forIdx: 0 })
    expect(sessionStorage.getItem(REST_KEY)).toBeNull()
  })

  it('comes back with the original completion time', () => {
    const endsAt = Date.now() + 60_000
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt, total: 90, forIdx: 1, kind: null, paused: false, left: 60 }))
    expect(restoreRest()).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ left: 60, total: 90, endsAt })
  })

  it('a paused countdown is restored without resuming', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: 0, total: 90, forIdx: 0, kind: null, paused: true, left: 33 }))
    expect(restoreRest()).toBe(true)
    expect(useUI.getState().timer).toMatchObject({ left: 33, total: 90, paused: true })
  })
})
