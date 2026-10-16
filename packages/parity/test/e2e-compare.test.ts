import { expect, it } from 'vitest'
import { normalizeE2E, e2eDifferences } from '../src/e2e-compare'
const prefix = Date.parse('2026-10-12T17:00:00Z').toString(36)
it('normalizes random ids consistently in values, composite references and keys', () => {
  const doc = (suffix: string) => ({ id: prefix + suffix, queue: [prefix + suffix + ':w1d1'], edited: { [prefix + suffix]: 1 }, _ts: 1 })
  expect(normalizeE2E(doc('abcde'))).toEqual(normalizeE2E(doc('fghij')))
  expect(e2eDifferences(normalizeE2E(doc('abcde')), normalizeE2E({ ...doc('fghij'), queue: [prefix + 'klmno' + ':w1d1'] }))).toContain('$.queue.0')
})
it('excludes only transport and approved library install metadata, preserving unknown and authored content', () => {
  const doc = { _rev: 1, _wid: 'one', _wids: ['a'], programmes: { definitions: [{ id: 'i01-synthetic' }], installed: { 'i01-synthetic': { at: 1, versionId: 'v1' } } }, future: { w: 42.5 }, workouts: [{ entries: [{ sets: [{ w: 42.5, r: 6 }] }] }] }
  const same = { ...doc, _rev: 99, _wid: 'two', _wids: ['b'], programmes: { definitions: doc.programmes.definitions } }
  expect(normalizeE2E(doc)).toEqual(normalizeE2E(same))
  expect(e2eDifferences(normalizeE2E(doc), normalizeE2E({ ...same, future: { w: 40 } }))).toEqual(['$.future.w'])
  expect(e2eDifferences(normalizeE2E(doc), normalizeE2E({ ...same, workouts: [{ entries: [{ sets: [{ w: 40, r: 6 }] }] }] }))).toEqual(['$.workouts.0.entries.0.sets.0.w'])
})
it('retains timestamps of actual events and missing stamp-map fields', () => {
  expect(e2eDifferences(normalizeE2E({ start: 1, edited: { sound: 10 } }), normalizeE2E({ start: 2, edited: { sound: 20, unit: 20 } }))).toEqual(['$.start', '$.edited.unit'])
})
it('does not hide unknown clock-shaped data or nonfixture definitions', () => {
  const a = { future: { _ts: 1, _f: { unknown: 1 } }, programmes: { definitions: [{ id: 'i01-synthetic', name: 'fixture' }, { id: 'other', name: 'one' }] } }
  const b = { future: { _ts: 2, _f: { unknown: 2 } }, programmes: { definitions: [{ id: 'other', name: 'two' }] } }
  expect(e2eDifferences(normalizeE2E(a, { preActivation: true }), normalizeE2E(b, { preActivation: true }))).toEqual(['$.future._ts', '$.future._f.unknown', '$.programmes.definitions.0.name'])
})
it('compares unknown edited objects, merge-clock membership and object key order', () => {
  expect(e2eDifferences(normalizeE2E({ future: { edited: { value: 1 } } }), normalizeE2E({ future: { edited: { value: 2 } } }))).toEqual(['$.future.edited.value'])
  expect(e2eDifferences(normalizeE2E({ programmes: { cycles: [{ _f: { status: 1 } }] } }), normalizeE2E({ programmes: { cycles: [{ _f: {} }] } }))).toEqual(['$.programmes.cycles.0._f.status'])
  expect(e2eDifferences(normalizeE2E({ future: { x: 1, y: 2 } }), normalizeE2E({ future: { y: 2, x: 1 } }))).toEqual(['$.future.<key-order>'])
})
