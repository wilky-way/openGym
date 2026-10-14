import './sync-clock'
// @vitest-environment happy-dom
// Server capabilities are cached for boot and refreshed after account changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./sync-api', () => ({ api: vi.fn() }))
import { api } from './sync-api'
import { useStore as typed_useStore } from './sync-store'
const useStore: any = typed_useStore
beforeEach(() => { api.mockReset(); useStore.setState({ config: null, user: null }); localStorage.clear() })
afterEach(() => { useStore.setState({ config: null, user: null }); localStorage.clear() })
describe('server config', () => {
  it('loadConfig fetches once and then answers from the cache', async () => {
    const config: any = { invite_only: true, allow_guest: false }
    api.mockResolvedValue(config)
    expect(await useStore.getState().loadConfig()).toEqual(config)
    expect(await useStore.getState().loadConfig()).toEqual(config)
    expect(api).toHaveBeenCalledTimes(1)
    expect(api).toHaveBeenCalledWith('/api/config')
  })
  it('refreshConfig always asks the server, so changed capabilities are seen', async () => {
    api.mockResolvedValueOnce({ invite_only: true, allow_guest: false })
    await useStore.getState().loadConfig()
    api.mockResolvedValueOnce({ invite_only: false, allow_guest: true })
    await useStore.getState().refreshConfig()
    expect(useStore.getState().config.allow_guest).toBe(true)
    expect(api).toHaveBeenCalledTimes(2)
  })
  it('a sign-in re-asks after an account change, while the same account keeps its cache', async () => {
    api.mockResolvedValueOnce({ invite_only: false, allow_guest: true })
    await useStore.getState().loadConfig()
    api.mockResolvedValueOnce({ invite_only: true, allow_guest: false })
    useStore.getState().setUser({ id: 'u1', name: 'A' })
    await vi.waitFor(() => expect(useStore.getState().config.allow_guest).toBe(false))
    expect(api).toHaveBeenCalledTimes(2)
    useStore.getState().setUser({ id: 'u1', name: 'A' })
    expect(api).toHaveBeenCalledTimes(2)
  })
  it('two callers asking at once make one request', async () => {
    api.mockResolvedValue({ invite_only: false, allow_guest: true })
    const [a, b] = await Promise.all([useStore.getState().refreshConfig(), useStore.getState().refreshConfig()])
    expect(api).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    await useStore.getState().refreshConfig()
    expect(api).toHaveBeenCalledTimes(2)
  })
  it('an unreachable server leaves the cached config alone', async () => {
    const config: any = { invite_only: false, allow_guest: true }
    useStore.setState({ config })
    api.mockRejectedValueOnce(new Error('offline'))
    expect(await useStore.getState().refreshConfig()).toBeNull()
    expect(useStore.getState().config).toEqual(config)
  })
})
