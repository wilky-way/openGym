import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { mergeStates } from '../src/sync-merge'
import { applyServerOffloadRule, stampPut } from '../src/server-stamp'
import type { SyncDoc, SyncProgrammes } from '../src/sync-types'

const marker = (at: number, versionId = 'sha256:synthetic') => ({ versionId, at })
const definition = (id: string, _ts: number) => ({ id, name: id, unit: 'kg', weeks: [], _ts })
const doc = (programmes: SyncProgrammes, resetAt: number, _ts = 30): SyncDoc => ({
  unit: 'kg', _ts, workouts: [], routines: [], exWeights: {}, programmes, resetAt, resetIds: {},
})
const view = (p: SyncProgrammes) => ({
  definitions: p.definitions!.map(d => d.id).sort(), offloaded: p.offloaded, installed: p.installed,
})

function agreement(a: SyncDoc, b: SyncDoc) {
  const before = structuredClone([a, b])
  for (const [cur, incoming] of [[a, b], [b, a]] as const) {
    const client = mergeStates(cur, incoming)!
    const filtered = applyServerOffloadRule(cur.programmes!, incoming.programmes!, Math.max(cur.resetAt!, incoming.resetAt!))
    const server = stampPut(cur, structuredClone(incoming), { stamped: true, overRead: true, now: 100 })
    expect(view(client.programmes!)).toEqual(view(server.programmes!))
    expect(client.programmes!.offloaded).toEqual(filtered.next.offloaded)
    expect(client.programmes!.installed).toEqual(filtered.next.installed)
    expect(mergeStates(client, client)).toEqual(client)
  }
  expect([a, b]).toEqual(before)
}

describe('K10 client / K17 server offload agreement', () => {
  it('both keep a post-Reset definition when equal Resets retire an old offload', () => {
    const a = doc({ definitions: [definition('a', 30)], offloaded: { a: marker(10) } }, 20)
    const b = doc({ definitions: [], offloaded: { a: marker(10) } }, 20)
    agreement(a, b)
    expect(mergeStates(a, b)!.programmes!.definitions!.map(d => d.id)).toEqual(['a'])
  })
  it('uses the maximum Reset for both manifests even with a preferred copy', () => {
    const a = doc({ definitions: [definition('a', 30)], offloaded: { a: marker(10) } }, 20)
    const b = doc({ definitions: [definition('a', 30)], offloaded: { a: marker(20) } }, 0)
    for (const prefer of ['a', 'b']) {
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const result = mergeStates(x, y, { prefer })!
        expect(result.programmes!.definitions!.map(d => d.id)).toEqual(['a'])
        expect(result.programmes!.offloaded).toEqual({})
      }
    }
  })
  it('missing-peer adoption agrees with initial server PUT and retains protection after terminal release', () => {
    for (const status of ['active', 'paused', 'finished', 'archived']) {
      for (const resetAt of [0, 20]) {
        const source = doc({ definitions: [definition('a', 30)], offloaded: { a: marker(10) }, cycles: [{ id: 'c', programmeId: 'a', status, _ts: 30, occurrences: [] }] }, resetAt)
        const server = stampPut(null, structuredClone(source), { stamped: true, now: 100 })
        for (const missing of [null, undefined]) {
          for (const adopted of [mergeStates(missing, source)!, mergeStates(source, missing)!]) {
            expect(view(adopted.programmes!)).toEqual(view(server.programmes!))
            const ended = structuredClone(adopted)
            ended.programmes!.cycles![0]!.status = 'finished'
            const replayed = mergeStates(ended, ended)!
            expect(view(replayed.programmes!)).toEqual(view(server.programmes!))
          }
        }
      }
    }
  })
  it('agrees on retired and surviving Reset markers over 3,000 seeded scenarios', () => {
    fc.assert(fc.property(
      fc.constantFrom('a', 'constructor', '__proto__', 'toString'),
      fc.integer({ min: 20, max: 2_000_000_000_000 }),
      fc.constantFrom('equal', 'a-newer', 'b-newer'),
      fc.constantFrom(-10, 0, 10), fc.constantFrom(-10, 0, 20), fc.boolean(),
      fc.constantFrom('active', 'paused', 'finished', 'archived'),
      (id, resetAt, relation, offDelta, installDelta, installed, status) => {
        const programmes = (versionId: string): SyncProgrammes => ({
          definitions: [definition(id, resetAt + 30)],
          cycles: [{ id: 'c', programmeId: id, status, _ts: resetAt + 30, occurrences: [] }],
          offloaded: Object.fromEntries([[id, marker(resetAt + offDelta, versionId)]]),
          ...(installed ? { installed: Object.fromEntries([[id, marker(resetAt + installDelta, versionId)]]) } : {}),
        })
        const a = doc(programmes('sha256:a'), relation === 'b-newer' ? 0 : resetAt, resetAt + 30)
        const b = doc(programmes('sha256:z'), relation === 'a-newer' ? 0 : resetAt, resetAt + 30)
        agreement(a, b)
        const result = mergeStates(a, b)!.programmes!
        const keep = offDelta <= 0 || status === 'active' || status === 'paused' || installed && installDelta > offDelta
        expect(result.definitions!.map(d => d.id)).toEqual(keep ? [id] : [])
      }), { seed: 101313, numRuns: 3_000 })
  }, 30_000)
})
