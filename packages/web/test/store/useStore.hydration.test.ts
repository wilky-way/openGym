import { beforeEach, describe, expect, it } from 'vitest'
import type { KeyValueStore, Platform } from '@opengym/contract/platform/adapters'
import { DEF, adoptedState, freshState, hasData, initializeStore, initialStoreState, loadState, restoredStateFor, useStore } from '../../src/store/useStore'
import { exOr, isAssisted } from '@opengym/core/exercises'

export function memoryKV(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return { values, get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value) }, remove: key => { values.delete(key) }, subscribe: () => () => {} }
}
let kv: ReturnType<typeof memoryKV>
beforeEach(() => { kv = memoryKV() })
describe('legacy gym_state_v1 hydration', () => {
  it('reads the old key without writing and preserves active and unknown fields in key order', () => {
    const saved = { unit: 'lb', active: { id: 'synthetic-live', entries: [{ id: 'custom-assisted', sets: [{ w: 40, r: 5 }] }], future: { x: 1 } }, unknown: ['kept'], restSec: 35, accentCustom: '#ABCDEF' }
    const raw = JSON.stringify(saved)
    kv.set('gym_state_v1', raw)
    const expected = Object.assign(JSON.parse(JSON.stringify(DEF)), saved, { accentCustom: '#abcdef' })
    expect(JSON.stringify(loadState(kv))).toBe(JSON.stringify(expected))
    expect(kv.get('gym_state_v1')).toBe(raw)
    expect(loadState(kv).active).toEqual(saved.active)
    expect([...kv.values.keys()]).toEqual(['gym_state_v1'])
  })
  it('returns independent new-profile defaults when missing, corrupt or unreadable', () => {
    expect(loadState(kv)).toEqual(freshState())
    kv.set('gym_state_v1', '{broken')
    expect(loadState(kv)).toEqual(freshState())
    expect(loadState({ ...kv, get() { throw new Error('blocked') } })).toEqual(freshState())
    const first = freshState(); first.routines.push({ id: 'first' })
    expect(freshState().routines).toEqual([])
  })
  it('preserves saved language bytes, and defaults missing language to English', () => {
    kv.set('gym_state_v1', JSON.stringify({ lang: 'ar', active: { id: 'live' } }))
    expect(loadState(kv).lang).toBe('ar')
    kv.set('gym_state_v1', JSON.stringify({ active: { id: 'live' } }))
    expect(loadState(kv).lang).toBe('en')
  })
  it('sanitizes only invalid accent fields and preserves future safe keys', () => {
    kv.set('gym_state_v1', JSON.stringify({ accent: 'url(evil)', accentCustom: '#bad', opaque: { x: 1 } }))
    expect(loadState(kv)).toMatchObject({ accent: 'lime', opaque: { x: 1 } })
    expect(loadState(kv).accentCustom).toBeUndefined()
    kv.set('gym_state_v1', JSON.stringify({ accent: 'future-2' }))
    expect(loadState(kv).accent).toBe('future-2')
  })
  it('initializes from an injected platform and heals/indexes custom exercises independently', () => {
    const custom = { id: 'custom-assisted', n: 'Synthetic assisted', eq: 'assisted', assisted: true }
    kv.set('gym_state_v1', JSON.stringify({ customEx: [custom], active: { id: 'live' } }))
    kv.set('gym_user', JSON.stringify({ id: 'synthetic-user' }))
    const state = initializeStore({ kv } as unknown as Platform)
    expect(useStore.getState().S.active).toEqual({ id: 'live' })
    expect(state.user?.id).toBe('synthetic-user')
    expect(state.S.customEx[0].custom).toBe(true)
    expect(isAssisted('custom-assisted', state.index)).toBe(true)
    expect(exOr('custom-assisted', state.index).n).toBe('Synthetic assisted')
    expect(isAssisted('custom-assisted', initialStoreState(memoryKV()).index)).toBe(false)
    expect(kv.get('gym_state_v1')).toContain('custom-assisted')
  })
  it('refreshes the owned index on the initializer update seam and permits W07 action replacement', () => {
    initializeStore({ kv } as unknown as Platform)
    useStore.getState().update(S => { S.customEx.push({ id: 'custom-assisted', n: 'New', assisted: true }) }, false)
    expect(isAssisted('custom-assisted', useStore.getState().index)).toBe(true)
    const update = useStore.getState().update
    const calls: unknown[] = []
    useStore.setState({ update(mut, push) { calls.push(push); update(mut, push) } })
    useStore.getState().update(S => { S.active = { id: 'live' } }, true)
    expect(calls).toEqual([true])
    expect(useStore.getState().S.active.id).toBe('live')
    useStore.setState({ update })
  })
  it('hasData includes every supported record type but excludes an active-only copy', () => {
    for (const field of ['workouts', 'routines', 'bodyweight', 'customEx', 'measurements']) expect(hasData({ [field]: [{}] })).toBe(true)
    for (const field of ['definitions', 'cycles']) expect(hasData({ programmes: { [field]: [{}] } })).toBe(true)
    expect(hasData({ active: { id: 'live' } })).toBe(false)
  })
  it('distinguishes missing from explicit remote programmes and carries active by reference', () => {
    const local = { programmes: { definitions: [{ id: 'synthetic-definition' }], cycles: [] }, active: { id: 'live' } }
    expect(adoptedState(local, {}).programmes.definitions).toHaveLength(1)
    expect(adoptedState(local, { programmes: null }).programmes).toBeNull()
    expect(restoredStateFor(local, {})!.active).toBe(local.active)
    expect(restoredStateFor(local, null)).toBeNull()
  })
})
