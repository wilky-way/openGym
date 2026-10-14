import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExerciseIndex } from '../src/exercises'
import type { ExportPlan, ExportWorkout } from '../src/export-types'
import { buildPlanBundle, parsePlan, mergePlan, planPrintHTML } from '../src/plan-share'
import { workoutFitMessages, workoutFit, encodeFit, MSG, CATEGORY } from '../src/fit-export'
import { workoutText } from '../src/workout-text'
import { workoutCardModel } from '../src/workout-card'

// All custom-index assertions use native exercise catalogue/set kinds/history/analytics outputs.
const customs = [
  { id: 'cx-assist', n: 'Synthetic assisted pullup', bp: 'back', eq: 'leverage machine', assisted: true, custom: true },
  { id: 'cx-body', n: 'Synthetic hold', bp: 'chest', eq: 'body weight', custom: true },
  { id: 'cx-load', n: 'Synthetic dumbbell press', bp: 'chest', eq: 'dumbbell', custom: true },
]
const index = createExerciseIndex(customs)
const source = (): ExportPlan => ({ unit: 'kg', routines: [{ id: 'r', name: '<Synthetic & plan>', ex: [
  { id: 'cx-assist', sets: 2, reps: 8, weight: 20, inc: 5 },
  { id: 'cx-body', mode: 'time', sets: 2, sec: 30, bodyweight: true },
  { id: 'cx-load', sets: 2, reps: 8, weight: 20, inc: 2, dbLoad: 'each' },
] }], customEx: customs, week: { 1: ['r'] } })
const w: ExportWorkout = { id: 'synthetic', d: '2026-10-09', start: 1791565200000, end: 1791567000000, prs: ['cx-assist'], entries: [
  { id: 'cx-assist', sets: [{ w: 20, r: 8, done: true }] },
  { id: 'cx-load', target: { dbLoad: 'each' }, sets: [{ w: 20, r: 8, done: true }] },
] }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('custom exercise index at every dependency call site', () => {
  it('buildPlanBundle forwards cleanEx mode lookup and uses custom bodyweight equipment', () => {
    const s = source(), b = buildPlanBundle(s, 'Synthetic', index)
    expect(b.routines[0]!.ex[1]).not.toHaveProperty('bodyweight')
    expect(b.routines[0]!.ex[1]).toMatchObject({ mode: 'time', sec: 30 })
    expect(buildPlanBundle(s, 'Synthetic').routines[0]!.ex[1]).toHaveProperty('bodyweight', true)
  })
  it('parsePlan resolves index-only customs, preserves custom aliases, and forwards conversion lookup', () => {
    const raw = { opengym_plan: 1, unit: 'kg', routines: source().routines }
    const p = parsePlan(raw, 'lb', index)
    expect(p.dropped).toBe(0)
    expect(p.routines[0]!.ex[0]).toMatchObject({ id: 'cx-assist', weight: 44, inc: 11 })
    expect(parsePlan(raw, 'lb').dropped).toBe(3)
  })
  it('mergePlan forwards conversions and canonicalization without requiring global registration', () => {
    const s: ExportPlan = { unit: 'lb', routines: [], customEx: [], week: {} }
    mergePlan(s, source(), {}, index)
    expect(s.routines[0]!.ex[2]).toMatchObject({ weight: 44, dbLoad: 'each' })
    expect(s.customEx).toHaveLength(3)
    const noCustoms = { ...source(), customEx: [] }
    mergePlan({ unit: 'kg', routines: [], week: {} }, noCustoms, {}, index)
  })
  it('planPrintHTML uses custom names and forwards scheme mode and exLine lookups', () => {
    const s = source(), html = planPrintHTML(s, '<Owner>', {}, index)
    expect(html).toContain('Synthetic assisted pullup')
    expect(html).toContain('&lt;Synthetic &amp; plan&gt;')
    expect(html).toContain('&lt;Owner&gt;')
  })
  it('workoutFitMessages and workoutFit forward itemsOf mode and resolve categories through exOr', () => {
    const m = workoutFitMessages(w, {}, index)
    expect(m.find(x => x.global === MSG.set)!.fields).toContainEqual([7, 'uint16', CATEGORY.pullUp])
    expect(workoutFit(w, {}, index)).toEqual(workoutFit(w, { exOf: id => index[id]! }, index))
  })
  it('workoutText forwards volume and setLabel lookups for custom loaded exercises', () => {
    const text = workoutText(w, { unit: 'kg', nameOf: e => index[e.id]!.n! }, index)
    expect(text).toContain('Synthetic Dumbbell Press')
  })
  it('workoutCardModel forwards custom volume and muscle-map lookups', () => {
    const card = workoutCardModel(w, { unit: 'kg', nameOf: e => index[e.id]!.n! }, index)
    expect(card.records).toEqual(['Synthetic Assisted Pullup'])
  })
})

