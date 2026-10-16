import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertionCount, checkAssertionBudget, checkMappingCoverage, type Unit } from '../../../scripts/assertion-budget'
import { assertCount, checkUnmappedTwins, loadPublicParityMap, oraclePath } from '../../../scripts/assert-count'

const repositoryRoot = new URL('../../../', import.meta.url)

test('preserves all 430 historical mappings and 391 distinct assertion roots', () => {
  const units = loadPublicParityMap(), pairs = Object.values(units).flatMap(unit => unit.tests)
  expect(Object.keys(units)).toHaveLength(70)
  expect(pairs).toHaveLength(430)
  expect(new Set(pairs.map(pair => pair.legacy)).size).toBe(391)
  for (const pair of pairs) {
    const old = assertionCount(readFileSync(new URL(oraclePath(pair.legacy), repositoryRoot), 'utf8'))
    const next = assertionCount(readFileSync(new URL(pair.ported, repositoryRoot), 'utf8'))
    const doc = pair.waiver ? readFileSync(new URL(`${pair.ported.split('/').slice(0, 2).join('/')}/PORTING-WAIVERS.md`, repositoryRoot), 'utf8') : ''
    expect(() => checkAssertionBudget(old, next, pair.waiver, doc, pair.ported), pair.ported).not.toThrow()
  }
})
test('rejects unknown groups without loading a private registry', () => {
  expect(() => assertCount('does-not-exist')).toThrow('Unknown unit')
  for (const path of ['legacy/../secret', 'legacy/api/../../secret', 'legacy/api/./file', 'legacy/api/file\\other']) expect(() => oraclePath(path)).toThrow()
})
test('rejects an unregistered legacy filename twin even when another port already maps that source', () => {
  const inventory = new Set(['legacy/frontend/src/lib/example.test.js'])
  const mapped = new Set(['packages/core/test/example.test.ts'])
  expect(() => checkUnmappedTwins(inventory, mapped, [...mapped])).not.toThrow()
  expect(() => checkUnmappedTwins(inventory, mapped, ['packages/web/test/example.test.tsx'])).toThrow('Unregistered legacy test twin')
  expect(() => checkUnmappedTwins(inventory, mapped, ['packages/core/test/new-feature.test.ts', 'packages/core/test/example.diff.test.ts'])).not.toThrow()
})
test('keeps budget and inventory failure controls pure', () => {
  expect(assertionCount('expect(1).toBe(1); assert.equal(2,2); // expect(0)\nconst s="expect(0)"')).toBe(2)
  expect(() => checkAssertionBudget(2, 1, undefined, '')).toThrow()
  for (const waiver of [{ reason: '', assertions: 1 }, { reason: 'why', assertions: -1 }, { reason: 'why', assertions: 0.5 }]) expect(() => checkAssertionBudget(2, 1, waiver, 'why')).toThrow()
  expect(() => checkAssertionBudget(2, 1, { reason: 'why', assertions: 1 }, '')).toThrow()
  expect(() => checkAssertionBudget(2, 1, { reason: 'why', assertions: 1 }, 'why')).not.toThrow()
  const legacy = 'legacy/api/a.test.js', pair = { legacy, ported: 'packages/server/test/a.test.ts' }
  const base: Unit = { packages: ['server'], tests: [pair], legacyTests: [legacy] }
  expect(() => checkMappingCoverage(base, new Set([legacy]), '', 'test')).not.toThrow()
  for (const unit of [{ ...base, legacyTests: [legacy, legacy] }, { ...base, tests: [pair, pair] }, { ...base, tests: [] }, { ...base, legacyTests: [] }, { packages: ['server'], tests: [] }]) expect(() => checkMappingCoverage(unit, new Set([legacy]), '', 'test')).toThrow()
  expect(() => checkMappingCoverage(base, new Set(), '', 'test')).toThrow('unknown')
  expect(() => checkMappingCoverage({ packages: ['server'], tests: [], legacyTests: [], newTestsOnlyReason: 'new' }, new Set(), '', 'test')).toThrow('reviewed reason')
})
