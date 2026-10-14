// Loose fixture calls preserve legacy malformed-input and partial-state cases; production exports are strict.
import { beforeEach as freezeEach, afterEach as thawEach, vi as clock } from 'vitest'
freezeEach(() => { clock.useFakeTimers({ toFake: ['Date'] }); clock.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
thawEach(() => clock.useRealTimers())
/* The same CSV imported on two devices before they synced made every session (and every custom
   exercise) twice: random ids each time, and the merge unites by id. Import ids now come from what
   is imported. (QA 2026-10-06, also in v1.3.9.) */
import { describe, expect, it } from 'vitest'
import { parseWorkoutCSV as typed_parseWorkoutCSV, mergeImport as typed_mergeImport } from '../src/import-csv'
const parseWorkoutCSV = typed_parseWorkoutCSV as (...args: any[]) => any
const mergeImport = typed_mergeImport as (...args: any[]) => any
import { mergeStates } from '@opengym/core/sync-merge'

const CSV = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2026-09-01 18:00:00,Push,1h,Bench Press (Barbell),1,80,5,0,0,,,',
  '2026-09-01 18:00:00,Push,1h,Grip Trainer Deluxe,1,30,10,0,0,,,',
  '2026-09-03 18:00:00,Pull,1h,Deadlift (Barbell),1,140,5,0,0,,,',
].join('\n')
const base = () => ({ _ts: 1, workouts: [], customEx: [], bodyweight: [], exWeights: {}, routines: [] })

describe('the same import on two devices', () => {
  it('merges into one copy of each session and custom exercise', () => {
    const A = base(), B = base()
    mergeImport(A, parseWorkoutCSV(CSV, { unit: 'kg' })); A._ts = 10
    mergeImport(B, parseWorkoutCSV(CSV, { unit: 'kg' })); B._ts = 20
    expect(A.workouts).toHaveLength(2)
    const M = mergeStates(A, B)
    expect(M.workouts).toHaveLength(2)
    expect(M.customEx).toHaveLength(A.customEx.length)
  })
  it('different sessions still get different ids', () => {
    const p = parseWorkoutCSV(CSV, { unit: 'kg' })
    expect(new Set(p.workouts.map((w: any) => w.id)).size).toBe(2)
  })
})
