import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Frozen oracle JS is intentionally differential-test-only.
import * as csvOracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/import-csv.js'
// @ts-expect-error Frozen oracle JS is intentionally differential-test-only.
import * as hevyOracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/import-hevy.js'
import { parseWorkoutCSV } from '../src/import-csv'
import { parseHevyWorkouts, parseHevyRoutines } from '../src/import-hevy'

const csv = 'Date,Exercise,Weight,Reps\n2024-03-07,Synthetic Zorb,50,5'
const templates = [{ id: 'ZZZ1', title: 'Synthetic Zorb' }]
const exercises = [{ exercise_template_id: 'ZZZ1', sets: [{ weight_kg: 50, reps: 5 }] }]
const workouts = [{ title: 'Synthetic', start_time: '2024-03-07T12:00:00Z', exercises }]
const routines = [{ title: 'Synthetic', exercises }]
const options = { customEx: [{ id: 123, n: 'Synthetic Zorb' }] }

// Compiled by the gate, never executed: unchecked IDs need narrowing at every consumer.
function uncheckedIdConsumers() {
  const parsed = parseWorkoutCSV(csv, options)
  if (!parsed.error) {
    // @ts-expect-error CSV preserves numeric (and other unchecked) custom IDs.
    parsed.workouts[0]!.entries[0]!.id.startsWith('cu')
  }
  // @ts-expect-error Hevy workouts preserve unchecked custom IDs too.
  parseHevyWorkouts(workouts, templates, options).workouts[0]!.entries[0]!.id.startsWith('cu')
  // @ts-expect-error Hevy routines preserve unchecked custom IDs too.
  parseHevyRoutines(routines, templates, options).routines[0]!.ex[0]!.id.startsWith('cu')
}
void uncheckedIdConsumers

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0.707)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const equal = (actual: unknown, expected: unknown) => {
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}

describe('import parser IDs retain the unchecked custom row value', () => {
  // Unknown input can also contribute booleans or object IDs; a string|number promise is insufficient.
  const ids: unknown[] = [123, 'cu123', true, { synthetic: 123 }]

  it('CSV retains numeric and other custom IDs without coercion', () => {
    for (const id of ids) {
      const options = { customEx: [{ id, n: 'Synthetic Zorb' }] }
      const parsed = parseWorkoutCSV(csv, options)
      if (parsed.error) throw new Error(parsed.error)
      expect(parsed.workouts[0]!.entries[0]!.id).toBe(id)
      expect(parsed.customEx).toEqual([])
      equal(parsed, csvOracle.parseWorkoutCSV(csv, options))
    }
  })

  it('Hevy workouts retain numeric and other custom IDs without coercion', () => {
    for (const id of ids) {
      const options = { customEx: [{ id, n: 'Synthetic Zorb' }] }
      const parsed = parseHevyWorkouts(workouts, templates, options)
      expect(parsed.workouts[0]!.entries[0]!.id).toBe(id)
      expect(parsed.customEx).toEqual([])
      equal(parsed, hevyOracle.parseHevyWorkouts(workouts, templates, options))
    }
  })

  it('Hevy routines retain numeric and other custom IDs without coercion', () => {
    for (const id of ids) {
      const options = { customEx: [{ id, n: 'Synthetic Zorb' }] }
      const parsed = parseHevyRoutines(routines, templates, options)
      expect(parsed.routines[0]!.ex[0]!.id).toBe(id)
      expect(parsed.customEx).toEqual([])
      equal(parsed, hevyOracle.parseHevyRoutines(routines, templates, options))
    }
  })
})
