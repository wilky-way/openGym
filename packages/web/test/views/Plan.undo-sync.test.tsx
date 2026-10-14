// @vitest-environment happy-dom
import '../helpers/plan-views'

// Plan's Undo (v1.3.11 swipe) meets the field-stamp sync (v1.3.11 sync). A routine deleted and put
// back with Undo must come back as a stamped change: the removal another device already pulled
// must not take it away again, whichever copy the merge counts as newer, and it keeps its place
// in the list and on its weekdays. An edit another device made meanwhile still wins its field.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import { deleteRoutineWithUndo } from '../../src/views/Plan'
import { mergeStates, stampChange } from '@opengym/core/sync-merge'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../src/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))

const clone: any = (value: any) => JSON.parse(JSON.stringify(value))
const routine: any = (id: any, name: any, ts: any) => ({ id, name, emoji: null, _ts: ts, ex: [{ id: '0025', sets: 3, reps: 5 }] })
const ids: any = (list: any) => list.map((r: any) => r.id)
const S: any = () => useStore.getState().S
const undo: any = () => useUI.getState().runToastAction()

// The copy both devices share before anything happens.
const shared: any = () => Object.assign(clone(DEF), {
  _ts: 1000,
  routines: [routine('a', 'Push', 900), routine('b', 'Pull', 900), routine('c', 'Legs', 900)],
  week: { 1: ['a', 'b'], 3: ['b'], 5: ['c'] },
})
// Another device's change, stamped the way its store would stamp it.
const change: any = (prev: any, fn: any, wall: any) => { const next: any = clone(prev); fn(next); next._ts = stampChange(prev, next, wall); return next }

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: shared(), user: null })
})
afterEach(() => { localStorage.clear() })

describe('Undo after a removal the other device has already pulled', () => {
  it('the routine stays, in its place and on its weekdays, in both merge directions', () => {
    expect(deleteRoutineWithUndo('b')).toBe(true)
    const deleted: any = clone(S())
    expect(deleted.deleted.routines.b).toBeGreaterThan(0)
    // The other device pulls the removal, then changes something unrelated later.
    const other: any = change(deleted, (s: any) => { s.restSec = 75 }, Date.now() + 60_000)
    undo()
    const here: any = S()
    const back: any = here.routines.find((r: any) => r.id === 'b')
    expect(back).toBeTruthy()
    // It keeps the edit time it had: the add-back on record puts it back, not an edit of it (an
    // older app keeps the routine edited last as a whole, and a rename there would lose to it).
    expect(back._ts).toBe(900)
    expect(here.deleted.routines.b).toBeLessThan(0)   // marked as added back
    for (const m of [mergeStates(here, other), mergeStates(other, here)]) {
      expect(ids(m.routines)).toEqual(['a', 'b', 'c'])
      expect(m.week[1]).toEqual(['a', 'b'])
      expect(m.week[3]).toEqual(['b'])
      expect(m.restSec).toBe(75)
      // and the next merge with the server's old removal does not drop it either
      expect(ids(mergeStates(m, deleted).routines)).toEqual(['a', 'b', 'c'])
    }
  })

  it('a rename the other device made before it saw the removal keeps its field', () => {
    const before: any = clone(S())
    const renamed: any = change(before, (s: any) => { s.routines[1].name = 'Pull heavy' }, Date.now() + 1)
    deleteRoutineWithUndo('b')
    undo()
    const m: any = mergeStates(S(), renamed)
    expect(m.routines.find((r: any) => r.id === 'b').name).toBe('Pull heavy')
  })
})

describe('the accent colour syncs per field like any other setting', () => {
  it('your own colour picked here survives a later unrelated change elsewhere; a later preset there wins only the choice', () => {
    const base: any = shared()
    const phone: any = change(base, (s: any) => { s.accent = 'custom'; s.accentCustom = '#3366ff' }, 5000)
    const desk: any = change(base, (s: any) => { s.restSec = 90 }, 6000)
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.accent).toBe('custom')
      expect(m.accentCustom).toBe('#3366ff')
      expect(m.restSec).toBe(90)
    }
    const desk2: any = change(base, (s: any) => { s.accent = 'sky' }, 7000)
    for (const m of [mergeStates(phone, desk2), mergeStates(desk2, phone)]) {
      expect(m.accent).toBe('sky')
      expect(m.accentCustom).toBe('#3366ff')   // kept for when you go back to it
    }
  })

  it('a malformed colour from the other copy never reaches the merge', () => {
    const base: any = shared()
    const bad: any = change(base, (s: any) => { s.accent = 'custom'; s.accentCustom = 'url(x)' }, 5000)
    const m: any = mergeStates(base, bad)
    expect(m.accentCustom).toBeUndefined()
    expect(m.accent).toBe('custom')   // drawn as the default without a usable colour (accentKey)
  })
})
