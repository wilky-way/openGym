// F3 golden transcripts: every legacy KEEP route and every INV-1..64 is exercised by a recorded scenario,
// each scenario is deterministic across three independent recordings, and each replays on a fresh oracle.
import { beforeAll, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DELETED_ROUTES } from '../../contract/http/api'
import { DEFERRED_INVS, GOLDEN_SCENARIOS, recordScenario, replayOnFreshOracle, type GoldenScenario } from '../src/golden'
import { invOwnerRows, legacyTestNames, renderApiTestMap } from '../src/golden/api-test-map'
import { decodeDocs, encodeDocs, type StoredDocs, type Transcript } from '../src/types'

const mapPath = fileURLToPath(new URL('../api-test-map.md', import.meta.url))

/** Route keys as the legacy server registers them (`{hash}` → `:hash`), minus the contract's deleted routes. */
export function legacyKeepRoutes(): string[] {
  const source = readFileSync(fileURLToPath(new URL('../fixtures/oracle/api/server.js', import.meta.url)), 'utf8')
  const keys = [...source.matchAll(/'((?:GET|POST|PUT|DELETE) \/api\/[^']+)'\s*:\s*async/g)].map(m => m[1]!.replace(/\{(\w+)\}/g, ':$1'))
  return [...new Set(keys)].filter(key => !(DELETED_ROUTES as readonly string[]).includes(key)).sort()
}

const recordings = new Map<string, Transcript>()
beforeAll(async () => {
  for (const scenario of GOLDEN_SCENARIOS) recordings.set(scenario.id, await recordScenario(scenario, { run: 1 }))
}, 180_000)

const routeKeys = (transcript: Transcript) => transcript.steps.flatMap(step => step.kind === 'request'
  ? [`${step.request.method} ${step.request.path.split('?')[0]!.replace(/\/api\/media\/[0-9a-f]{64}$/, '/api/media/:hash')}`] : [])
const covered = () => new Set([...recordings.values()].flatMap(routeKeys))

describe('transcript v2 byte fidelity', () => {
  test('invalid UTF-8 documents are stored as base64 and decode to the same bytes', () => {
    const invalid = Buffer.from([0x7b, 0xff, 0xfe, 0xc3, 0x7d])
    const valid = Buffer.from('{"_rev":1}')
    const docs: StoredDocs = { invalid, valid }
    const serialised = JSON.parse(JSON.stringify(encodeDocs(docs)))
    expect(serialised.invalid.encoding).toBe('base64')
    expect(serialised.valid.encoding).toBe('utf8')
    const decoded = decodeDocs(serialised)
    expect(decoded.invalid!.equals(invalid)).toBe(true)
    expect(decoded.valid!.equals(valid)).toBe(true)
  })
})

describe('golden coverage', () => {
  test('api-test-map.md is current and names every legacy API test', () => {
    const committed = readFileSync(mapPath, 'utf8')
    expect(committed).toBe(renderApiTestMap())
    expect(legacyTestNames().filter(n => !committed.includes(`| ${n.file} | ${n.name.replace(/\|/g, '\\|')} |`))).toEqual([])
  })

  test('every legacy KEEP route is exercised by at least one scenario', () => {
    const missing = legacyKeepRoutes().filter(key => !covered().has(key))
    expect(missing).toEqual([])
    for (const scenario of GOLDEN_SCENARIOS) expect(new Set(routeKeys(recordings.get(scenario.id)!))).toEqual(new Set(scenario.routes))
  })

  test('every contract-deleted route answers 404 in a scenario', () => {
    expect(DELETED_ROUTES.filter(key => !covered().has(key))).toEqual([])
    const deleted = new Set<string>([...DELETED_ROUTES, ...GOLDEN_SCENARIOS.find(s => s.id === 'routes-media')!.routes])
    for (const key of deleted) {
      const responses = [...recordings.values()].flatMap(t => t.steps.filter(step => step.kind === 'request' && routeKeys({ ...t, steps: [step] })[0] === key))
      expect(responses.length, key).toBeGreaterThan(0)
      for (const step of responses) if (step.kind === 'request') expect(step.response.status, key).toBe(404)
    }
  })

  test('every INV-1..64 is exercised by a scenario or deferred with a reason', () => {
    // Count owners only after their scenario completed and recorded real requests.
    const wire = new Set(GOLDEN_SCENARIOS.filter(s => routeKeys(recordings.get(s.id)!).length > 0).flatMap(s => s.invs))
    const missing = Array.from({ length: 64 }, (_, i) => i + 1).filter(n => !wire.has(n) && !(n in DEFERRED_INVS))
    expect(missing).toEqual([])
    expect(Object.keys(DEFERRED_INVS).map(Number).filter(n => wire.has(n))).toEqual([])
  })

  test('every INV-1..64 has exactly one owner row in api-test-map.md', () => {
    const rows = invOwnerRows()
    expect(rows.map(r => r.inv)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1))
    expect(rows.every(r => r.owner.length > 0 && r.testId.length > 0)).toBe(true)
  })

  test('scenario ids are unique', () => {
    const ids = GOLDEN_SCENARIOS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// One scenario per case; each records three times (must be byte-identical after normalisation), then replays.
describe.each(GOLDEN_SCENARIOS.map(s => [s.id, s] as const))('golden %s', (_id, scenario: GoldenScenario) => {
  test('three recordings are identical and each replays on a fresh oracle', { timeout: 180_000 }, async () => {
    const first = recordings.get(scenario.id)!
    await recordScenario(scenario, { run: 2, expected: first })
    await recordScenario(scenario, { run: 3, expected: first })
    await replayOnFreshOracle(first)
  })
})
