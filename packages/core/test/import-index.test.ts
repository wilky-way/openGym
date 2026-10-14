import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExerciseIndex, EXIDX } from '../src/exercises'
import { EXALIAS } from '../src/exercises-data'
import { matchExercise, matchHevyTitle, mergeImport, parseImport, parseWorkoutCSV, type ImportState, type WorkoutImport } from '../src/import-csv'
import { buildHevyExerciseMap, matchHevyTemplate, parseHevyRoutines, parseHevyWorkouts, HEVY_ID_MAP, HEVY_TITLE_MAP } from '../src/import-hevy'

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
const custom = { id: '0025', n: 'bench press', bp: 'cardio', eq: 'custom', custom: true }
const index = createExerciseIndex([custom])
const strong = ['Date,Exercise Name,Set Order,Weight,Reps,Seconds', '2024-03-07,Bench Press,1,0,0,60'].join('\n')
const templateId = Object.keys(HEVY_ID_MAP).find(id => (HEVY_ID_MAP as Record<string, string>)[id] === '0025')!
const templates = [{ id: templateId, title: 'Foreign Bench', primary_muscle_group: 'chest' }]
const exercise = { exercise_template_id: templateId, sets: [{ weight_kg: 50, reps: 5 }] }
const workouts = [{ title: 'Synthetic', start_time: '2024-03-07T12:00:00Z', exercises: [exercise] }]
const routines = [{ title: 'Synthetic', exercises: [exercise] }]
const requireWorkout = (value: ReturnType<typeof parseWorkoutCSV>): WorkoutImport => {
  if (value.error) throw new Error(value.error)
  return value
}

describe('import lookup consumers use real caller-owned custom exercise indexes', () => {
  it('preserves fixed catalogue matching while a real custom shadow changes CSV set mode', () => {
    expect(index['0025']).toEqual(custom)
    expect(EXIDX['0025']!.custom).not.toBe(true)
    expect(matchExercise('Bench Press', index)).toBe('0025')
    expect(matchHevyTitle('Bench Press (Barbell)', index)).toBe('0025')
    const baseline = requireWorkout(parseWorkoutCSV(strong))
    const explicit = requireWorkout(parseWorkoutCSV(strong, {}, index))
    expect(baseline.workouts[0]!.entries[0]!.sets[0]).toEqual({ sec: 60, w: 0, done: true })
    expect(explicit.workouts[0]!.entries[0]!.sets[0]).toEqual({ min: 1, speed: 0, done: true })
    expect(parseImport(strong, {}, index)).toEqual(explicit)
  })
  it('uses the supplied native index when deciding whether to install customs', () => {
    const parsed = requireWorkout(parseWorkoutCSV('Date,Exercise,Weight,Reps\n2024-03-07,Synthetic Zorb,50,5'))
    const state: ImportState = { bodyweight: [], workouts: [], customEx: [], exWeights: {} }
    const existing = createExerciseIndex(parsed.customEx)
    expect(mergeImport(state, parsed, existing)).toEqual({ added: 1, skipped: 0 })
    expect(state.customEx).toEqual([])
    expect(state.workouts[0]!.entries[0]!.id).toBe(parsed.customEx[0]!.id)
  })
  it('keeps generated Hevy identities and actual native workout/routine output', () => {
    expect(templateId).toBeTruthy()
    expect(matchHevyTemplate(templates[0], index)).toBe('0025')
    expect(buildHevyExerciseMap(templates, index).get(templateId)).toBe('0025')
    const parsed = parseHevyWorkouts(workouts, templates, {}, index)
    expect(parsed).toMatchObject({ created: 0, matched: 1, matchedSets: 1, customEx: [] })
    expect(parsed.workouts[0]!.entries[0]).toEqual({ id: '0025', sets: [{ w: 50, r: 5, done: true }], topW: 50 })
    expect(parseHevyRoutines(routines, templates, {}, index).routines[0]!.ex).toEqual([{ id: '0025', sets: 1, reps: 5, weight: 50, mode: 'reps' }])
  })
  it('pins why generated Hevy identities never reach a custom-shadowable alias', () => {
    const source = readFileSync(new URL('../src/import-csv.ts', import.meta.url), 'utf8')
    // The private curated CSV alias table is also fixed catalogue-only input.
    const csvAliases = source.slice(source.indexOf('const ALIAS_EX'), source.indexOf('let ALIAS_IDX'))
    const ids = [...csvAliases.matchAll(/:\s*'([0-9]+)'/g)].map(match => match[1]!)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of [...Object.values(HEVY_ID_MAP), ...Object.values(HEVY_TITLE_MAP), ...ids]) {
      expect(Object.hasOwn(EXALIAS, id)).toBe(false)
      expect(EXIDX[id]).toBeTruthy()
      expect(index[id]).toBeTruthy()
    }
  })
})

// Pin the legacy prototype lookup behavior without changing maps or stubbing
// predicates: a real custom id can equal the inherited lookup's property key.
it.each(['__proto__', 'constructor'])('preserves caller-index Hevy lookup output for inherited key %s', key => {
  const inherited = key === '__proto__' ? Object.prototype : Object
  const nativeIndex = createExerciseIndex([{ id: String(inherited), n: 'Synthetic inherited-key lift', eq: 'custom' }])
  const csv = 'start_time,exercise_title,set_index,weight_kg,reps\n2024-03-07,' + key + ',1,50,5'
  const parsed = requireWorkout(parseWorkoutCSV(csv, {}, nativeIndex))
  expect(parsed.created).toBe(0)
  expect(parsed.workouts[0]!.entries[0]!.id).toBe(inherited)
  expect(parsed.workouts[0]!.entries[0]!.sets).toEqual([{ w: 50, r: 5, done: true }])
  expect(buildHevyExerciseMap([{ id: key }], nativeIndex).get(key)).toBe(inherited)
  expect(buildHevyExerciseMap([{ id: key }]).get(key)).toBeNull()
})

// Inert proofs: matchExercise uses the fixed EXDB/name tables; catalogue keys
// remain present in every real index. CSV/Hevy canonicalization sees only these
// non-alias catalogue ids or inherited, non-string map values (which canonicalExId
// passes through unchanged). Prior-custom CSV matches bypass canonicalization.
// The generated own-property ids are pinned above; prototype lookups are covered
// by actual native outputs below, not classified as inert. These three forwards
// have identical current output for all real custom indexes. The other six are
// killed by four actual-output cases and two native required-index TypeErrors.
it('preserves three proven inert import index forwards', () => {
  const inert = [
    ['import-csv.ts', 565, 'canonicalExId'],
    ['import-csv.ts', 565, 'matchExercise'],
    ['import-hevy.ts', 116, 'canonicalExId'],
  ] as const
  type Node = { type?: string; loc?: { start: { line: number } }; callee?: { type?: string; name?: string }; arguments?: { type?: string; name?: string }[]; [key: string]: unknown }
  for (const [file, line, callee] of inert) {
    const ast = parse(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
    const calls: Node[] = []
    function walk(value: unknown) {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(walk); return }
      const node = value as Node
      if (node.type === 'CallExpression' && node.loc?.start.line === line && node.callee?.name === callee) calls.push(node)
      for (const [key, child] of Object.entries(node)) if (!['loc', 'comments'].includes(key)) walk(child)
    }
    walk(ast)
    expect(calls, file + ':' + line).toHaveLength(1)
    expect(calls[0]!.arguments?.at(-1), file + ':' + line).toMatchObject({ type: 'Identifier', name: 'index' })
  }
})
