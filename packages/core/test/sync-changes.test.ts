// legacy-shape: unvalidated JSON test fixtures exercise incomplete and malformed records.
type Fixture = any
import { describe, expect, it } from 'vitest'
import { countChanges as typed_countChanges, syncFingerprint as typed_syncFingerprint } from '../src/sync-changes'
const syncFingerprint: Fixture = typed_syncFingerprint
const countChanges: Fixture = typed_countChanges

const workout: Fixture = (id: Fixture, d: Fixture = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const state: Fixture = (over: Fixture = {}) => ({
  _ts: 100, unit: 'kg', restSec: 90, week: { 1: ['r1'] },
  workouts: [workout('w1'), workout('w2', '2026-09-02')],
  bodyweight: [{ d: '2026-09-01', kg: 80 }],
  routines: [{ id: 'r1', name: 'Push', ex: [] }],
  customEx: [], exWeights: { sq: { w: 100 } }, ...over,
})
const clone: Fixture = (v: Fixture) => JSON.parse(JSON.stringify(v))

describe('counting what the server has not seen', () => {
  it('nothing, when the copy is the one the server has', () => {
    const S: Fixture = state()
    expect(countChanges(clone(S), syncFingerprint(S))).toBe(0)
  })

  it('one per added, edited or removed entry', () => {
    const fp: Fixture = syncFingerprint(state())
    const S: Fixture = state()
    S.workouts.push(workout('w3', '2026-09-03'))              // added
    S.workouts[0].entries.push({ ex: 'bench', sets: [] })      // edited
    S.bodyweight = []                                          // removed
    S.routines[0].name = 'Push A'                              // edited
    expect(countChanges(S, fp)).toBe(4)
  })

  it('settings, the plan and working weights count as one change together', () => {
    const fp: Fixture = syncFingerprint(state())
    expect(countChanges(state({ restSec: 60, week: {}, exWeights: {} }), fp)).toBe(1)
  })

  it('the stamp, the revision and the running workout are not changes', () => {
    const fp: Fixture = syncFingerprint(state())
    expect(countChanges(state({ _ts: 999, _rev: 7, active: { id: 'running' } }), fp)).toBe(0)
  })

  it('unknown without a fingerprint to compare with', () => {
    expect(countChanges(state(), null)).toBeNull()
  })
})
