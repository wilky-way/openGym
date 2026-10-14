// @vitest-environment happy-dom
/* The English steps and descriptions come in their own chunk the first time an exercise is shown.
   A load that failed (offline, before the worker had the chunk) used to leave them empty and
   never ask again, so every exercise showed no steps until the app was reloaded. Now the next
   reader after a pause, or the browser coming back online, tries again. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net: any = { up: false, loads: 0 }
const offline: any = () => { throw new TypeError('Failed to fetch dynamically imported module') }

const ex: any = { id: '9999', st: [] }

let stop: (() => void) | undefined
let i18n: any
beforeEach(async () => {
  vi.resetModules()
  net.up = false
  net.loads = 0
  vi.doMock('@opengym/core/instr/en', async () => { net.loads++; return net.up ? { default: { 9999: ['Stand tall.', 'Lift.'] } } : offline() })
  vi.doMock('@opengym/core/exercise-desc/en', async () => (net.up ? { default: { 9999: 'A lift.' } } : offline()))
  const {configureTestClient} = await import('./client-fixture')
  configureTestClient()
  i18n = await import('../src/lib/i18n')
  stop = i18n.initializeI18n()
})
afterEach(() => { stop?.(); vi.useRealTimers(); vi.doUnmock('@opengym/core/instr/en'); vi.doUnmock('@opengym/core/exercise-desc/en') })

describe('a failed load of the English steps', () => {
  it('is not mistaken for no steps: tried again on the next ask after a pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(i18n.instrFor(ex)).toEqual([])
    await vi.advanceTimersByTimeAsync(0)
    expect(net.loads).toBe(1)
    // asked again at once (every render asks): no new try yet
    i18n.instrFor(ex)
    await vi.advanceTimersByTimeAsync(0)
    expect(net.loads).toBe(1)
    net.up = true
    await vi.advanceTimersByTimeAsync(20000)
    expect(net.loads).toBe(1)          // nothing asked yet: no load on its own
    i18n.instrFor(ex)
    await vi.advanceTimersByTimeAsync(0)
    expect(i18n.instrFor(ex)).toEqual(['Stand tall.', 'Lift.'])
  })

  it('tried again as soon as the browser is back online', async () => {
    i18n.instrFor(ex)
    await vi.dynamicImportSettled()
    expect(net.loads).toBe(1)
    net.up = true
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(i18n.instrFor(ex)).toEqual(['Stand tall.', 'Lift.']))
    expect(i18n.instrFor(ex)).toEqual(['Stand tall.', 'Lift.'])
  })
})
