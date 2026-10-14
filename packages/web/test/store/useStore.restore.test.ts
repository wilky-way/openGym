import { describe, expect, it } from 'vitest'
import { DEF, restoredStateFor } from '../../src/store/useStore'
const clone = (value: any): any => JSON.parse(JSON.stringify(value))
const routine = (id: string) => ({ id, name: id, ex: [] })
const workout = (id: string) => ({ id, d: '2026-09-01', entries: [] })
const httpError = (status: number) => Object.assign(new Error('HTTP ' + status), { status })

describe('saved workout state sync and restore', () => {
  it('keeps omitted programs on first restore, respecting a remote reset', () => {
    const local = { ...clone(DEF), programmes: { definitions: [{ id: 'old' }, { id: 'new' }], cycles: [{ id: 'old-cycle' }, { id: 'new-cycle' }] } }
    const remote = { _ts: 200 }
    expect(restoredStateFor(local, remote)!.programmes.definitions).toHaveLength(2)
    const reset = { ...remote, resetAt: 150, resetIds: { programmeDefinitions: ['old'], programmeCycles: ['old-cycle'] } }
    const p = restoredStateFor(local, reset)!.programmes
    expect(p.definitions.map((d: any) => d.id)).toEqual(['new'])
    expect(p.cycles.map((c: any) => c.id)).toEqual(['new-cycle'])
  })

  it('clean restore keeps a re-imported definition with the same id newer than the reset', () => {
    const local = { ...clone(DEF), resetAt: 100, programmes: { definitions: [{ id: 'same', _ts: 200 }, { id: 'old', _ts: 100 }], cycles: [{ id: 'cycle', _ts: 200 }] } }
    const remote = { _ts: 300, resetAt: 100, resetIds: { programmeDefinitions: ['same', 'old'], programmeCycles: ['cycle'] } }
    const p = restoredStateFor(local, remote)!.programmes
    expect(p.definitions.map((d: any) => d.id)).toEqual(['same'])
    expect(p.cycles.map((c: any) => c.id)).toEqual(['cycle'])
  })

  it('returns null for an older or dirty local state', () => {
    const local = { ...clone(DEF), _ts: 20, routines: [routine('local')] }
    const remote = { ...clone(DEF), _ts: 10, routines: [routine('remote')] }

    expect(restoredStateFor(local, remote)).toBeNull()
    expect(restoredStateFor(local, { ...remote, _ts: 30 }, true)).toBeNull()
  })

  it('overlays defaults and carries the device-local active workout', () => {
    const active = { id: 'active-1', routineId: 'local', entries: [] }
    const local = { ...clone(DEF), active }
    const restored = restoredStateFor(local, { _ts: 20, routines: [routine('remote')] })

    expect(restored!.routines.map((r: any) => r.id)).toEqual(['remote'])
    expect(restored!.active).toEqual(active)
    expect(restored!.restSec).toBe(90)
  })

})
