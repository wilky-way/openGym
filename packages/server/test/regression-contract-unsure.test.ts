import { test, expect } from 'bun:test'
import { dataServer, CLOCK } from './data-helpers'
test('contract-unsure: opaque historical fields and workout controls round-trip without narrowing', async () => {
 const h = dataServer(), state = {_ts: CLOCK, unit: 'kg', wc: {steppers: true, extension: {future: 1}}, coach: {legacyExtension: null},
   routines: [{id: 'r', name: 'Synthetic', ex: [{id: '0025', prog: 'future-policy', side: {opaque: true}, warmupSets: {opaque: 2}, intensifier: {future: true}, pyramidRest: [0, 90]}]}],
   workouts: [{id: 'w', d: '2026-10-12', entries: [{id: '0025', sg: 7, target: null, planned: {extension: 'kept'}, sets: [{w: 40, r: 5, done: true, weightOrigin: {future: true}}]}, {id: '0001', sg: '7', target: {sets: 3, future: [null, 1]}, planned: null, sets: []}]}]}
 const before = JSON.stringify(state)
 const response = await h.call('PUT', '/api/data', {state, baseRev: 0, stamped: true})
 expect(response.status).toBe(200)
 const stored = (await h.call('GET', '/api/data')).body.state
 expect(stored.workouts).toEqual(state.workouts); expect(stored.routines).toEqual(state.routines)
 expect(stored.wc).toEqual(state.wc); expect(stored.coach).toEqual(state.coach); expect(JSON.stringify(state)).toBe(before)
})
