import { describe, expect, it } from 'vitest'
import type { SyncEntry } from '../src/sync-types'
import { mergeProgrammes, programmesSinceReset, programmeStamp, type MergeEntry } from '../src/programme-sync'
const merge: MergeEntry = (a, b) => ({ ...b, ...a })
const marker = (at: number) => ({ versionId: 'synthetic-v1', at })
const old = { definitions: [{ id: 'p', _ts: 99999, extra: { survives: true } }] }
const offloaded = { offloaded: { p: marker(100) }, definitions: [] }

describe('K04 public programme helpers apply the shared offload rule', () => {
  it('accepts the shared typed sync merger callback', () => {
    const mergeEntry = (a: SyncEntry, b: SyncEntry): SyncEntry => ({ ...b, ...a })
    expect(mergeProgrammes(old, {}, [], mergeEntry).definitions).toEqual(old.definitions)
  })
  it('direct merge filters stale definitions from both sides without mutating either input', () => {
    const before = structuredClone([old, offloaded])
    for (const [a, b] of [[old, offloaded], [offloaded, old]]) {
      expect(mergeProgrammes(a, b, [], merge).definitions).toEqual([])
      expect(mergeProgrammes(a, b, [], merge).offloaded).toEqual(offloaded.offloaded)
    }
    expect([old, offloaded]).toEqual(before)
  })
  it.each(['active', 'paused'])('an in-use %s definition remains installed in the union', status => {
    expect(mergeProgrammes({ ...old, cycles: [{ id: 'c', programmeId: 'p', status, occurrences: [] }] }, offloaded, [], merge).definitions).toEqual(old.definitions)
  })
  it('definition edit clocks do not prove a reinstall; an explicit newer install does', () => {
    for (const at of [99, 100]) expect(mergeProgrammes({ ...old, installed: { p: marker(at) } }, offloaded, [], merge).definitions).toEqual([])
    expect(mergeProgrammes({ ...old, installed: { p: marker(101) } }, offloaded, [], merge).definitions).toEqual(old.definitions)
    expect(mergeProgrammes({ ...old, cycles: [{ id: 'c', programmeId: 'p', status: 'archived', occurrences: [] }] }, offloaded, [], merge).definitions).toEqual([])
  })
  it('an in-use definition remains installed when terminal cycle resolution is replayed', () => {
    const active = { ...old, cycles: [{ id: 'c', programmeId: 'p', status: 'active', occurrences: [] }] }
    const finished = { ...offloaded, cycles: [{ id: 'c', programmeId: 'p', status: 'finished', occurrences: [] }] }
    const once = mergeProgrammes(active, finished, [], merge)
    const twice = mergeProgrammes(once, once, [], merge)
    expect(once.cycles[0]!.status).toBe('finished')
    expect(once.definitions).toEqual(old.definitions)
    expect(once.installed).toEqual({ p: marker(101) })
    expect(mergeProgrammes(once, { offloaded: { p: marker(102) } }, [], merge).definitions).toEqual([])
    expect(twice).toEqual(once)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })
  it('reset drops stale manifests independently of reset id lists and retains newer markers', () => {
    const p = { ...old, offloaded: { p: marker(100), newer: marker(102) }, installed: { p: marker(101), older: marker(99) } }
    const before = structuredClone(p)
    expect(programmesSinceReset(p, 100, {}).offloaded).toEqual({ newer: marker(102) })
    expect(programmesSinceReset(p, 100, {}).installed).toEqual({ p: marker(101) })
    expect(programmesSinceReset(p, 0, {}).offloaded).toEqual(p.offloaded)
    expect(p).toEqual(before)
  })
  it('causal clock includes manifest-only programmes and all nested entry clocks', () => {
    expect(programmeStamp({ programmes: { offloaded: { p: marker(200) }, installed: { p: marker(201) } } })).toBe(201)
    expect(programmeStamp({ programmes: { definitions: [{ id: 'p', _ts: 300 }], offloaded: { p: marker(200) } } })).toBe(300)
  })
  it('equal manifest clocks use the shared deterministic version-id tie break', () => {
    const a = { offloaded: { p: { versionId: 'a', at: 100 } } }
    const b = { offloaded: { p: { versionId: 'z', at: 100 } } }
    expect(mergeProgrammes(a, b, [], merge).offloaded).toEqual(b.offloaded)
    expect(mergeProgrammes(b, a, [], merge).offloaded).toEqual(b.offloaded)
  })
  it('prototype-named definition ids are filtered only by own manifest entries', () => {
    for (const id of ['constructor', 'toString', '__proto__']) {
      const definitions = [{ id }]
      expect(mergeProgrammes({ definitions }, { offloaded: {} }, [], merge).definitions).toEqual(definitions)
      expect(mergeProgrammes({ definitions }, { offloaded: { [id]: marker(100) } }, [], merge).definitions).toEqual([])
    }
  })
})
