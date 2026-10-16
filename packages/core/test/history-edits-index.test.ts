import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { createExerciseIndex } from '../src/exercises'
import { markAllSetsDone } from '../src/backfill'
import { rebuildPrHistory, moveWorkout } from '../src/workout-date'
import { deleteEditedWorkout, editChangesNothing, editCompletedSession, saveWorkoutEdit, type EditState } from '../src/session-edit'
import { acceptRollover, finishProgrammeBlock, rolloverProposals } from '../src/programme-rollover'
import * as programme from '@opengym/core/programme'
import type { Workout } from '../../contract/domain/state-doc'

// Native K03/K05/K06/K12/K14 dependencies; actual output assertions only.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
afterEach(() => { vi.useRealTimers() })
const id = 'custom-assisted'
const index = createExerciseIndex([{ id, n: 'Custom assistance', eq: 'assisted', assisted: true, custom: true }, { id: 'custom-cardio', n: 'Custom cardio', bp: 'cardio', custom: true }])
const entry = (w: number) => ({ id, target: { mode: 'reps' }, sets: [{ w, r: 8, done: true }] })
const record = (key: string, d: string, w: number): Workout => ({ id: key, d, start: 1, end: 2, entries: [entry(w)], prs: [id] })
const editing = (): EditState => ({ workouts: [record('prior', '2026-01-01', 40), record('edit', '2026-01-02', 20), record('later', '2026-01-03', 25)], exWeights: { [id]: { w: 20, d: '2026-01-02' } } })
describe('history edits pass each caller-owned exercise index', () => {
  it('markAllSetsDone forwards the custom-assisted index to the best-load selector', () => {
    const mixed = { ...entry(20), sets: [{ w: 30, r: 8, done: true }, { w: 20, r: 8, done: true }] }
    expect(markAllSetsDone([mixed], index)[0]!.topW).toBe(20)
  })
  it('PR rebuilding recognises less assistance as the record', () => {
    const moved = record('moved', '2026-01-01', 20)
    expect(rebuildPrHistory([moved, record('later', '2026-01-02', 30)], [id], moved, index).map(w => w.prs)).toEqual([[id], []])
  })
  it('date moves forward the index through PR rebuilding', () => {
    const list = [record('first', '2026-01-01', 20), record('move', '2026-01-03', 30)]
    expect(moveWorkout(list, { id: 'move' }, '2026-01-02', '07:00', 777, index)!.map(w => w.prs)).toEqual([[id], []])
  })
  it('save forwards to finish, volume, PR rebuilding and all kept-weight comparisons', () => {
    const state = editing()
    editCompletedSession(state, 'edit')
    state.active!.entries[0]!.sets[0]!.w = 30
    saveWorkoutEdit(state, 777, index)
    expect(state.exWeights![id]).toEqual({ w: 25, d: '2026-01-03' })
    expect(state.workouts.map(w => w.prs)).toEqual([[id], [id], [id]])
  })
  it('unchanged-editor detection forwards to the finish builder', () => {
    const state = editing()
    editCompletedSession(state, 'edit')
    expect(editChangesNothing(state, index)).toBe(true)
  })
  it('delete forwards through each kept-weight comparison', () => {
    const state = editing()
    editCompletedSession(state, 'edit')
    expect(deleteEditedWorkout(state, index)).toBe(true)
    expect(state.exWeights![id]).toEqual({ w: 25, d: '2026-01-03' })
  })
  it('proposal reads and acceptance both forward a custom loaded exercise to modeOf', () => {
    const state: any = { unit: 'lb', routines: [], workouts: [] }
    const def = { id: 'synthetic', name: 'Synthetic', unit: 'lb', weeks: [1, 2].map(n => ({ index: n, days: [{ key: 'd1', sessions: [{ routineSnapshot: { ex: [{ id, sets: n + 1, reps: 8 }] } }] }] })) }
    programme.activate(state, def, { cycleId: 'c', today: '2026-01-01' }, index)
    programme.skip(state, 'c', 'c:w1d1', { today: '2026-01-01' })
    const proposals = rolloverProposals(state, 'c', index)
    expect(proposals[0]).toMatchObject({ exerciseId: id, reason: 'no-data', sets: 2 })
    acceptRollover(state, 'c', proposals, undefined, index)
    programme.skip(state, 'c', 'c:w2d1', { today: '2026-01-02' })
    expect(finishProgrammeBlock(state, 'c', 'repeat', { today: '2026-01-03' }, index)).toMatchObject({ lap: 2 })
  })
  it('custom cardio cannot receive a reps-based rollover proposal', () => {
    const state: any = { unit: 'lb', routines: [], workouts: [] }
    const def = { id: 'synthetic-cardio', name: 'Synthetic cardio', unit: 'lb', weeks: [1, 2].map(n => ({ index: n, days: [{ key: 'd1', sessions: [{ routineSnapshot: { ex: [{ id: 'custom-cardio', sets: n + 1, reps: 8 }] } }] }] })) }
    programme.activate(state, def, { cycleId: 'cardio', today: '2026-01-01' }, index)
    programme.skip(state, 'cardio', 'cardio:w1d1', { today: '2026-01-01' })
    expect(rolloverProposals(state, 'cardio', index)).toEqual([])
    expect(rolloverProposals(state, 'cardio')).toHaveLength(1)
    expect(acceptRollover(state, 'cardio', [], undefined, index)).toEqual([])
    expect(state.programmes.cycles[0].rolloverReviewed).toBeTruthy()
  })

})

