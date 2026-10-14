import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
import type { StateDoc } from '../../contract/domain/state-doc'
import { mergeImport, parseWorkoutCSV, priorCustom } from '../src/import-csv'
import { mergeHevyRoutines, parseHevyRoutines, buildHevyExerciseMap } from '../src/import-hevy'

// Compile against the frozen application state, including non-imported workouts and routine slots.
function stateConsumer(state: StateDoc) {
  const parsed = parseWorkoutCSV('Date,Exercise,Weight,Reps\n2024-03-08,Bench Press,50,5')
  if (!parsed.error) mergeImport(state, parsed)
  mergeHevyRoutines(state, parseHevyRoutines([], []))
}
void stateConsumer

describe('import merges accept ordinary stored application state', () => {
  it('retains existing workouts with non-null routine ownership and PRs', () => {
    const state: Pick<StateDoc, 'workouts' | 'bodyweight' | 'customEx' | 'exWeights'> = {
      workouts: [{ d: '2024-03-07', start: 1, routineId: 'mine', prs: ['0025'], entries: [{ id: '0025', sets: [{ w: 100, r: 5 }] }] }],
      bodyweight: [{ d: '2024-03-07', w: 80 }], customEx: [], exWeights: {},
    }
    const original = structuredClone(state.workouts[0])
    const parsed = parseWorkoutCSV('Date,Exercise,Weight,Reps\n2024-03-08,Bench Press,50,5')
    if (parsed.error) throw new Error(parsed.error)
    expect(mergeImport(state, parsed)).toEqual({ added: 1, skipped: 0 })
    expect(state.workouts[0]).toEqual(original)
    expect(state.workouts).toHaveLength(2)
  })

  it('retains routine slots with optional prescription fields', () => {
    const state: Pick<StateDoc, 'customEx' | 'routines'> = { customEx: [], routines: [{ id: 'mine', name: 'Mine', ex: [{ id: '0025', reps: 'max' }] }] }
    const original = structuredClone(state.routines)
    expect(mergeHevyRoutines(state, parseHevyRoutines([], []))).toEqual({ added: 0, updated: 0 })
    expect(state.routines).toEqual(original)
  })

  it('reports retained Hevy and custom identifiers without claiming they are strings', () => {
    const map = buildHevyExerciseMap([{ id: 123 }])
    expect(map.has(123)).toBe(true)
    const parsed = parseHevyRoutines([{ id: 123, title: 'Synthetic', exercises: [{ exercise_template_id: 'ZZZ1', sets: [{ weight_kg: 50, reps: 5 }] }] }], [])
    expect(parsed.routines[0]!.hevyId).toBe(123)
    const original = { id: 123, n: 'Synthetic' }
    const result = priorCustom([original], 'missing', 'Synthetic')
    const id: number | undefined = result?.id
    expect(id).toBe(123)
    expect(result).toBe(original)
  })

})
