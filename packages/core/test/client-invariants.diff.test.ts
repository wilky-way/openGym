import { describe, expect, it } from 'vitest'
import { highestStamp, stampEdits, mergeEntry, mergeStates } from '../src/sync-merge'
// @ts-expect-error frozen server JS oracle has no declarations; differential-test import only
import * as server from '../../../packages/parity/fixtures/oracle/api/sync-stamps.js'

describe('R5 named client/server drifts', () => {
  it('client highestStamp includes weigh-in t, while the legacy server ignores it', () => {
    const doc = { _ts: 10, bodyweight: [{ d: '2026-10-01', w: 80, t: 100 }] }
    expect(highestStamp(doc)).toBe(100)
    expect(server.highestStamp(doc)).toBe(10)
  })
  it('client prunes 180-day absent per-key edit stamps, while server joins retain them', () => {
    const now = 1_800_000_000_000
    const expired = now - 181 * 86400000
    const previous = { restSec: 90, edited: { 'week.1': expired }, week: {} }
    const next = { ...previous, restSec: 120, edited: { ...previous.edited } }
    expect(stampEdits(previous, next, now).edited).toEqual({ restSec: now })
    expect(server.mergeEdits(previous.edited, { restSec: now })).toEqual({ 'week.1': expired, restSec: now })
  })
  it('client programme merge honors Undo, while legacy server programme merge ignores it', () => {
    const restored = { id: 'a', name: 'old', _ts: 30, _f: { name: 30 }, _u: { name: [10, 25, 30] }, unit: 'kg', weeks: [] }
    const offline = { id: 'a', name: 'offline', _ts: 20, _f: { name: 20 }, unit: 'kg', weeks: [] }
    expect(mergeEntry(restored, offline).name).toBe('offline')
    const current = { _ts: 30, workouts: [], routines: [], programmes: { definitions: [restored], cycles: [] } }
    const other = { _ts: 20, workouts: [], routines: [], programmes: { definitions: [offline], cycles: [] } }
    expect(mergeStates(current, other)!.programmes!.definitions![0]!.name).toBe('offline')
    const next = JSON.parse(JSON.stringify(other))
    server.stampPut(current, next, { stamped: true, overRead: false, now: 40 })
    expect(next.programmes.definitions[0].name).toBe('old')
  })
})

it('legacy server round-trips unknown offloaded metadata without migration', () => {
  const manifest = { a: { versionId: 'sha256:synthetic', at: 100 } }
  const current = { _ts: 100, workouts: [], routines: [], programmes: { version: 1, fork: 'wilky/1', definitions: [], cycles: [], offloaded: manifest } }
  const next = JSON.parse(JSON.stringify(current))
  server.stampPut(current, next, { stamped: true, overRead: true, now: 101 })
  expect(next.programmes.offloaded).toEqual(manifest)
  expect(JSON.stringify(next.programmes.offloaded)).toBe(JSON.stringify(manifest))
})