it('preserves real custom cardio configs and leaves their increment unchanged during conversion', () => {
  const cardio = { id: 'cx-cardio', n: 'Synthetic cardio', bp: 'cardio', eq: 'machine' }
  const cardioIndex = createExerciseIndex([cardio])
  const plan: ExportPlan = { unit: 'kg', week: {}, routines: [{ id: 'cardio-routine', name: 'Synthetic', ex: [{ id: cardio.id, sets: 2, min: 10, speed: 8, inc: 2, lastToFailure: true }] }], customEx: [] }
  expect(buildPlanBundle(plan, 'Synthetic', cardioIndex).routines[0]!.ex[0]).toMatchObject({ id: cardio.id, sets: 2, min: 10, speed: 8, inc: 2 })
  const parsed = parsePlan({ opengym_plan: 1, ...plan }, 'lb', cardioIndex)
  expect(parsed.dropped).toBe(0)
  expect(parsed.routines[0]!.ex[0]).toMatchObject({ id: cardio.id, min: 10, speed: 8, inc: 2 })
  const state: ExportPlan = { unit: 'lb', week: {}, routines: [], customEx: [] }
  mergePlan(state, plan, {}, cardioIndex)
  expect(state.routines[0]!.ex[0]).toMatchObject({ id: cardio.id, min: 10, speed: 8, inc: 2 })
  const html = planPrintHTML(plan, undefined, {}, cardioIndex)
  expect(html).toContain('2 × 10 min @ 8 km/h')
  expect(html).not.toContain('Last set to failure')
  expect(buildPlanBundle(plan, 'Synthetic', cardioIndex).routines[0]!.ex[0]).not.toHaveProperty('lastToFailure')
})
it('preserves a real custom alias shadow in parsed and merged plan ids', () => {
  const shadow = { id: '1019', n: 'Synthetic alias shadow', eq: 'barbell' }
  const shadowIndex = createExerciseIndex([shadow])
  const plan: ExportPlan = { unit: 'kg', week: {}, routines: [{ id: 'alias-routine', name: 'Synthetic', ex: [{ id: shadow.id, sets: 2, reps: 5 }] }], customEx: [] }
  expect(parsePlan({ opengym_plan: 1, ...plan }, 'kg', shadowIndex).routines[0]!.ex[0]!.id).toBe(shadow.id)
  const state: ExportPlan = { unit: 'kg', week: {}, routines: [], customEx: [] }
  mergePlan(state, plan, {}, shadowIndex)
  expect(state.routines[0]!.ex[0]!.id).toBe(shadow.id)
})
it('prints native added bodyweight load through the shared exercise line', () => {
  const plan: ExportPlan = { unit: 'kg', week: {}, routines: [{ id: 'body-routine', name: 'Synthetic', ex: [{ id: 'cx-body', mode: 'time', sets: 2, sec: 30, weight: 10 }] }] }
  expect(planPrintHTML(plan, undefined, {}, index)).toContain('+10 kg')
})
it('exports actual custom-cardio FIT messages and the matching encoded bytes', () => {
  const cardio = { id: 'cx-cardio', n: 'Synthetic running', bp: 'cardio', eq: 'machine' }
  const cardioIndex = createExerciseIndex([cardio])
  const workout: ExportWorkout = { id: 'cardio', d: '2026-10-09', start: 1791565200000, end: 1791565800000, entries: [{ id: cardio.id, sets: [{ min: 10, speed: 8, done: true }] }] }
  const messages = workoutFitMessages(workout, {}, cardioIndex)
  expect(messages.some(m => m.global === MSG.set)).toBe(false)
  expect(messages.some(m => m.global === MSG.lap)).toBe(true)
  expect(workoutFit(workout, {}, cardioIndex)).toEqual(encodeFit(messages))
})
it('exports native custom one-arm volume, set labels and actual muscle-map output', () => {
  const bell = { id: 'cx-one-bell', n: 'Single arm lift', eq: 'dumbbell', muscleWeights: { chest: 1 } }
  const bellIndex = createExerciseIndex([bell])
  const workout: ExportWorkout = { id: 'bell', d: '2026-10-09', prs: [bell.id], entries: [{ id: bell.id, target: { dbLoad: 'each' }, sets: [{ w: 20, r: 8, done: true }] }] }
  const options = { unit: 'kg', nameOf: () => bell.n }
  const text = workoutText(workout, options, bellIndex)
  expect(text).toContain('160 kg')
  expect(text).toContain('20×8')
  const card = workoutCardModel(workout, options, bellIndex)
  expect(card.stats).toContainEqual({ label: 'Volume', value: '160 kg' })
  expect(card.levels).not.toBeNull()
  expect(card.levels!.chest).toBeGreaterThan(0)
  const cardioIndex = createExerciseIndex([{ id: 'cx-cardio', n: 'Synthetic cardio', bp: 'cardio' }])
  const cardio: ExportWorkout = { id: 'cardio', d: '2026-10-09', entries: [{ id: 'cx-cardio', sets: [{ min: 10, speed: 8, done: true }] }] }
  expect(workoutText(cardio, { unit: 'kg', nameOf: () => 'Synthetic cardio' }, cardioIndex)).toContain('10 min @ 8 km/h')
})
