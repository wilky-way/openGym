import { expect, it } from 'vitest'
import { differential, assertDifferentialEqual, fc, syntheticProfile } from '../src'
it('seeded profiles are repeatable, isolated, ordered and entirely synthetic', () => {
  const first = syntheticProfile(11), second = syntheticProfile(11)
  expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  expect(syntheticProfile(12)).not.toEqual(first)
  first.db.users[0]!.name = 'Changed'
  expect(second.db.users[0]!.name).toBe('Synthetic 1')
  expect(Object.keys(second.docs)).toEqual(['synthetic_u_1', 'synthetic_u_2'])
  const doc = JSON.parse(second.docs.synthetic_u_1!)
  expect(doc.unit).toBe('kg')
  expect(doc.bodyweight[0].w).toBeTypeOf('number')
  expect(doc.workouts[0].entries[0].sets[0]).toMatchObject({ r: expect.any(Number), w: expect.any(Number), done: true })
  expect(() => syntheticProfile(1, { users: -1 })).toThrow()
})
it('differential gate runs 1000 independent clones and observes mutations', async () => {
  let calls = 0
  const input = fc.tuple(fc.record({ n: fc.integer({ min: 0, max: 100 }) }))
  const fn = (v: { n: number }) => { v.n++; calls++; return { z: v.n, a: 1 } }
  await differential({ inputs: input, legacy: fn, next: fn })
  expect(calls).toBe(process.env.PARITY_NIGHTLY === '1' ? 200000 : 2000)
})
it('deep equality plus JSON.stringify detects insertion order drift', async () => {
  expect(() => assertDifferentialEqual({ z: 1, a: 2 }, { a: 2, z: 1 })).toThrow('order/bytes drift')
  await expect(differential({ inputs: fc.constant([{ n: 0 }] as [{ n: number }]), legacy: v => { v.n++; return 0 }, next: (_v: { n: number }) => 0, numRuns: 1 })).rejects.toThrow('Property failed')
})
it('differential supports async functions, matching errors, and reproducible failure seeds', async () => {
  await differential({ inputs: fc.tuple(fc.integer()), legacy: async n => n + 1, next: n => n + 1 })
  await differential({ inputs: fc.constant([] as []), legacy: () => { throw new RangeError('deep') }, next: () => { throw new RangeError('deep') } })
  await expect(differential({ inputs: fc.tuple(fc.integer()), legacy: n => n, next: n => n + 1, numRuns: 1, seed: 77 })).rejects.toThrow('seed: 77')
})
