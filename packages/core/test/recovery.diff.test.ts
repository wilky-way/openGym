import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error Frozen JS oracle has no declarations; differential tests alone import it.
import * as oracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/recovery.js'
import * as port from '../src/recovery'
import { EXIDX, createExerciseIndex } from '../src/exercises'
import type { AnalyticsWorkout } from '../src/analytics-types'

const NOW = Date.UTC(2026, 7, 8, 12)
const DAY = 86400000
const exercise = fc.constantFrom('0025', '0043', '0251', '0017', '0739', 'gone-custom')
const set = fc.record({
  done: fc.boolean(), w: fc.integer({ min: 0, max: 240 }), r: fc.integer({ min: 0, max: 35 }),
  phase: fc.constantFrom('work', 'warmup'),
  unit: fc.constantFrom('kg', 'lb', 'lbs'),
  rir: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
  rpe: fc.option(fc.double({ min: 6, max: 10, noNaN: true }), { nil: undefined }),
})
const workout = fc.record({
  age: fc.integer({ min: -10, max: 160 }),
  bw: fc.integer({ min: 0, max: 180 }),
  unit: fc.constantFrom('kg', 'lb'),
  entries: fc.array(fc.record({ id: exercise, sets: fc.array(set, { maxLength: 5 }) }), { maxLength: 4 }),
}).map(({ age, ...w }): AnalyticsWorkout => ({ ...w, start: NOW - age * DAY, d: new Date(NOW - age * DAY).toISOString() }))
const outputs = (api: typeof port, history: AnalyticsWorkout[]) => ({
  fatigue: api.fatigueOf(history, NOW, { unit: 'kg', bodyweightKg: 80 }),
  strength: api.strengthOf(history, NOW),
  fatigued: api.fatiguedMuscles(history, NOW),
  detrained: api.detrainedMuscles(history, NOW),
  anchors: [...api.anchorsByWorkout(history)].map(([w, values]) => [history.indexOf(w), [...values]]),
})

describe('recovery differential against the frozen oracle', () => {
  it('matches values and serialized key order over seeded histories', () => {
    fc.assert(fc.property(fc.array(workout, { maxLength: 10 }), history => {
      // Oracle JS exports have the same public surface; no output conversion or sorting.
      const old = outputs(oracle as unknown as typeof port, history)
      const next = outputs(port, history)
      expect(next).toEqual(old)
      expect(JSON.stringify(next)).toBe(JSON.stringify(old))
    }), { seed: 110011, numRuns: Number(process.env.FC_RUNS ?? 1000) })
  })

  it('matches registered custom assisted and bodyweight metadata without mutating either history', async () => {
    // @ts-expect-error Frozen JS oracle registry, isolated and cleared after the comparison.
    const { registerCustom } = await import('../../../packages/parity/fixtures/oracle/frontend/src/lib/exercises.js')
    const custom = [
      { id: 'custom-assisted', n: 'Assisted row', assisted: true, muscleWeights: { chest: 1 } },
      { id: 'custom-bw', n: 'Custom push-up', eq: 'body weight', muscleWeights: { chest: 1 } },
    ]
    const index = createExerciseIndex(custom)
    const history: AnalyticsWorkout[] = [{ start: NOW, bw: 80, entries: custom.map(e => ({ id: e.id, sets: [{ done: true, w: 20, r: 8 }] })) }]
    const before = JSON.stringify(history)
    registerCustom(custom)
    try {
      for (const name of ['fatigueOf', 'strengthOf', 'fatiguedMuscles', 'detrainedMuscles'] as const) {
        const old = oracle[name](history, NOW, {})
        const next = port[name](history, NOW, {}, index)
        expect(next).toEqual(old)
        expect(JSON.stringify(next)).toBe(JSON.stringify(old))
      }
      const old = [...oracle.anchorsByWorkout(history)].map(([, a]) => [...a])
      const next = [...port.anchorsByWorkout(history, {}, index)].map(([, a]) => [...a])
      expect(next).toEqual(old)
      expect(JSON.stringify(next)).toBe(JSON.stringify(old))
      expect(JSON.stringify(history)).toBe(before)
      expect(EXIDX['custom-assisted']).toBeUndefined()
    } finally { registerCustom([]) }
  })
})
