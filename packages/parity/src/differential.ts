import assert from 'node:assert/strict'
import fc from 'fast-check'
export { default as fc } from 'fast-check'
export const DIFFERENTIAL_SEED = 20261012
/** Deep equality alone hides the key order the sync algorithm uses for change detection. */
export function assertDifferentialEqual(legacy: unknown, next: unknown): void {
  assert.deepStrictEqual(next, legacy)
  assert.equal(JSON.stringify(next), JSON.stringify(legacy), 'Differential JSON.stringify order/bytes drift')
}
type Outcome = { ok: true; value: unknown; args: unknown[] } | { ok: false; error: { name: string; message: string }; args: unknown[] }
async function evaluate<Args extends unknown[]>(fn: (...args: Args) => unknown, input: Args): Promise<Outcome> {
  const args = structuredClone(input)
  try { return { ok: true, value: await fn(...args), args } }
  catch (error) { if (!(error instanceof Error)) throw error; return { ok: false, error: { name: error.name, message: error.message }, args } }
}
/** Isolated clones plus mutated arguments cover in-place stampers as well as pure selectors.
 * fast-check failures include seed/path for reproduction and shrink to a minimal input.
 */
export async function differential<Args extends unknown[]>(options: {
  inputs: fc.Arbitrary<Args>
  legacy: (...args: Args) => unknown
  next: (...args: Args) => unknown
  seed?: number
  numRuns?: number
  path?: string
}): Promise<void> {
  const numRuns = options.numRuns ?? (process.env.PARITY_NIGHTLY === '1' ? 100000 : 1000)
  await fc.assert(fc.asyncProperty(options.inputs, async args => {
    const old = await evaluate(options.legacy, args), next = await evaluate(options.next, args)
    assertDifferentialEqual(old, next)
  }), { seed: options.seed ?? DIFFERENTIAL_SEED, numRuns, ...(options.path ? { path: options.path } : {}) })
}
