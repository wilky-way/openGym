import { expect, it } from 'vitest'
import { createExerciseIndex } from '@opengym/core/exercises'
import { mergeStates, inUnitOf, sinceReset } from '../src/sync-merge'
import { convertStateUnit } from '../src/units'
import type { SyncDoc } from '../src/sync-types'

const index = createExerciseIndex([
  { id: 'custom-assist', n: 'Synthetic assistance', eq: 'leverage machine', assisted: true },
  { id: 'custom-bell', n: 'Synthetic one arm row', eq: 'dumbbell' },
  { id: 'custom-bar', n: 'Synthetic bar press', eq: 'barbell' },
])
const workout = (id: string, weights: number[], stamp = 200) => ({ id, d: '2026-10-01', _ts: stamp,
  entries: [{ id: 'custom-assist', sets: weights.map(w => ({ w, r: 5, done: true })) }] })
const doc = (extra: Partial<SyncDoc> = {}): SyncDoc => ({ unit: 'kg', _ts: 1, workouts: [], routines: [], exWeights: {}, ...extra })

it('joins custom assistance records using the smaller weight', () => {
  const a = doc({ _ts: 2, exWeights: { 'custom-assist': { w: 80 } } })
  const b = doc({ exWeights: { 'custom-assist': { w: 60 } } })
  expect(mergeStates(a, b, {}, index)!.exWeights!['custom-assist']!.w).toBe(60)
})
it('corrected custom assistance records use the least completed row, then the editing source', () => {
  const old = doc({ workouts: [workout('w', [90], 100)] })
  const edited = doc({ _ts: 2, workouts: [workout('w', [50, 30])], exWeights: { 'custom-assist': { w: 60 } } })
  expect(mergeStates(edited, old, {}, index)!.exWeights!['custom-assist']!.w).toBe(30)
  const betterSource = { ...edited, exWeights: { 'custom-assist': { w: 20 } } }
  expect(mergeStates(betterSource, old, {}, index)!.exWeights!['custom-assist']!.w).toBe(20)
})
it('Reset rebuilds custom assistance records from rows and across sessions', () => {
  const stale = doc({ workouts: [workout('w1', [60, 50]), workout('w2', [40, 30])] })
  expect(sinceReset(stale, 100, undefined, index).exWeights!['custom-assist']!.w).toBe(30)
  const reset = doc({ resetAt: 100, _ts: 100 })
  for (const [a, b] of [[stale, reset], [reset, stale]] as const) {
    expect(mergeStates(a, b, {}, index)!.exWeights!['custom-assist']!.w).toBe(30)
  }
})
it('converted custom one-arm dumbbell volume counts one bell and custom bar defaults disappear', () => {
  const state = doc({ barWeights: { 'custom-bar': 20 }, workouts: [{ id: 'bell', d: '2026-10-01', _ts: 200, vol: 100,
    entries: [{ id: 'custom-bell', target: { dbLoad: 'each' }, sets: [{ w: 20, r: 5, done: true }] }] }] })
  const converted = convertStateUnit(state, 'lb', index)
  expect(converted.barWeights).toEqual({})
  expect(converted.workouts![0]!.vol).toBe(220)
  const aligned = inUnitOf(state, { unit: 'lb' }, index)
  expect(aligned.barWeights).toEqual({})
  expect(aligned.workouts![0]!.vol).toBe(220)
  const lead = doc({ unit: 'lb', unitSet: { at: 300, convert: true }, _ts: 300 })
  for (const [a, b] of [[state, lead], [lead, state]] as const) {
    const merged = mergeStates(a, b, {}, index)!
    expect(merged.barWeights).toEqual({})
    expect(merged.workouts![0]!.vol).toBe(220)
  }
})
