import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error Frozen oracle JS is intentionally differential-test-only.
import * as csvOracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/import-csv.js'
// @ts-expect-error Frozen oracle JS is intentionally differential-test-only.
import * as hevyOracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/import-hevy.js'
// @ts-expect-error Synchronize the oracle global with the new caller-owned index.
import * as exerciseOracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/exercises.js'
import * as csv from '../src/import-csv'
import * as hevy from '../src/import-hevy'
import { createExerciseIndex } from '../src/exercises'
const runs = { seed: 707014, numRuns: Number(process.env.PARITY_RUNS ?? 1000) }
const equal = (actual: unknown, expected: unknown) => {
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); vi.spyOn(Math, 'random').mockReturnValue(0.707) })
afterEach(() => { exerciseOracle.registerCustom([]); vi.restoreAllMocks(); vi.useRealTimers() })
const names = fc.constantFrom('Bench Press', 'Zorb Twirl', 'Treadmill', 'Plank', 'constructor', 'Bench Press (Barbell)', 'Stiff-Legged Deadlift')
const units = fc.constantFrom('kg', 'lb')
const csvCell = (s: string) => '"' + s.replaceAll('"', '""') + '"'
const fixtureCorpus = [
  'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment\n2024-03-07,Zorb Twirl,__proto__,50,kg,5,0,km,0,synthetic',
  'Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;RPE\n2024-03-07 23:40;Synthetic;52m;Bench Press;1;52,5;5;0;0;8',
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\nSynthetic,2024-03-07 23:30,2024-03-08 00:30,Note,Bench Press (Barbell),0,Entry note,1,normal,50,5,0,0,8',
  '\uFEFFDate,Exercise,Weight,Reps\r\n2024-03-07,"Synthetic, \"\"quoted\"\"\nrow",50,5',
  'Date,Weight (lbs)\n2024-03-07,176.4',
  '<HealthData><Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="176.4" startDate="2024-03-07 08:00:00 +0000"/></HealthData>',
  'garbage', '', 'Date,Exercise,Weight,Reps\n2024-02-31,Zorb,5,5',
]

describe('import parsers match the frozen oracle on synthetic fixture corpora', () => {
  it('preserves Strong, Hevy, FitNotes, quoted CSV and Health output bytes', () => {
    for (const text of fixtureCorpus) for (const unit of ['kg', 'lb']) {
      equal(csv.parseCSV(text), csvOracle.parseCSV(text))
      equal(csv.parseImport(text, { unit }), csvOracle.parseImport(text, { unit }))
    }
  })

  it('matches CSV dialects, row units, malformed rows and caller-owned custom indices', () => {
    fc.assert(fc.property(fc.array(fc.record({ name: names, weight: fc.integer({ min: -5, max: 5000 }), reps: fc.integer({ min: -1, max: 1001 }), unit: units, kind: fc.constantFrom('normal', 'warmup', 'failure'), effort: fc.constantFrom('', '0', '8.5', '-1', '100') }), { maxLength: 12 }), units, fc.boolean(), (rows, unit, custom) => {
      const customEx = custom ? [{ id: '0025', n: 'synthetic bench', bp: 'cardio', eq: 'custom', custom: true }] : []
      exerciseOracle.registerCustom(customEx)
      const index = createExerciseIndex(customEx)
      const text = ['Date,Exercise,Weight,Weight Unit,Reps,Set Type,RPE', ...rows.map(r => ['2024-03-07', csvCell(r.name), r.weight, r.unit, r.reps, r.kind, r.effort].join(','))].join('\n')
      equal(csv.parseImport(text, { unit, customEx }, index), csvOracle.parseImport(text, { unit, customEx }))
    }), runs)
  }, Math.max(60_000, runs.numRuns * 10))

  it('matches Hevy workout, routine and body parsers, including stable random ids', () => {
    fc.assert(fc.property(fc.array(fc.record({ id: fc.constantFrom('4E5257DE', 'ZZZ1'), title: names, weight: fc.integer({ min: 0, max: 250 }), reps: fc.integer({ min: 0, max: 30 }), seconds: fc.integer({ min: 0, max: 600 }), type: fc.constantFrom('normal', 'warmup', 'failure') }), { maxLength: 8 }), units, (rows, unit) => {
      const templates = rows.map(r => ({ id: r.id, title: r.title, primary_muscle_group: 'lats' }))
      const exercises = rows.map(r => ({ exercise_template_id: r.id, title: r.title, superset_id: 0, sets: [{ weight_kg: r.weight, reps: r.reps, duration_seconds: r.seconds, type: r.type }] }))
      const workouts = [{ id: 'synthetic', title: 'Synthetic', start_time: '2024-03-07T23:30:00Z', end_time: '2024-03-08T00:30:00Z', exercises }]
      const routines = [{ id: 'synthetic', title: 'Synthetic', exercises }]
      equal(hevy.parseHevyWorkouts(workouts, templates, { unit }), hevyOracle.parseHevyWorkouts(workouts, templates, { unit }))
      equal(hevy.parseHevyRoutines(routines, templates, { unit }), hevyOracle.parseHevyRoutines(routines, templates, { unit }))
      const body = rows.map((r, i) => ({ date: `2024-03-${String(i + 1).padStart(2, '0')}`, weight_kg: r.weight }))
      equal(hevy.parseHevyBodyweight(body, { unit }), hevyOracle.parseHevyBodyweight(body, { unit }))
    }), runs)
  }, Math.max(60_000, runs.numRuns * 10))

  it('preserves merge mutations, return values and key order', () => {
    for (const text of fixtureCorpus) {
      const parsed = csv.parseImport(text, {})
      if (parsed.error) continue
      const a: csv.ImportState = { bodyweight: [], workouts: [], customEx: [], exWeights: {} }, b = structuredClone(a)
      equal(csv.mergeImport(a, parsed), csvOracle.mergeImport(b, structuredClone(parsed)))
      equal(a, b)
      equal(csv.mergeImport(a, parsed), csvOracle.mergeImport(b, structuredClone(parsed)))
      equal(a, b)
    }
    const parsed = hevy.parseHevyRoutines([{ id: 'synthetic', title: 'Synthetic', exercises: [{ exercise_template_id: 'ZZZ1', sets: [{ weight_kg: 50, reps: 5 }] }] }], [], {})
    const a: hevy.RoutineImportState = { customEx: [], routines: [] }, b = structuredClone(a)
    equal(hevy.mergeHevyRoutines(a, parsed), hevyOracle.mergeHevyRoutines(b, structuredClone(parsed)))
    equal(a, b)
    equal(hevy.mergeHevyRoutines(a, parsed), hevyOracle.mergeHevyRoutines(b, structuredClone(parsed)))
    equal(a, b)
  })
})
