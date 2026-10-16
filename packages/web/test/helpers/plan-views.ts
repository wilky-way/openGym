import { beforeEach, afterEach, vi } from 'vitest'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import { createBrowserPlatform } from '../../src/platform/browser'
import { configureClientIO } from '../../src/lib/client-io'
import { useStore, initializeStore } from '../../src/store/useStore'
import { stampChange } from '@opengym/core/sync-merge'
import { createExerciseIndex } from '@opengym/core/exercises'
let unsub: (() => void) | undefined
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(() => {
    let timer: ReturnType<typeof setTimeout>
    return { set onfinish(fn: () => void) { timer = setTimeout(fn, 180) }, cancel() { clearTimeout(timer) } } as unknown as Animation
  })
  configureUx(createBrowserUx()); const platform = createBrowserPlatform(); configureClientIO(platform)
  // Twins retain their small W06 updater; real W07 adversarial tests live separately.
  if (useStore.setState) {
    initializeStore(platform)
    useStore.setState({ update: mut => {
      const before = useStore.getState().S, next = structuredClone(before)
      mut(next); next._ts = stampChange(before, next, Date.now())
      platform.kv.set('gym_state_v1', JSON.stringify(next))
      useStore.setState({ S: next, index: createExerciseIndex(next.customEx) })
    } })
    unsub = useStore.subscribe((next, prev) => {
      if (next.S.customEx !== prev.S.customEx) useStore.setState({ index: createExerciseIndex(next.S.customEx) })
    })
  }
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-16T12:00:00'))
})
afterEach(() => { unsub?.(); unsub = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
