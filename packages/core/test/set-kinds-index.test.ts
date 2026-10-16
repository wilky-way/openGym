// Native K03 integration: actual custom-exercise outputs, without contract doubles.
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import type { ExerciseIndex } from '@opengym/core/exercises.js'
import { EXIDX, createExerciseIndex } from '@opengym/core/exercises.js'
import { usesBar, barWeightFor } from '@opengym/core/bar.js'
import { backoffStepOf } from '@opengym/core/backoff.js'
import { inclineFits } from '@opengym/core/incline.js'
import {
  isBellEx, isOneArm, bellsIn, dbLoadFor, withMeaning, volumeFactor,
  meaningFactor, entryAs, workoutAs, historyAs, ownedWeightsFor,
} from '@opengym/core/dumbbells.js'

const bar = { id: 'k05-custom-bar', eq: 'trap bar' }
const single = { id: 'k05-custom-single', eq: 'dumbbell', n: 'Single arm press' }
const pair = { id: 'k05-custom-pair', eq: 'dumbbell', n: 'Two arm press' }
const heavy = { id: 'k05-custom-heavy', eq: 'leverage machine', bp: 'upper legs' }
const assisted = { id: 'k05-custom-assisted', eq: 'leverage machine', n: 'Assisted dip' }
const cardio = { id: 'k05-custom-cardio', n: 'Escalier libre' }
const index: ExerciseIndex = createExerciseIndex([bar, single, pair, heavy, assisted, cardio])
const singleCfg = { id: single.id, dbLoad: 'total' }
const entry = { id: single.id, target: { dbLoad: 'total' }, sets: [{ w: 20, r: 8, done: true }], topW: 20 }
const workout = { entries: [entry] }
const profile = { unit: 'kg', dbLoad: { [single.id]: 'total' }, dumbbells: { kg: { weights: [10, 20] } }, workouts: [workout] }


describe('set kinds with caller-owned custom exercise index', () => {
  it('usesBar resolves the custom equipment without changing the default index', () => {
    expect(usesBar(bar.id)).toBe(false)
    expect(usesBar(bar.id, index)).toBe(true)
    expect(EXIDX[bar.id]).toBeUndefined()
  })
  it('barWeightFor resolves defaults and overrides for a custom bar', () => {
    expect(barWeightFor({ unit: 'kg' }, bar.id, index)).toBe(25)
    expect(barWeightFor({ barWeights: { [bar.id]: 0 } }, bar.id, index)).toBe(0)
    expect(barWeightFor({}, bar.id)).toBeNull()
  })
  it('backoffStepOf forwards the index to the custom assisted lookup', () => {
    const cfg = { id: assisted.id, backoff: true }
    expect(backoffStepOf(cfg, 'kg')).toBe(2.5)
    expect(backoffStepOf(cfg, 'kg', index)).toBe(0)
  })
  it('backoffStepOf forwards the index to the custom default increment lookup', () => {
    const cfg = { id: heavy.id, backoff: true }
    expect(backoffStepOf(cfg, 'kg', index)).toBe(5)
    expect(backoffStepOf(cfg, 'lb', index)).toBe(10)
  })
  it('inclineFits forwards membership for an unflagged custom cardio exercise', () => {
    expect(inclineFits(cardio)).toBe(false)
    expect(inclineFits(cardio, index)).toBe(true)
  })
  it('isBellEx looks up custom bell equipment', () => {
    expect(isBellEx(single.id)).toBe(false)
    expect(isBellEx(single.id, index)).toBe(true)
  })
  it('isOneArm looks up the custom name', () => {
    expect(isOneArm(singleCfg)).toBe(false)
    expect(isOneArm(singleCfg, index)).toBe(true)
  })
  it('bellsIn forwards the index to the one-arm lookup', () => {
    expect(bellsIn(singleCfg)).toBe(2)
    expect(bellsIn(singleCfg, index)).toBe(1)
  })
  it('dbLoadFor accepts the trailing index while keeping stored meanings', () => {
    expect(dbLoadFor(profile, single.id, index)).toBe('total')
    expect(dbLoadFor(profile, { id: single.id, dbLoad: 'each' }, index)).toBe('each')
  })
  it('withMeaning preserves the optional id slot before the trailing index', () => {
    expect(withMeaning(profile, singleCfg, undefined, index)).toEqual(singleCfg)
    expect(withMeaning(profile, {}, single.id, index)).toEqual({ dbLoad: 'total' })
  })
  it('volumeFactor forwards the index through the entry config', () => {
    const each = { ...entry, target: { dbLoad: 'each' } }
    expect(volumeFactor(each)).toBe(2)
    expect(volumeFactor(each, index)).toBe(1)
  })
  it('meaningFactor keeps custom one-arm meanings equivalent', () => {
    expect(meaningFactor('total', 'each', singleCfg)).toBe(0.5)
    expect(meaningFactor('total', 'each', singleCfg, index)).toBe(1)
  })
  it('entryAs forwards the index before scaling nested sets and top weight', () => {
    expect(entryAs(entry, 'each').sets).toEqual([{ w: 10, r: 8, done: true }])
    expect(entryAs(entry, 'each', index)).toBe(entry)
  })
  it('workoutAs forwards the index to entryAs', () => {
    expect(workoutAs(workout, single.id, 'each')).not.toBe(workout)
    expect(workoutAs(workout, single.id, 'each', index)).toBe(workout)
  })
  it('historyAs forwards the index to workoutAs', () => {
    expect(historyAs(profile, single.id, 'each')).not.toBe(profile)
    expect(historyAs(profile, single.id, 'each', index)).toBe(profile)
  })
  it('a custom dumbbell shadow changes the native bodyweight default', () => {
    const shadow = createExerciseIndex([{ id: '1049', eq: 'dumbbell', n: 'Custom press' }])
    expect(ownedWeightsFor(profile, { id: '1049' }, shadow)).toEqual([10, 20])
    expect(ownedWeightsFor(profile, { id: '1049' })).toBeNull()
  })
  it('ownedWeightsFor forwards the index to equipment, bodyweight and bell count lookups', () => {
    expect(ownedWeightsFor(profile, singleCfg)).toBeNull()
    expect(ownedWeightsFor(profile, singleCfg, index)).toEqual([10, 20])
    expect(ownedWeightsFor(profile, { id: pair.id, dbLoad: 'total' }, index)).toEqual([20, 40])
    expect(ownedWeightsFor(profile, { ...singleCfg, bodyweight: true }, index)).toBeNull()
  })
})


it('pins the two inert dbLoadFor index forwards structurally', () => {
  // Inert proof: dbLoadFor's body never reads index; it only reads stored meanings.
  const ast = parse(readFileSync(new URL('../src/dumbbells.ts', import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
  const calls: any[] = []
  let definition: any
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'dbLoadFor') definition = node
    if (node.type === 'CallExpression' && node.callee?.name === 'dbLoadFor') calls.push(node)
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(key)) continue
      if (Array.isArray(value)) value.forEach(walk)
      else walk(value)
    }
  }
  walk(ast)
  expect(calls).toHaveLength(2)
  expect(calls.map(call => call.arguments.at(-1)?.name)).toEqual(['index', 'index'])
  expect(definition).toBeDefined()
  const bodyNames: string[] = []
  const identifiers = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'Identifier') bodyNames.push(node.name)
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(key)) continue
      if (Array.isArray(value)) value.forEach(identifiers)
      else identifiers(value)
    }
  }
  identifiers(definition.body)
  expect(bodyNames).not.toContain('index')
})