it('lowers a kept assisted load after deleting duplicate 20 and 30 occurrences', () => {
  const state = editing()
  state.workouts[1]!.entries = [entry(20), entry(30)]
  editCompletedSession(state, 'edit')
  expect(deleteEditedWorkout(state, index)).toBe(true)
  expect(state.workouts.map(w => w.id)).toEqual(['prior', 'later'])
  expect(state.exWeights![id]).toEqual({ w: 25, d: '2026-01-03' })
})
it('saves native assisted minimum topW through both completed-record builders', () => {
  const state = editing()
  editCompletedSession(state, 'edit')
  state.active!.entries[0]!.sets = [{ w: 30, r: 8, done: true }, { w: 20, r: 8, done: true }]
  const saved = saveWorkoutEdit(state, 777, index)!
  expect(saved.entries[0]!.topW).toBe(20)
  expect(saved.entries[0]!.sets).toEqual([{ w: 30, r: 8, done: true }, { w: 20, r: 8, done: true }])
})
it('recomputes a real custom one-arm dumbbell volume when saving an edit', () => {
  const bellId = 'custom-one-bell'
  const bellIndex = createExerciseIndex([{ id: bellId, n: 'Single arm lift', eq: 'dumbbell' }])
  const state: EditState = { workouts: [{ id: 'bell', d: '2026-01-01', start: 1, end: 2, entries: [{ id: bellId, target: { mode: 'reps', dbLoad: 'each' }, sets: [{ w: 10, r: 8, done: true }] }] }], exWeights: {} }
  editCompletedSession(state, 'bell')
  state.active!.entries[0]!.sets[0]!.w = 20
  expect(saveWorkoutEdit(state, 777, bellIndex)!.vol).toBe(160)
})

// Inert: unchanged-editor comparison strips every exercise topW, the only
// index-dependent field produced by draftRecord/buildCompletedWorkout. Repeat
// activation reaches K12's routine-only numeric conversion, which reads no metadata.
it('keeps the two proven inert history-edit forwards explicit', () => {
  type Node = { type?: string; callee?: { name?: string }; arguments?: { type?: string; name?: string }[]; [key: string]: unknown }
  const cases = [
    ['session-edit', 'draftRecord', 1, 2],
    ['programme-rollover', 'activate', 0, 1],
  ] as const
  for (const [module, callee, ordinal, total] of cases) {
    const ast = parse(readFileSync(new URL('../src/' + module + '.ts', import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
    const found: Node[] = []
    function walk(value: unknown) {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(walk); return }
      const n = value as Node
      if (n.type === 'CallExpression' && n.callee?.name === callee) found.push(n)
      for (const [key, child] of Object.entries(n)) if (!['loc', 'comments'].includes(key)) walk(child)
    }
    walk(ast)
    expect(found).toHaveLength(total)
    expect(found[ordinal]!.arguments?.at(-1)).toMatchObject({ type: 'Identifier', name: 'index' })
  }
})

it('uses the assisted minimum across completed rows when deleting an edited workout', () => {
  const state = editing()
  state.workouts[1]!.entries[0]!.sets = [{ w: 30, r: 8, done: true }, { w: 20, r: 8, done: true }]
  editCompletedSession(state, 'edit')
  expect(deleteEditedWorkout(state, index)).toBe(true)
  expect(state.exWeights![id]).toEqual({ w: 25, d: '2026-01-03' })
})
it('keeps the confirmation date when saved duplicate assistance still matches the kept load', () => {
  const state = editing()
  state.exWeights![id] = { w: 20, d: '2026-01-04' }
  editCompletedSession(state, 'edit')
  state.active!.entries = [entry(20), entry(30)]
  saveWorkoutEdit(state, 777, index)
  expect(state.exWeights![id]).toEqual({ w: 20, d: '2026-01-04' })
})
it('finds the minimum assisted occurrence across historical duplicates after deletion', () => {
  const state = editing()
  state.workouts[0]!.entries = [entry(40), entry(15)]
  editCompletedSession(state, 'edit')
  expect(deleteEditedWorkout(state, index)).toBe(true)
  expect(state.exWeights![id]).toEqual({ w: 15, d: '2026-01-01' })
})
it('rebuilds PR badges from the assisted minimum across rows rather than maximum assistance', () => {
  const moved = record('moved', '2026-01-01', 40)
  moved.entries[0]!.sets = [{ w: 40, r: 8, done: true }, { w: 20, r: 8, done: true }]
  expect(rebuildPrHistory([moved, record('later', '2026-01-02', 30)], [id], moved, index).map(w => w.prs)).toEqual([[id], []])
})
