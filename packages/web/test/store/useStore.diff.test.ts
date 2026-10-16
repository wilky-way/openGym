import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error Frozen oracle JS is intentionally untyped.
import { programmesSinceReset } from '../../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-sync.js'
// @ts-expect-error Frozen oracle JS is intentionally untyped.
import { WC_DEFAULT } from '../../../../packages/parity/fixtures/oracle/frontend/src/lib/workout-controls.js'
// @ts-expect-error Frozen oracle JS is intentionally untyped.
import { DEFAULT_TEMPLATE_ID } from '../../../../packages/parity/fixtures/oracle/frontend/src/lib/structuralBalanceTemplates.js'
import { DEF, adoptedState, freshState, loadState, restartedState, restoredStateFor } from '../../src/store/useStore'
import type { KeyValueStore } from '@opengym/contract/platform/adapters'

// Execute the exact frozen helper block, including its private loadState; no rewritten oracle.
const source = readFileSync(new URL('../../../../packages/parity/fixtures/oracle/frontend/src/store/useStore.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('export const DEF ='), source.indexOf('export const useStore =')).replace(/\bexport /g, '')
const accentSource = readFileSync(new URL('../../../../packages/parity/fixtures/oracle/frontend/src/lib/accent.js', import.meta.url), 'utf8')
const sanitizer = accentSource.slice(accentSource.indexOf('export function sanitizeAccent'), accentSource.indexOf('/** The choice to draw:')).replace('export ', '')
const oracle = new Function('programmesSinceReset', 'WC_DEFAULT', 'DEFAULT_TEMPLATE_ID', 'localStorage', 'navigator',
  "const KEY = 'gym_state_v1', RTL_LANGS = new Set(['ar', 'fa', 'he', 'ur']), DEFAULT_ACCENT = 'lime', KEY_ACCENT = /^[a-z][a-z0-9-]{0,23}$/, HEX = /^#[0-9a-f]{6}$/i;\n" +
  "const cleanHex = v => typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null;\n" +
  sanitizer.replace('KEY.test(', 'KEY_ACCENT.test(') + helpers +
  '\nreturn {DEF, freshState, restartedState, loadState, adoptedState, restoredStateFor}')
let raw: string | null = null
const legacy = oracle(programmesSinceReset, WC_DEFAULT, DEFAULT_TEMPLATE_ID, { getItem: () => raw }, { language: 'en-US' })
const kv: KeyValueStore = { get: () => raw, set() { throw new Error('hydration must not write') }, remove() { throw new Error('hydration must not write') }, subscribe: () => () => {} }
const equal = (a: unknown, b: unknown) => { expect(a).toEqual(b); expect(JSON.stringify(a)).toBe(JSON.stringify(b)) }
const record = fc.record({
  _ts: fc.integer({ min: 0, max: 10000 }), restSec: fc.integer({ min: 0, max: 900 }),
  routines: fc.array(fc.record({ id: fc.string(), name: fc.string(), ex: fc.constant([]) }), { maxLength: 3 }),
  active: fc.option(fc.record({ id: fc.string(), entries: fc.constant([]), future: fc.jsonValue() }), { nil: null }),
  opaque: fc.jsonValue(), accent: fc.oneof(fc.constant('custom'), fc.constant('future-key'), fc.string()),
  accentCustom: fc.oneof(fc.constant('#AbC123'), fc.string()), lang: fc.constant('en'),
})
describe('W06 frozen state helper differential', () => {
  it('matches defaults, new profiles and restarted language metadata byte for byte', () => {
    equal(DEF, legacy.DEF)
    equal(freshState(), legacy.freshState())
    for (const cur of [undefined, { lang: 'en' }, { lang: 'ar', langAuto: true }, { lang: 'de', langAuto: false }]) equal(restartedState(cur), legacy.restartedState(cur))
  })
  it('matches hydration, adoption and restore for 1000 seeded synthetic documents', () => {
    fc.assert(fc.property(record, record, fc.boolean(), (local, remote, dirty) => {
      raw = JSON.stringify(local)
      equal(loadState(kv), legacy.loadState())
      equal(adoptedState(local, remote), legacy.adoptedState(local, remote))
      equal(restoredStateFor(local, remote, dirty), legacy.restoredStateFor(local, remote, dirty))
    }), { seed: 606, numRuns: 1000 })
  })
  it('matches malformed/missing JSON reads and programme omission/reset overlays', () => {
    for (raw of [null, '', '{bad', 'null', 'false', '7', '[]', '{}', '{"active":{"id":"live","unknown":true}}']) equal(loadState(kv), legacy.loadState())
    const local = { resetAt: 50, programmes: { definitions: [{ id: 'old', _ts: 10 }, { id: 'new', _ts: 200 }], cycles: [] } }
    for (const remote of [{}, { resetAt: 100 }, { resetAt: 100, resetIds: { programmeDefinitions: ['old'] } }, { programmes: null }]) equal(adoptedState(local, remote), legacy.adoptedState(local, remote))
  })
})
