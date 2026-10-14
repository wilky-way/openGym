// Loose fixture calls preserve legacy malformed-input and partial-state cases; production exports are strict.
import { beforeEach as freezeEach, afterEach as thawEach, vi as clock } from 'vitest'
freezeEach(() => { clock.useFakeTimers({ toFake: ['Date'] }); clock.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
thawEach(() => clock.useRealTimers())
/* A name the 1,324-exercise catalogue did not know was imported as a custom exercise (an `im…`
   id). The new catalogue may know it, and the next import of the same account matched it afresh:
   new days on the catalogue id, old ones on the custom one, one exercise's history in two. An
   exercise the user already has keeps its id. */
import { describe, expect, it } from 'vitest'
import { importId as typed_importId, matchExercise as typed_matchExercise, mergeImport as typed_mergeImport, parseWorkoutCSV as typed_parseWorkoutCSV } from '../src/import-csv'
const importId = typed_importId as (...args: any[]) => any
const matchExercise = typed_matchExercise as (...args: any[]) => any
const mergeImport = typed_mergeImport as (...args: any[]) => any
const parseWorkoutCSV = typed_parseWorkoutCSV as (...args: any[]) => any
import { HEVY_ID_MAP as typed_HEVY_ID_MAP, mergeHevyRoutines as typed_mergeHevyRoutines, parseHevyRoutines as typed_parseHevyRoutines, parseHevyWorkouts as typed_parseHevyWorkouts } from '../src/import-hevy'
const HEVY_ID_MAP: Record<string, string> = typed_HEVY_ID_MAP
const mergeHevyRoutines = typed_mergeHevyRoutines as (...args: any[]) => any
const parseHevyRoutines = typed_parseHevyRoutines as (...args: any[]) => any
const parseHevyWorkouts = typed_parseHevyWorkouts as (...args: any[]) => any
import { EXIDX } from '@opengym/core/exercises'

const base = (customEx: any): any => ({ _ts: 1, workouts: [], customEx, bodyweight: [], exWeights: {}, routines: [] })
const custom = (id: any, n: any) => ({ id, n, custom: true, eq: 'custom', tg: '', desc: '', bp: 'chest' })
const ids = (S: any) => new Set(S.workouts.flatMap((w: any) => w.entries.map((e: any) => e.id)))

const CSV = (day: any) => [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  `${day} 18:00:00,Push,1h,Bench Press (Barbell),1,80,5,0,0,,,`,
].join('\n')

describe('re-importing an exercise an earlier import made a custom one', () => {
  it('the catalogue knows the name now; the custom one keeps the history', () => {
    expect(EXIDX[matchExercise('Bench Press (Barbell)')]!).toBeTruthy()
    const own = custom(importId('im', 'Strong|bench press (barbell)'), 'bench press (barbell)')
    const S = base([own])
    S.workouts = [{ id: 'w0', d: '2026-08-01', entries: [{ id: own.id, sets: [{ w: 75, r: 5 }] }] }]
    const parsed = parseWorkoutCSV(CSV('2026-09-01'), { unit: 'kg', customEx: S.customEx })
    expect(parsed.customEx).toEqual([])
    mergeImport(S, parsed)
    expect(ids(S)).toEqual(new Set([own.id]))
    expect(S.customEx).toEqual([own])
  })

  it('found by its name too, renamed only in case and spacing, whatever id it got', () => {
    const own = custom('k3x9old', 'Bench  Press (barbell)')
    const S = base([own])
    mergeImport(S, parseWorkoutCSV(CSV('2026-09-01'), { unit: 'kg', customEx: S.customEx }))
    expect(ids(S)).toEqual(new Set(['k3x9old']))
  })

  it('without a custom one of that name it is matched as before', () => {
    const S = base([])
    mergeImport(S, parseWorkoutCSV(CSV('2026-09-01'), { unit: 'kg', customEx: S.customEx }))
    expect(ids(S)).toEqual(new Set([matchExercise('Bench Press (Barbell)')]))
  })

  it('Hevy: a template the id map has learnt since stays on the custom exercise it was imported as', () => {
    const hid = Object.keys(HEVY_ID_MAP).find((k: any) => EXIDX[(HEVY_ID_MAP as Record<string, string>)[k]!]!)
    const templates: any[] = [{ id: hid, title: 'Some Lift', type: 'weight_reps', primary_muscle_group: 'chest' }]
    const own = custom(importId('im', 'Hevy|' + hid), 'renamed by the user')
    const S = base([own])
    const workout: any = {
      id: 'w1', title: 'Push', start_time: '2026-09-01T10:00:00+00:00', end_time: '2026-09-01T11:00:00+00:00',
      exercises: [{ title: 'Some Lift', exercise_template_id: hid, sets: [{ type: 'normal', weight_kg: 50, reps: 8 }] }],
    }
    const parsed = parseHevyWorkouts([workout], templates, { customEx: S.customEx })
    mergeImport(S, parsed)
    expect(ids(S)).toEqual(new Set([own.id]))
    const routines = parseHevyRoutines([{ id: 'r1', title: 'Push', exercises: [{ exercise_template_id: hid, title: 'Some Lift', sets: [{ type: 'normal', reps: 8 }] }] }], templates, { customEx: S.customEx })
    mergeHevyRoutines(S, routines)
    expect(S.routines[0]!.ex.map((e: any) => e.id)).toEqual([own.id])
    expect(S.customEx).toEqual([own])
  })
})
