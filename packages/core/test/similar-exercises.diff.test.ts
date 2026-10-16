import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error frozen untyped oracle is imported only for differential tests
import { swapMuscleOf as legacyMuscle, sameMuscleFirst as legacyFirst } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/similar-exercises.js'
import { sameMuscleFirst, swapMuscleOf } from '../src/similar-exercises'
const runs = Math.max(1000, Number(process.env.PARITY_RUNS) || 1000)
const exercise = fc.record({ id: fc.oneof(fc.string(), fc.integer()), tg: fc.oneof(fc.constantFrom('chest', 'back', ''), fc.jsonValue()),
  eq: fc.oneof(fc.constantFrom('db', 'bb', ''), fc.jsonValue()) })

describe('similar exercises legacy twin', () => {
  it('matches exact primary target, source exclusion, equipment priority and serialized order', () => {
    fc.assert(fc.property(fc.array(fc.option(exercise, { nil: null }), { maxLength: 40 }), fc.option(exercise, { nil: null }), (list, ex) => {
      const before = structuredClone({ list, ex })
      expect(swapMuscleOf(ex)).toBe(legacyMuscle(ex))
      const old = legacyFirst(list, ex), next = sameMuscleFirst(list, ex)
      expect(next).toEqual(old)
      expect(JSON.stringify(next)).toBe(JSON.stringify(old))
      expect({ list, ex }).toEqual(before)
      expect(next).not.toBe(list)
    }), { seed: 141212, numRuns: runs })
  }, Math.max(30_000, runs * 5))

  it('keeps stable favourites order within each equipment half without cloning candidates', () => {
    const ex = { id: 'source', tg: 'chest', eq: 'db' }
    const list = [{ id: 'other-a', tg: 'chest', eq: 'bb' }, { id: 'db-a', tg: 'chest', eq: 'db' },
      { id: 'other-b', tg: 'chest', eq: 'bb' }, ex, { id: 'db-b', tg: 'chest', eq: 'db' },
      { id: 'different', tg: 'back', eq: 'db' }]
    const result = sameMuscleFirst(list, ex)
    expect(result.map(v => v.id)).toEqual(['db-a', 'db-b', 'other-a', 'other-b'])
    expect(result[0]).toBe(list[1])
    expect(result[2]).toBe(list[0])
    expect(list.map(v => v.id)).toEqual(['other-a', 'db-a', 'other-b', 'source', 'db-b', 'different'])
    expect(sameMuscleFirst(list, { ...ex, eq: '' }).map(v => v.id)).toEqual(['other-a', 'db-a', 'other-b', 'db-b'])
  })

  it('does not inspect the list without a target and preserves primitive muscle boundaries', () => {
    for (const ex of [null, undefined, false, 0, '', 'text', 1n, Symbol('exercise'), { tg: 1 }, { tg: ['chest'] }]) {
      expect(swapMuscleOf(ex)).toBe(legacyMuscle(ex))
      expect(swapMuscleOf(ex)).toBe('')
    }
    expect(sameMuscleFirst([], undefined)).toEqual([])
    expect(sameMuscleFirst([], { tg: '' })).toEqual([])
  })
})
