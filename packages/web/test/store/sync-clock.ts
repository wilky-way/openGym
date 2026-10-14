import { beforeEach, afterEach, vi } from 'vitest'
// Pin Date without replacing real debounce/promise timers used by multi-tab transcripts.
const pin = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')) }
pin()
beforeEach(pin)
afterEach(() => vi.useRealTimers())
