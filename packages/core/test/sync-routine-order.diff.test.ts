// legacy-shape: unvalidated JSON test fixtures exercise incomplete and malformed records.
type Fixture = any
/* RC review 2026-10-07: the order of the routines was not stamped. A reorder on one device was lost
   to the other device's copy whenever that one was newer as a whole (a weigh-in logged later), so
   the list jumped back. The order is now a choice of its own (`edited.routineOrder`), merged like
   a setting; a routine only one copy has still goes next to its neighbour there. The server stamps
   it for a writer that does not (api/sync-stamps.js), and keeps a newer order from an older copy. */
import { describe, expect, it } from 'vitest'
import { mergeStates as typed_mergeStates, orderMoved as typed_orderMoved, stampChange as typed_stampChange } from '../src/sync-merge'
const stampChange: Fixture = typed_stampChange
const orderMoved: Fixture = typed_orderMoved
const mergeStates: Fixture = typed_mergeStates
// @ts-expect-error frozen server JS oracle has no declarations; differential-test import only
import * as S from '../../../packages/parity/fixtures/oracle/api/sync-stamps.js'

const clone: Fixture = (v: Fixture) => JSON.parse(JSON.stringify(v))
const T: Fixture = 1_800_000_000_000
const r: Fixture = (id: Fixture) => ({ id, name: id, ex: [], _ts: T - 1000 })
const ids: Fixture = (s: Fixture) => s.routines.map((x: Fixture) => x.id).join(',')
const change: Fixture = (prev: Fixture, fn: Fixture, wall: Fixture) => { const n: Fixture = clone(prev); fn(n); n._ts = stampChange(prev, n, wall); return n }
const base: Fixture = () => ({ _ts: T, unit: 'kg', workouts: [], routines: [r('a'), r('b'), r('c')], edited: { restSec: T } })
const reorder: Fixture = (order: Fixture) => (s: Fixture) => { s.routines = order.map((id: Fixture) => s.routines.find((x: Fixture) => x.id === id)) }

describe('the order of the routines', () => {
  it('a reorder survives the other device\'s later, unrelated change, in either merge order', () => {
    const A: Fixture = change(base(), reorder(['c', 'a', 'b']), T + 1000)
    const B: Fixture = change(base(), (s: Fixture) => { s.restSec = 45 }, T + 5000)
    for (const m of [mergeStates(A, B), mergeStates(B, A)]) {
      expect(ids(m)).toBe('c,a,b')
      expect(m.restSec).toBe(45)
    }
  })
  it('the order chosen last wins', () => {
    const A: Fixture = change(base(), reorder(['c', 'a', 'b']), T + 1000)
    const B: Fixture = change(base(), reorder(['b', 'a', 'c']), T + 2000)
    for (const m of [mergeStates(A, B), mergeStates(B, A)]) expect(ids(m)).toBe('b,a,c')
  })
  it('a routine only the other copy has goes next to its neighbour there, and both edits of an entry are kept', () => {
    const A: Fixture = change(base(), reorder(['c', 'a', 'b']), T + 1000)
    const B: Fixture = change(base(), (s: Fixture) => { s.routines.splice(1, 0, { id: 'n', name: 'New', ex: [] }); s.routines[0].name = 'A2' }, T + 5000)
    for (const m of [mergeStates(A, B), mergeStates(B, A)]) {
      expect(ids(m)).toBe('c,a,n,b')
      expect(m.routines.find((x: Fixture) => x.id === 'a').name).toBe('A2')
    }
  })
  it('adding or removing a routine is no reorder', () => {
    expect(orderMoved([r('a'), r('b')], [r('a'), r('x'), r('b')])).toBe(false)
    expect(orderMoved([r('a'), r('b'), r('c')], [r('a'), r('c')])).toBe(false)
    expect(orderMoved([r('a'), r('b')], [r('b'), r('a')])).toBe(true)
    expect(change(base(), (s: Fixture) => { s.routines.push(r('d')) }, T + 1).edited.routineOrder).toBeUndefined()
    for (const [a, b] of [[[r('a'), r('b')], [r('b'), r('a'), r('z')]], [[r('a')], [r('a')]]]) expect(S.orderMoved(a, b)).toBe(orderMoved(a, b))
  })
})

describe('the server and a writer that does not stamp', () => {
  it('its reorder is stamped, and holds against a phone that reconnects with an older change', () => {
    const cur: Fixture = base()
    const old: Fixture = clone(cur); old.routines = ['b', 'c', 'a'].map((id: Fixture) => old.routines.find((x: Fixture) => x.id === id)); old._ts = T + 3000
    S.stampPut(cur, old, { overRead: true, now: T + 3000 })
    expect(old.edited.routineOrder).toBeGreaterThanOrEqual(T + 3000)
    const phone: Fixture = change(cur, (s: Fixture) => { s.restSec = 30 }, T + 9000)
    for (const m of [mergeStates(phone, old), mergeStates(old, phone)]) expect(ids(m)).toBe('b,c,a')
  })
  it('an older copy\'s order does not undo a reorder made since', () => {
    const cur: Fixture = change(base(), reorder(['c', 'b', 'a']), T + 1000)
    const old: Fixture = clone(base()); old.routines.push({ id: 'z', name: 'z', ex: [] }); old._ts = T + 9000   // its own new routine, older order
    S.stampPut(cur, old, { overRead: true, now: T + 9000 })
    expect(ids(old)).toBe('c,z,b,a')   // its new one next to the routine it followed there
  })
})
