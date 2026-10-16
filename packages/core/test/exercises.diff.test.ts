import { afterEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error Oracle JS has no declarations; imports remain differential-test-only.
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/exercises.js'
import * as current from '../src/exercises'
import type { Exercise } from '../src/exercises'

const equal = (a: unknown, b: unknown) => {
  expect(a).toEqual(b)
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
}
const runs = { seed: 303031, numRuns: Number(process.env.PARITY_RUNS ?? 1000) }
const baseline = Object.getOwnPropertyDescriptors(legacy.EXIDX)
function cleanOracle() {
  legacy.registerCustom([])
  for (const id of Object.getOwnPropertyNames(legacy.EXIDX)) delete legacy.EXIDX[id]
  Object.defineProperties(legacy.EXIDX, baseline)
}
afterEach(cleanOracle)
const exercise = fc.record({
  id: fc.string({ minLength: 1, maxLength: 12 }).map(x => 'cx-' + x),
  n: fc.constantFrom('dumbbell bench press', 'Sýnthetic rówing', 'assisted chin-up', 'barbell squat', 'time sprint'),
  bp: fc.constantFrom('back', 'chest', 'upper legs', 'cardio', 'waist'),
  eq: fc.constantFrom('dumbbell', 'leverage machine', 'body weight', 'custom', 'band'),
  tg: fc.constantFrom('lats', 'quads', 'abs', 'pectorals'),
  sm: fc.oneof(fc.array(fc.constantFrom('triceps', 'deltoids', 'rear deltoids')), fc.string()),
  custom: fc.boolean(), assisted: fc.boolean()
})

describe('exercise catalogue differential parity', () => {
  it('preserves catalogue overlays, hidden aliases and enumeration order', () => {
    equal(current.CATALOGUE, legacy.CATALOGUE)
    equal(current.EXIDX, legacy.EXIDX)
    equal(current.BODYPARTS, legacy.BODYPARTS)
    for (const id of Object.getOwnPropertyNames(legacy.EXIDX)) {
      equal(current.EXIDX[id], legacy.EXIDX[id])
      expect(Object.getOwnPropertyDescriptor(current.EXIDX, id)?.enumerable)
        .toBe(Object.getOwnPropertyDescriptor(legacy.EXIDX, id)?.enumerable)
      equal(current.canonicalExId(id), legacy.canonicalExId(id))
    }
  })

  it('matches legacy search, scores, order and similar results on seeded lists', () => {
    fc.assert(fc.property(
      fc.array(exercise, { maxLength: 15 }),
      fc.constantFrom('', 'db bp', 'bnech press', 'back', 'squat', 'row', 'rowing', 'triceps', 'press bench', 'pullup', 'sýnthetic'),
      (customs, query) => {
        const list: Exercise[] = [...customs, ...current.CATALOGUE.slice(0, 20)]
        equal(current.searchExercises(list, query), legacy.searchExercises(list, query))
        const found = current.searchExercises(list, query)
        equal(current.similarExercises(list, query, found, 5), legacy.similarExercises(list, query, found, 5))
        for (const ex of customs) {
          equal(current.searchScore(ex, query), legacy.searchScore(ex, query))
          equal(current.matchExercise(ex, query), legacy.matchExercise(ex, query))
        }
      }
    ), runs)
  })

  it('matches legacy custom registration, replacement, helpers and reset', () => {
    fc.assert(fc.property(fc.array(exercise, { maxLength: 12 }), customs => {
      const legacyInput = structuredClone(customs), currentInput = structuredClone(customs)
      legacy.registerCustom(legacyInput)
      const index = current.registerCustom(currentInput)
      equal(legacyInput, customs)
      equal(currentInput, customs)
      equal(Object.keys(index), Object.keys(legacy.EXIDX))
      equal(Object.fromEntries(customs.map(ex => [ex.id, index[ex.id]])), Object.fromEntries(customs.map(ex => [ex.id, legacy.EXIDX[ex.id]])))
      for (const ex of customs) {
        equal(current.isCustomEx(ex, index), legacy.isCustomEx(ex))
        equal(current.isCustomEx({ ...ex }, index), legacy.isCustomEx({ ...ex }))
        equal(current.exOr(ex.id, index), legacy.exOr(ex.id))
        equal(current.isAssisted(ex.id, index), legacy.isAssisted(ex.id))
        equal(current.isCardio(ex.id, index), legacy.isCardio(ex.id))
        equal(current.isLoadedEq(ex.id, index), legacy.isLoadedEq(ex.id))
        equal(current.isBodyweightEq(ex.id, index), legacy.isBodyweightEq(ex.id))
        equal(current.defaultIncrement(ex.id, 'lb', index), legacy.defaultIncrement(ex.id, 'lb'))
        equal(current.betterWeight(ex.id, 30, 20, index), legacy.betterWeight(ex.id, 30, 20))
        equal(current.beatsWeight(ex.id, 20, 30, index), legacy.beatsWeight(ex.id, 20, 30))
        equal(current.smOf(ex), legacy.smOf(ex))
      }
      legacy.registerCustom([])
      equal(Object.keys(current.registerCustom([])), Object.keys(legacy.EXIDX))
    }), runs)
  }, 60_000)

  it('pins catalogue order after the two-command built-in shadow and reset', () => {
    cleanOracle()
    const shadow = { id: '0025', n: 'Synthetic shadow' }
    legacy.registerCustom([shadow])
    const old = current.registerCustom([shadow])
    legacy.registerCustom([])
    const reset = current.registerCustom([])
    expect(reset['0025']).toEqual(legacy.EXIDX['0025'])
    expect(Object.keys(reset)).toEqual(Object.keys(current.EXIDX))
    expect(Object.keys(legacy.EXIDX).at(-1)).toBe('0025')
    expect(Object.keys(reset).at(-1)).not.toBe('0025')
    expect(old['0025']).toBe(shadow)
    equal(current.searchExercises(current.allExercises({ customEx: [] }), 'squat'),
      legacy.searchExercises(legacy.allExercises({ customEx: [] }), 'squat'))
  })

  it('preserves fresh index and custom insertion order around a catalogue collision', () => {
    cleanOracle()
    const customs = [{ id: 'own-2', n: 'Second' }, { id: '0025', n: 'Shadow' }, { id: 'own', n: 'First' }]
    legacy.registerCustom(structuredClone(customs))
    const index = current.registerCustom(structuredClone(customs))
    equal(Object.keys(index), Object.keys(legacy.EXIDX))
    expect(Object.keys(index).filter(id => !Object.hasOwn(current.EXIDX, id))).toEqual(['own-2', 'own'])
  })

  it('matches stateful registration, duplicate ids, catalogue collisions, lookup and search commands', () => {
    type Model = { customs: Exercise[] }
    type Real = { index: current.ExerciseIndex }
    const baseBytes = JSON.stringify(current.EXIDX)
    const ids = ['0025', '0027', '0043', 'own', 'own-2', '', '  ', 'é', 'Ω', '0000']
    const idArb = fc.constantFrom(...ids)
    const customArb = fc.record({
        id: idArb,
        n: fc.oneof(fc.constantFrom('', 'Bench Press', ' bench  press ', 'Sýnthetic rówing', 'ASSISTED CHIN-UP', '中文 Ω', 'x'.repeat(4096)), fc.string({ maxLength: 70 })),
        bp: fc.constantFrom('back', 'chest', 'cardio', 'upper legs'),
        eq: fc.constantFrom('barbell', 'leverage machine', 'body weight', 'custom'),
        tg: fc.constantFrom('lats', 'quads', 'pectorals'),
        custom: fc.boolean(), assisted: fc.boolean()
    })
    const lookup = (id: string, index: current.ExerciseIndex) => {
      equal(index[id], legacy.EXIDX[id])
      equal(current.canonicalExId(id, index), legacy.canonicalExId(id))
      equal(current.exOr(id, index), legacy.exOr(id))
      equal(current.isCardio(id, index), legacy.isCardio(id))
      equal(current.isAssisted(id, index), legacy.isAssisted(id))
      equal(current.isBodyweightEq(id, index), legacy.isBodyweightEq(id))
      equal(current.isLoadedEq(id, index), legacy.isLoadedEq(id))
      equal(current.defaultIncrement(id, 'lb', index), legacy.defaultIncrement(id, 'lb'))
      equal(current.betterWeight(id, 30, 20, index), legacy.betterWeight(id, 30, 20))
      equal(current.beatsWeight(id, 20, 30, index), legacy.beatsWeight(id, 20, 30))
    }
    class Register implements fc.Command<Model, Real> {
      constructor(readonly customs: Exercise[]) {}
      check() { return true }
      run(model: Model, real: Real) {
        const old = real.index, bytes = JSON.stringify(old), keys = Object.getOwnPropertyNames(old)
        const legacyInput = structuredClone(this.customs), currentInput = structuredClone(this.customs)
        legacy.registerCustom(legacyInput)
        real.index = current.registerCustom(currentInput)
        equal(legacyInput, this.customs)
        equal(currentInput, this.customs)
        model.customs = this.customs
        equal(JSON.stringify(old), bytes)
        equal(Object.getOwnPropertyNames(old), keys)
        equal(JSON.stringify(current.EXIDX), baseBytes)
        equal(Object.keys(real.index).filter(id => !Object.hasOwn(current.EXIDX, id)),
          Object.keys(legacy.EXIDX).filter(id => !Object.hasOwn(current.EXIDX, id)))
        // The ordering waiver applies only to index enumeration, never lookups.
        for (const id of ids) lookup(id, real.index)
        for (const ex of this.customs) equal(current.isCustomEx({ ...ex }, real.index), legacy.isCustomEx({ ...ex }))
      }
      toString() { return `register(${JSON.stringify(this.customs)})` }
    }
    class Lookup implements fc.Command<Model, Real> {
      constructor(readonly id: string) {}
      check() { return true }
      run(_model: Model, real: Real) { lookup(this.id, real.index) }
      toString() { return `lookup(${JSON.stringify(this.id)})` }
    }
    class Search implements fc.Command<Model, Real> {
      constructor(readonly query: string) {}
      check() { return true }
      run(model: Model) {
        const currentInput = structuredClone(model.customs), legacyInput = structuredClone(model.customs)
        const a = current.allExercises({ customEx: currentInput })
        const b = legacy.allExercises({ customEx: legacyInput })
        const found = current.searchExercises(a, this.query)
        equal(found, legacy.searchExercises(b, this.query))
        equal(current.similarExercises(a, this.query, found, 7), legacy.similarExercises(b, this.query, legacy.searchExercises(b, this.query), 7))
        for (const ex of model.customs) {
          equal(current.searchScore(structuredClone(ex), this.query), legacy.searchScore(structuredClone(ex), this.query))
          equal(current.matchExercise(structuredClone(ex), this.query), legacy.matchExercise(structuredClone(ex), this.query))
        }
        equal(currentInput, model.customs)
        equal(legacyInput, model.customs)
      }
      toString() { return `search(${JSON.stringify(this.query)})` }
    }
    const commands = fc.commands([
      fc.array(customArb, { maxLength: 5 }).map(xs => new Register(xs)),
      fc.constant(new Register([])),
      idArb.map(id => new Lookup(id)),
      fc.oneof(fc.constantFrom('', ' ', '\t', 'db bp', 'bnech press', 'squat', 'row', 'owing', 'sýnthetic', 'Ω', '中文', 'x'.repeat(100)), fc.string({ maxLength: 25 })).map(q => new Search(q))
    ], { maxCommands: 8 })
    fc.assert(fc.property(commands, sequence => {
      cleanOracle()
      fc.modelRun(() => ({ model: { customs: [] }, real: { index: current.createExerciseIndex() } }), sequence)
    }), { ...runs, seed: 130303 })
  }, 180_000)
})
