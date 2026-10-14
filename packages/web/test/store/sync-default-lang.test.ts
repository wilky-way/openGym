import './sync-clock'
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./sync-api', () => ({ api: vi.fn() }))
vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
import { api } from './sync-api'
import { DEF, useStore } from './sync-store'
beforeEach(() => { localStorage.clear(); api.mockReset() })
describe('instance default language', () => {
  it('two devices with browsers in different languages do not push the profile back and forth', async () => {
    const server = { ...structuredClone(DEF), _ts: 100, lang: 'de', langAuto: true, workouts: [{ id: 'w1', d: '2026-09-01', start: 1, entries: [] }] }
    useStore.setState({ S: structuredClone(server), user: { id: 'u1' }, ready: true, config: { invite_only: false } })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 5, ts: 100 }))
    expect(useStore.getState().S.lang).toBe('de')
    api.mockResolvedValue({ state: { ...server, _rev: 5 }, rev: 5 })
    await useStore.getState().pullState(); await useStore.getState().pullState()
    expect(api.mock.calls.filter(([, options]: any[]) => options?.method === 'PUT')).toHaveLength(0)
    expect(useStore.getState().S.lang).toBe('de')
  })
})
