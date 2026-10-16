import {beforeEach,afterEach,vi} from 'vitest'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
// Synthetic legacy fixtures deliberately exercise tolerant and malformed persisted shapes.
type LegacyFixture = any
import { describe, it, expect } from 'vitest'
import { normaliseProgrammes as normaliseSync, programmesOf as ofSync } from '@opengym/core/programme-sync'
import { normaliseProgrammes, programmesOf } from '../src/programme'
import { mergeStates, stampChange, resetIdsOf, highestStamp, localExtras } from '@opengym/core/sync-merge'
// @ts-expect-error Frozen oracle JS has no declarations; differential-test-only.
import { stampPut, keepUnknown, highestStamp as apiHighest } from '../../../packages/parity/fixtures/oracle/api/sync-stamps.js'

const copy: LegacyFixture = (x: LegacyFixture) => structuredClone(x)
const state: LegacyFixture = () => ({ unit: 'lb', workouts: [], routines: [], programmes: {
  version: 1, fork: 'wilky/1', definitions: [{ id: 'synthetic', name: 'Synthetic strength' }],
  cycles: [{ id: 'cycle', weekIndex: 1, occurrences: [
    { instanceId: 'c:w1d1', status: 'pending' }, { instanceId: 'c:w1d2', status: 'pending' },
  ] }],
} })
const change: LegacyFixture = (S: LegacyFixture, fn: LegacyFixture, now: LegacyFixture) => { const n: LegacyFixture = copy(S); fn(n); n._ts = stampChange(S, n, now); return n }
const occurrences: LegacyFixture = (S: LegacyFixture) => S.programmes.cycles[0].occurrences

