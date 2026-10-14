import { describe, expect, it } from 'vitest'
import { offloadInputs, offloadStamp, resetOffload } from '../src/programme-offload'
import type { SyncProgrammes } from '../src/sync-types'
const mark = (at: number) => ({ versionId: 'sha256:synthetic', at })

describe('programme-offload helpers', () => {
  it('joins authoritative clocks and filters both inputs without changing their source', () => {
    const a: SyncProgrammes = { definitions: [{ id: 'b' }, { id: 'c' }], offloaded: { a: mark(30) } }
    const b: SyncProgrammes = { definitions: [{ id: 'a', _ts: 99999 }, { id: 'c' }], offloaded: { b: mark(20), a: mark(10) } }
    const before = JSON.stringify([a, b])
    const [x, y] = offloadInputs(a, b)
    expect(x!.definitions!.map(d => d.id)).toEqual(['c'])
    expect(y!.definitions!.map(d => d.id)).toEqual(['c'])
    expect(x!.offloaded).toEqual({ a: mark(30), b: mark(20) })
    expect(y!.offloaded).toEqual(x!.offloaded)
    expect(JSON.stringify([a, b])).toBe(before)
  })
  it('install must be strictly later, and in-use definitions always survive', () => {
    for (const at of [29, 30, 31]) {
      const [a] = offloadInputs({ definitions: [{ id: 'a' }], offloaded: { a: mark(30) }, installed: { a: mark(at) } }, undefined)
      expect(a!.definitions!.length).toBe(at > 30 ? 1 : 0)
    }
    for (const status of ['active', 'paused']) {
      const [a] = offloadInputs({ definitions: [{ id: 'a' }] }, { offloaded: { a: mark(30) }, cycles: [{ id: 'cycle', programmeId: 'a', status }] })
      expect(a!.definitions!.map(d => d.id)).toEqual(['a'])
    }
  })
  it('ignores malformed and duplicate cycles as the legacy normalizer does', () => {
    const malformed: SyncProgrammes = JSON.parse('{"definitions":[{"id":"a"}],"cycles":[null,42,"junk",{"programmeId":"a","status":"active"},{"id":"c","programmeId":"a","status":"finished"},{"id":"c","programmeId":"a","status":"active"}],"offloaded":{"a":{"versionId":"sha256:synthetic","at":100}}}')
    const [a] = offloadInputs(malformed, undefined)
    expect(a!.definitions).toEqual([])
    expect(a!.offloaded).toEqual(malformed.offloaded)
  })
  it('returns legacy inputs unchanged when there are no manifests', () => {
    const a = { definitions: [{ id: 'a' }] }
    const [x, y] = offloadInputs(a, null)
    expect(x).toBe(a)
    expect(y).toBeNull()
  })
  it('treats every definition id as data, including object-prototype names', () => {
    const manifests = JSON.parse('{"constructor":{"versionId":"sha256:synthetic","at":30},"__proto__":{"versionId":"sha256:synthetic","at":40}}')
    const [a] = offloadInputs({ definitions: [{ id: 'constructor' }, { id: '__proto__' }, { id: 'toString' }], offloaded: manifests }, undefined)
    expect(a!.definitions!.map(d => d.id)).toEqual(['toString'])
    expect(Object.keys(a!.offloaded!)).toEqual(['constructor', '__proto__'])
    expect(Object.getPrototypeOf(a!.offloaded!)).toBe(Object.prototype)
    const [x, y] = offloadInputs({ offloaded: { other: mark(20) }, definitions: [] }, { definitions: [{ id: 'constructor' }, { id: '__proto__' }, { id: 'toString' }] })
    expect(y!.definitions!.map(d => d.id)).toEqual(['constructor', '__proto__', 'toString'])
    const tricky = Object.fromEntries(['constructor', '__proto__', 'toString'].map(id => [id, mark(50)]))
    const [joined] = offloadInputs(x, { offloaded: tricky })
    expect(Object.keys(joined!.offloaded!)).toEqual(['other', 'constructor', '__proto__', 'toString'])
    for (const id of ['constructor', '__proto__', 'toString']) expect(joined!.offloaded![id]).toEqual(mark(50))
  })
  it('equal-clock manifest conflicts choose the same version in both directions', () => {
    const a = { offloaded: { a: { at: 100, versionId: 'sha256:a' } } }
    const b = { definitions: [{ id: 'a' }], cycles: [{ id: 'c', programmeId: 'a', status: 'active' }], offloaded: { a: { at: 100, versionId: 'sha256:z' } } }
    for (const [x, y] of [offloadInputs(a, b), offloadInputs(b, a)]) {
      expect(x!.offloaded).toEqual({ a: { at: 100, versionId: 'sha256:z' } })
      expect(x!.installed).toEqual({ a: { at: 101, versionId: 'sha256:z' } })
      expect(JSON.stringify(x!.installed)).toBe(JSON.stringify(y!.installed))
    }
    const [absent] = offloadInputs(a, { cycles: b.cycles })
    expect(absent!.installed).toBeUndefined()
  })
  it('malformed manifest markers cannot poison the causal stamp', () => {
    const p: SyncProgrammes = JSON.parse('{"offloaded":{"string":{"versionId":"sha256:x","at":"1e309"},"missingVersion":{"at":9999},"null":null},"installed":{"valid":{"versionId":"sha256:x","at":30}}}')
    expect(offloadStamp(p)).toBe(30)
    const [joined] = offloadInputs(p, undefined)
    expect(offloadStamp(joined)).toBe(30)
  })
  it('accepts safe successors and rejects unsafe or fractional manifest clocks consistently', () => {
    const edge = Number.MAX_SAFE_INTEGER
    const p = { offloaded: { valid: mark(edge - 1), boundary: mark(edge), unsafe: mark(edge + 1), fractional: mark(1.5), infinite: mark(Infinity) }, installed: { valid: mark(edge), unsafe: mark(edge + 1) } }
    const [joined] = offloadInputs(p, undefined)
    expect(joined!.offloaded).toEqual({ valid: mark(edge - 1) })
    expect(joined!.installed).toEqual({ valid: mark(edge) })
    expect(offloadStamp(p)).toBe(edge)
    expect(resetOffload(p, 1).offloaded).toEqual({ valid: mark(edge - 1) })
    expect(resetOffload(p, 1).installed).toEqual({ valid: mark(edge) })
  })
  it('clears clocks through Reset and measures both manifest clocks', () => {
    const p = { offloaded: { a: mark(20), b: mark(21) }, installed: { a: mark(19), c: mark(22) } }
    expect(resetOffload(p, 20)).toEqual({ offloaded: { b: mark(21) }, installed: { c: mark(22) } })
    expect(offloadStamp(p)).toBe(22)
    expect(resetOffload(p, 0)).toBe(p)
  })
})
