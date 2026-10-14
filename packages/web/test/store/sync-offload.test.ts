// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeSyncEngine } from '../../src/store/sync-engine'
import { createBrowserPlatform } from '../../src/platform/browser'
import { useStore, DEF } from '../../src/store/useStore'
let dispose: () => void
let api: any
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); localStorage.clear()
  api = vi.fn().mockResolvedValue({ ok: true, rev: 3 })
  dispose = initializeSyncEngine({ platform: createBrowserPlatform(), api, prompts: { askAddDeviceData: async () => false, toast() {} } })
})
afterEach(() => { dispose(); vi.useRealTimers() })
describe('existing offload manifests are consumed without a producer flag', () => {
  it.each([null, 'active', 'paused'])('a 409 strips stale definitions or protects the %s cycle idempotently', async status => {
    const local = { ...structuredClone(DEF), _ts: 100, programmes: { version: 1, definitions: [{ id: 'synthetic-definition', _ts: 10000 }], cycles: status ? [{ id: 'synthetic-cycle', programmeId: 'synthetic-definition', status }] : [] } }
    const remote = { ...structuredClone(DEF), _ts: 200, programmes: { version: 1, definitions: [], cycles: [], offloaded: { 'synthetic-definition': { versionId: 'v1', at: 500 } } } }
    useStore.setState({ S: local, user: { id: 'synthetic-user' }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, data: { state: remote, rev: 2 } }))
    await useStore.getState().pushState()
    const programmes = useStore.getState().S.programmes
    expect(programmes.offloaded['synthetic-definition']).toEqual({ versionId: 'v1', at: 500 })
    expect(programmes.definitions.map((x: any) => x.id)).toEqual(status ? ['synthetic-definition'] : [])
    if (status) expect(programmes.installed['synthetic-definition']).toEqual({ versionId: 'v1', at: 501 })
    const before = JSON.stringify(programmes)
    api.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, data: { state: remote, rev: 3 } }))
    await useStore.getState().pushState()
    expect(JSON.stringify(useStore.getState().S.programmes)).toBe(before)
  })
})