describe('programme storage', () => {
  it.each([undefined, null, 'old', [], 42])('reads garbage %s as empty', (raw: LegacyFixture) => {
    expect(normaliseProgrammes(raw)).toEqual({ version: 1, fork: 'wilky/1', definitions: [], cycles: [] })
  })
  it('keeps unknown fields and future versions, normalising lists without mutation', () => {
    const raw: LegacyFixture = { version: 2, custom: { x: 1 }, definitions: [null, {}, { id: 'd', unknown: 2 }, { id: 'd' }], cycles: [{ id: 'c', occurrences: false }] }
    const before: LegacyFixture = copy(raw)
    expect(programmesOf({ programmes: raw })).toEqual({ ...raw, fork: 'wilky/1', definitions: [{ id: 'd', unknown: 2 }], cycles: [{ id: 'c', occurrences: [] }] })
    expect(raw).toEqual(before)
  })
  it('keeps edits to different occurrences and cycle fields on two devices', () => {
    const base: LegacyFixture = state()
    const a: LegacyFixture = change(base, (S: LegacyFixture) => { occurrences(S)[0].status = 'skipped'; S.programmes.cycles[0].notBefore = '2026-10-13' }, 10)
    const b: LegacyFixture = change(base, (S: LegacyFixture) => { occurrences(S)[1].pinnedOn = '2026-10-15' }, 20)
    for (const merged of [mergeStates(a, b), mergeStates(b, a)]) {
      expect(occurrences(merged)[0].status).toBe('skipped')
      expect(occurrences(merged)[1].pinnedOn).toBe('2026-10-15')
      expect(merged.programmes.cycles[0].notBefore).toBe('2026-10-13')
    }
  })
  it('unions definitions, cycles and occurrences', () => {
    const a: LegacyFixture = state(), b: LegacyFixture = state()
    b.programmes.definitions.push({ id: 'second' })
    b.programmes.cycles.push({ id: 'other', occurrences: [] })
    occurrences(b).push({ instanceId: 'c:w1d3', status: 'pending' })
    const p: LegacyFixture = mergeStates(a, b).programmes
    expect(p.definitions).toHaveLength(2)
    expect(p.cycles).toHaveLength(2)
    expect(p.cycles[0].occurrences).toHaveLength(3)
  })
  it('a finished log beats even a newer skip and retains its actual date', () => {
    const a: LegacyFixture = change(state(), (S: LegacyFixture) => { occurrences(S)[0].status = 'skipped'; occurrences(S)[0].skippedAt = 30; occurrences(S)[0].date = '2026-10-14' }, 30)
    const b: LegacyFixture = state()
    b.workouts.push({ id: 'w', d: '2026-10-12', programmeInstance: { cycleId: 'cycle', instanceId: 'c:w1d1' } })
    for (const merged of [mergeStates(a, b), mergeStates(b, a)]) {
      expect(occurrences(merged)[0].status).toBe('done')
      expect(occurrences(merged)[0].date).toBe('2026-10-12')
      expect(occurrences(merged)[0].skippedAt).toBeUndefined()
    }
  })
  it('a deleted finished log does not leave its cached occurrence done after sync', () => {
    const base: LegacyFixture = state()
    base.workouts.push({ id: 'w', d: '2026-10-12', _ts: 10, programmeInstance: { cycleId: 'cycle', instanceId: 'c:w1d1' } })
    Object.assign(occurrences(base)[0], { status: 'done', date: '2026-10-12', _ts: 10, _f: { status: 10, date: 10 } })
    const deleted: LegacyFixture = copy(base)
    deleted.workouts = []
    deleted.deleted = { workouts: { w: 20 } }
    deleted._ts = 20
    for (const merged of [mergeStates(base, deleted), mergeStates(deleted, base)]) {
      expect(merged.workouts).toEqual([])
      expect(occurrences(merged)[0].status).toBe('pending')
      expect(occurrences(merged)[0].date).toBeUndefined()
    }
  })

  it('keeps the programme key from an unforked writer', () => {
    const cur: LegacyFixture = state(), next: LegacyFixture = { workouts: [], routines: [] }
    keepUnknown(cur, next)
    expect(next.programmes).toEqual(cur.programmes)
    stampPut(cur, next, { overRead: true, now: 100 })
    expect(next.programmes.definitions).toEqual(cur.programmes.definitions)
  })
  it('stamps an API planner per occurrence with frontend clock parity', () => {
    const cur: LegacyFixture = state(), next: LegacyFixture = copy(cur)
    occurrences(next)[1].status = 'skipped'
    stampPut(cur, next, { overRead: true, now: 40 })
    expect(occurrences(next)[1]._f.status).toBe(40)
    expect(occurrences(next)[0]._ts).toBeUndefined()
    expect(highestStamp(next)).toBe(apiHighest(next))
    expect(highestStamp(next)).toBe(40)
  })
  it('ignores unrelated changes and includes programme clocks in monotonic stamping', () => {
    const base: LegacyFixture = change(state(), (S: LegacyFixture) => { occurrences(S)[0].status = 'skipped' }, 100)
    const next: LegacyFixture = change(base, (S: LegacyFixture) => { S.sound = false }, 5)
    expect(occurrences(next)[0]._ts).toBe(100)
    expect(next._ts).toBe(101)
  })
  it('reset does not resurrect the old programs from an offline copy', () => {
    const old: LegacyFixture = state(), fresh: LegacyFixture = { unit: 'lb', _ts: 20, resetAt: 20, resetIds: resetIdsOf(old), workouts: [], routines: [] }
    const p: LegacyFixture = programmesOf(mergeStates(fresh, old))
    expect(p.cycles).toEqual([])
    expect(p.definitions).toEqual([])
  })
  it('counts a guest programme library as setup before adopting an account', () => {
    expect(localExtras(state(), {})).toMatchObject({ setup: 2 })
    expect(localExtras(state(), state()).setup).toBeUndefined()
  })
  it('reset merge keeps a same-id definition stamped after the reset, in either direction', () => {
    const old: LegacyFixture = state(), fresh: LegacyFixture = { unit: 'lb', _ts: 100, resetAt: 100, resetIds: resetIdsOf(old), workouts: [], routines: [] }
    old.programmes.definitions[0]._ts = 200
    old.programmes.cycles[0]._ts = 200
    for (const merged of [mergeStates(old, fresh), mergeStates(fresh, old)]) {
      expect(merged.programmes.definitions.map((d: LegacyFixture) => d.id)).toEqual(['synthetic'])
      expect(merged.programmes.cycles.map((c: LegacyFixture) => c.id)).toEqual(['cycle'])
    }
  })

  it('keeps API helpers byte-identical', () => {
    // Server twins are deleted under R2; both public programme exports use the shared core implementation.
    expect(normaliseProgrammes).toBe(normaliseSync)
    expect(programmesOf).toBe(ofSync)
  })
  it('an eight-week synthetic definition and cycle fit below 150 KB', () => {
    const weeks: LegacyFixture = Array.from({ length: 8 }, (_: LegacyFixture, w: LegacyFixture) => ({ index: w + 1, days: Array.from({ length: 4 }, (_: LegacyFixture, d: LegacyFixture) => ({ key: `d${d + 1}`, sessions: [{ sessionTemplateId: `d${d + 1}`, routineSnapshot: { name: 'Synthetic', ex: Array.from({ length: 8 }, (_: LegacyFixture, e: LegacyFixture) => ({ id: `exercise-${e}`, sets: 4, reps: 8, weight: 100, prog: 'double', target: { rir: 2 } })) } }] })) }))
    const p: LegacyFixture = { version: 1, definitions: [{ id: 'synthetic', weeks }], cycles: [{ id: 'c', snapshot: { weeks }, occurrences: weeks.flatMap((w: LegacyFixture) => w.days.map((d: LegacyFixture) => ({ instanceId: `c:w${w.index}${d.key}`, weekIndex: w.index, dayKey: d.key, status: 'pending' }))) }] }
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(150 * 1024)
  })
})
