import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error untyped frozen legacy oracle, loaded only in parity tests
import { swapActiveExercise as legacySwap } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/active-exercise-swap.js'
import { swapActiveExercise } from '@opengym/core/active-exercise-swap'
import type { SwapEntry, SwapState, SwapOptions } from '../src/active-exercise-swap'

const row = fc.record({ w: fc.integer({ min: 0, max: 150 }), r: fc.integer({ min: 0, max: 20 }), done: fc.constantFrom(true, false, 0, 1, undefined), rir: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }) })
const entry = fc.record({
  id: fc.constantFrom('duplicate', 'row', 'replacement'),
  sg: fc.option(fc.constantFrom('pair', 'other'), { nil: undefined }),
  rid: fc.option(fc.constantFrom('routine-1', 'routine-2'), { nil: undefined }),
  occurrenceId: fc.string({ maxLength: 8 }),
  provenance: fc.record({ routineIndex: fc.nat({ max: 5 }) }),
  target: fc.record({ reps: fc.integer({ min: 1, max: 15 }), weight: fc.integer({ min: 0, max: 100 }) }),
  sets: fc.option(fc.array(row, { maxLength: 4 }), { nil: undefined }),
  plan: fc.option(fc.record({ sets: fc.nat({ max: 5 }) }), { nil: undefined }),
  carried: fc.option(fc.boolean(), { nil: undefined }),
})
const active = fc.option(fc.record({ entries: fc.array(entry, { maxLength: 8 }), cur: fc.nat({ max: 8 }), groupMeta: fc.record({ pair: fc.record({ label: fc.constant('Synthetic pair') }) }) }), { nil: null })
const options = fc.record({ loggedConfirmed: fc.boolean(), groupDisposition: fc.constantFrom(undefined, 'keep', 'detach', 'other') })
const observe = (swap: typeof swapActiveExercise, state: SwapState | null, index: number, replacement: SwapEntry | null, opts: SwapOptions) => {
  try { return { result: swap(state, index, replacement, opts), state } }
  catch (error) { return { error: error instanceof Error ? error.name : typeof error, state } }
}
describe('active exercise swap differential', () => {
  it('preserves occurrence identity, metadata, logged confirmation, group insertion and mutations', () => {
    fc.assert(fc.property(active, fc.oneof(fc.integer({ min: -2, max: 10 }), fc.constantFrom(NaN, 0.5)), fc.option(entry, { nil: null }), options, (state, index, replacement, opts) => {
      const old = observe(legacySwap, structuredClone(state), index, structuredClone(replacement), opts)
      const next = observe(swapActiveExercise, structuredClone(state), index, structuredClone(replacement), opts)
      expect(next).toEqual(old)
      expect(JSON.stringify(next)).toBe(JSON.stringify(old))
    }), { numRuns: 1000, seed: 141403 })
  }, 30_000)
})
