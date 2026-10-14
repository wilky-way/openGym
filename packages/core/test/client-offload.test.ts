import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { mergeStates, highestStamp, stampChange } from '../src/sync-merge'
import { offloadInputs, resetOffload } from '../src/programme-offload'
import type { SyncDoc, SyncProgrammes } from '../src/sync-types'

const definition = (id: string, _ts = 1) => ({ id, name: id, unit: 'kg', weeks: [], _ts })
const marker = (at: number, versionId = 'sha256:synthetic') => ({ versionId, at })
const doc = (programmes: SyncProgrammes, extra: Partial<SyncDoc> = {}): SyncDoc => ({ unit: 'kg', _ts: 1, workouts: [], routines: [], exWeights: {}, programmes, ...extra })
const merge = (a: SyncDoc, b: SyncDoc) => mergeStates(a, b)!

describe('OFFLOAD client contract', () => {
  it('stale legacy copies cannot resurrect offloaded definitions, even with fresh definition stamps', () => {
    const stored = doc({ definitions: [], offloaded: { a: marker(100) } })
    for (const stamp of [1, 100, 1_000_000]) {
      const stale = doc({ definitions: [definition('a', stamp)] }, { _ts: stamp })
      for (const result of [merge(stored, stale), merge(stale, stored)]) {
        expect(result.programmes!.definitions).toEqual([])
        expect(result.programmes!.offloaded).toEqual(stored.programmes!.offloaded)
      }
    }
  })
  it('concurrent offloads join both manifests and keep unrelated definitions', () => {
    const a = doc({ definitions: [definition('b'), definition('c')], offloaded: { a: marker(100) } })
    const b = doc({ definitions: [definition('a'), definition('c')], offloaded: { b: marker(200), a: marker(50, 'sha256:older') } })
    for (const result of [merge(a, b), merge(b, a)]) {
      expect(result.programmes!.definitions!.map(d => d.id)).toEqual(['c'])
      expect(result.programmes!.offloaded).toEqual({ a: marker(100), b: marker(200) })
    }
  })
  it('only a later explicit install marker permits activation and survives stale replay', () => {
    const stale = doc({ definitions: [], offloaded: { a: marker(100) } }, { _ts: 500 })
    for (const at of [99, 100, 101]) {
      const installed = doc({ definitions: [definition('a')], installed: { a: marker(at, 'sha256:new') } })
      const result = merge(stale, installed)
      expect(result.programmes!.definitions!.map(d => d.id)).toEqual(at > 100 ? ['a'] : [])
      expect(result.programmes!.installed).toEqual({ a: marker(at, 'sha256:new') })
      expect(merge(result, stale).programmes!.definitions).toEqual(result.programmes!.definitions)
    }
  })
  it('active and paused cycles protect their definitions, including a stale peer manifest', () => {
    for (const status of ['active', 'paused']) {
      const a = doc({ definitions: [definition('a')], cycles: [{ id: 'c', programmeId: 'a', status, occurrences: [] }] })
      const b = doc({ definitions: [], offloaded: { a: marker(100) } })
      expect(merge(a, b).programmes!.definitions!.map(d => d.id)).toEqual(['a'])
    }
  })
  it('protection records an install through terminal release until an explicit later offload', () => {
    for (const status of ['active', 'paused']) {
      const a = doc({ definitions: [definition('a')], cycles: [{ id: 'c', programmeId: 'a', status, _ts: 1 }] })
      const b = doc({ offloaded: { a: marker(100) }, cycles: [{ id: 'c', programmeId: 'a', status: 'finished', _ts: 2 }] })
      for (const result of [merge(a, b), merge(b, a)]) {
        expect(result.programmes!.installed).toEqual({ a: marker(101) })
        expect(result.programmes!.definitions!.map(d => d.id)).toEqual(['a'])
        expect(merge(result, result)).toEqual(result)
        expect(merge(result, b)).toEqual(result)
        const nextOffload = doc({ offloaded: { a: marker(102) } })
        expect(merge(result, nextOffload).programmes!.definitions).toEqual([])
      }
    }
  })
  it('offload protection is idempotent and absorbs stale peers over 100,000 seeded pairs', () => {
    fc.assert(fc.property(
      fc.constantFrom('a', 'constructor', '__proto__', 'toString'),
      fc.integer({ min: 1, max: 2_000_000_000_000 }), fc.constantFrom('active', 'paused'),
      fc.boolean(), (id, at, status, terminal) => {
        const a = doc({ definitions: [definition(id)], cycles: [{ id: 'c', programmeId: id, status, _ts: 1 }] })
        const b = doc({ offloaded: Object.fromEntries([[id, marker(at)]]), cycles: terminal ? [{ id: 'c', programmeId: id, status: 'finished', _ts: 2 }] : [] })
        for (const result of [merge(a, b), merge(b, a)]) {
          expect(result.programmes!.installed).toEqual(Object.fromEntries([[id, marker(at + 1)]]))
          expect(merge(result, result)).toEqual(result)
          expect(merge(result, b)).toEqual(result)
        }
      }), { seed: 101312, numRuns: 100_000 })
  }, 180_000)
  it('retains synthesized protection at the last accepted offload clock', () => {
    const at = Number.MAX_SAFE_INTEGER - 1
    const a = doc({ definitions: [definition('a')], cycles: [{ id: 'c', programmeId: 'a', status: 'active', _ts: 1 }] })
    const b = doc({ offloaded: { a: marker(at) }, cycles: [{ id: 'c', programmeId: 'a', status: 'finished', _ts: 2 }] })
    const result = merge(a, b)
    expect(result.programmes!.installed).toEqual({ a: marker(Number.MAX_SAFE_INTEGER) })
    expect(merge(result, result)).toEqual(result)
    expect(merge(result, b)).toEqual(result)
    const invalid = merge(a, doc({ offloaded: { a: marker(Number.MAX_SAFE_INTEGER) } }))
    expect(invalid.programmes!.offloaded).toEqual({})
    expect(invalid.programmes!.installed).toBeUndefined()
  })
  it('Reset clears old offload/install clocks while retaining entries created after Reset', () => {
    const programmes = { definitions: [definition('a')], offloaded: { a: marker(10), b: marker(21) }, installed: { a: marker(20), c: marker(22) } }
    expect(resetOffload(programmes, 20).offloaded).toEqual({ b: marker(21) })
    expect(resetOffload(programmes, 20).installed).toEqual({ c: marker(22) })
    const stale = doc(programmes)
    const reset = doc({ definitions: [] }, { resetAt: 20, resetIds: { programmeDefinitions: ['a'] }, _ts: 20 })
    expect(merge(stale, reset).programmes!.offloaded).toEqual({ b: marker(21) })
    expect(merge(stale, reset).programmes!.installed).toEqual({ c: marker(22) })
    expect(merge(stale, reset).programmes!.definitions).toEqual([])
  })
  it('equal Reset clocks retire both manifests before filtering a post-Reset definition', () => {
    const a = doc({ definitions: [definition('a', 30)], offloaded: { a: marker(10) }, installed: { a: marker(20) } }, { resetAt: 20, _ts: 30 })
    const b = doc({ definitions: [], offloaded: { a: marker(20), b: marker(21) }, installed: { b: marker(22) } }, { resetAt: 20, _ts: 20 })
    const before = JSON.stringify([a, b])
    for (const result of [merge(a, b), merge(b, a)]) {
      expect(result.programmes!.definitions!.map(d => d.id)).toEqual(['a'])
      expect(result.programmes!.offloaded).toEqual({ b: marker(21) })
      expect(result.programmes!.installed).toEqual({ b: marker(22) })
      expect(merge(result, result)).toEqual(result)
    }
    expect(JSON.stringify([a, b])).toBe(before)
  })
  it('missing peers filter inactive definitions and protect active or paused ones through terminal release', () => {
    for (const missing of [null, undefined]) {
      for (const status of ['active', 'paused', 'finished', 'archived']) {
        const source = doc({ definitions: [definition('a')], offloaded: { a: marker(100) }, cycles: [{ id: 'c', programmeId: 'a', status, _ts: 1 }] })
        const before = JSON.stringify(source)
        for (const reverse of [false, true]) {
          const adopted = (reverse ? mergeStates(source, missing) : mergeStates(missing, source))!
          const inUse = status === 'active' || status === 'paused'
          expect(adopted.programmes!.definitions!.map(d => d.id)).toEqual(inUse ? ['a'] : [])
          expect(adopted.programmes!.installed).toEqual(inUse ? { a: marker(101) } : undefined)
          const finished = structuredClone(adopted)
          finished.programmes!.cycles![0]!.status = 'finished'
          finished.programmes!.cycles![0]!._ts = 2
          const replayed = merge(finished, finished)
          expect(replayed.programmes!.definitions!.map(d => d.id)).toEqual(inUse ? ['a'] : [])
          expect(replayed.programmes!.installed).toEqual(adopted.programmes!.installed)
          expect(merge(replayed, replayed)).toEqual(replayed)
        }
        expect(JSON.stringify(source)).toBe(before)
      }
    }
  })
  it('missing-peer adoption also retires pre-Reset manifests before protecting definitions', () => {
    const source = doc({ definitions: [definition('a', 30)], offloaded: { a: marker(10), b: marker(21) }, installed: { a: marker(20) }, cycles: [{ id: 'c', programmeId: 'a', status: 'active', _ts: 30 }] }, { resetAt: 20 })
    for (const missing of [null, undefined]) {
      for (const adopted of [mergeStates(missing, source)!, mergeStates(source, missing)!]) {
        expect(adopted.programmes!.definitions!.map(d => d.id)).toEqual(['a'])
        expect(adopted.programmes!.offloaded).toEqual({ b: marker(21) })
        expect(adopted.programmes!.installed).toEqual({})
        const replayed = merge(adopted, adopted)
        expect(replayed.programmes!.definitions).toEqual(adopted.programmes!.definitions)
        expect(replayed.programmes!.offloaded).toEqual(adopted.programmes!.offloaded)
        expect(replayed.programmes!.installed).toEqual(adopted.programmes!.installed)
        expect(merge(replayed, replayed)).toEqual(replayed)
      }
    }
  })
  it('marker clocks participate in causal lifting without mutating either merge input', () => {
    const a = doc({ definitions: [definition('a')], offloaded: { a: marker(100) } })
    const b = doc({ installed: { a: marker(200) } })
    const before = JSON.stringify([a, b])
    const [x, y] = offloadInputs(a.programmes, b.programmes)
    expect(x!.definitions!.map(d => d.id)).toEqual(['a'])
    expect(y!.offloaded).toEqual(a.programmes!.offloaded)
    expect(JSON.stringify([a, b])).toBe(before)
    expect(highestStamp(b)).toBe(200)
    expect(stampChange(b, { ...b, restSec: 120 }, 1)).toBe(201)
  })
})
