// @vitest-environment happy-dom
import './workout-sheet-environment'
import { it, expect, vi } from 'vitest'
import { useStore } from '../src/store/useStore'
import { initializePublicActions } from '../src/store/public-actions'
import { workoutSheetPlatform } from './workout-sheet-environment'
import { materializeTmSeed } from '@opengym/core/materialize-tm-seed'
import { skip } from '@opengym/core/programme'
import { progressionDisplay } from '../src/lib/progression-display'
import { p7Fixture } from './p7-fixture'
import { convertWeightPrecise } from '@opengym/core/progression-engine/units'

it.each([['week','fixed'],['block','fixed'],['week','history'],['block','history']] as const)('%s repeat carries %s TM seed units through lb→kg, kg→lb and same-unit profiles', (kind, seedKind) => {
 vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
 for (const [from, to, expectedLoad] of [['lb', 'kg', 29.5], ['kg', 'lb', 143.5], ['lb', 'lb', 65], ['kg', 'kg', 65]] as const) {
  const S = p7Fixture(), c = S.programmes.cycles[0]
  S.unit = from; c.snapshot.unit = from; c.snapshot.tmSeeds.bench.unit = from
  c.snapshot.repeat = {bump: {bench: 5}}
  for (const week of c.snapshot.weeks) week.unit = from
  for (const rows of Object.values(c.snapshot.progressionRules[0].weeks) as any[]) for (const row of rows) row.pct = .65
  c.snapshot.progressionRules[0].rounding.increment = .5
  if (seedKind === 'history') {
    c.snapshot.tmSeeds = {bench: {fromE1rm: {pct: .9}}}
    S.workouts = [{id: 'synthetic-seed-history', d: '2026-10-11', start: Date.parse('2026-10-11T10:00:00Z'), end: Date.parse('2026-10-11T11:00:00Z'), entries: [{id: '0025', sets: [{w: 100, r: 1, done: true}]}]}]
  }
  c.tmUnit = from; c.tm = {bench: 100}; c.tmSeed = {bench: 100}; c.unknownI03 = {keep: true}
  useStore.getState().replaceState(S, false)
  initializePublicActions({platform: workoutSheetPlatform, toast: () => {}, materializeTmSeed})
  useStore.getState().setUnit(to)
  const previous = structuredClone(useStore.getState().S.programmes.cycles[0])
  expect(previous.tmSeed.bench).toBe(100); expect(previous.snapshot.unit).toBe(from); expect(previous.tmUnit).toBe(to)
  if (kind === 'block') useStore.getState().update(draft => {
    for (const o of [...draft.programmes.cycles[0].occurrences]) skip(draft as any, 'c', o.instanceId, {today: '2026-10-12'})
  }, false)
  const next = kind === 'week' ? useStore.getState().repeatProgrammeWeek('c', '2026-10-12') : useStore.getState().finishProgrammeBlock('c', 'repeat', {today: '2026-10-12'})
  expect(next).toBeTruthy()
  const state = useStore.getState().S, old = state.programmes.cycles[0], fresh = state.programmes.cycles.at(-1)
  expect(fresh.snapshot.unit).toBe(from); expect(fresh.tmUnit).toBe(to)
  expect(fresh.tmSeed.bench).toBeCloseTo((seedKind === 'history' ? 90 : 100) + (kind === 'block' ? 5 : 0), 0) // legacy caches round to quarter units on conversion
  expect(convertWeightPrecise(fresh.tmSeed.bench, from, to)).toBeCloseTo(fresh.tm.bench, 10)
  expect(old.tm).toEqual(previous.tm); expect(old.tmSeed).toEqual(previous.tmSeed); expect(old.unknownI03).toEqual({keep: true})
  const display = progressionDisplay(state, fresh.snapshot, fresh, [1], '2026-10-12')!
  expect(display.result.error).toBeUndefined(); expect(display.slots[0]!.prescription.sets[0]!.unit).toBe(to)
  const load = display.slots[0]!.prescription.sets[0]!.load!
  const physicalBaseline = expectedLoad * (seedKind === 'history' ? .9 : 1)
  if (kind === 'week') expect(Math.abs(load - physicalBaseline)).toBeLessThan(.25)
  else expect(load).toBeGreaterThan(physicalBaseline)
 }
})
