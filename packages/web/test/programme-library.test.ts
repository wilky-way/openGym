// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb'
import { browserObjectStore } from '../src/platform/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPlatform } from '../src/platform/browser'
import { createProgrammeLibrary } from '../src/lib/programme-library'
const definition = { id: 'synthetic-library', name: 'Synthetic', unit: 'kg', weeks: [{ index: 1, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Synthetic', ex: [{ id: '0025', sets: 3, reps: 8, weight: 100 }] } }] }] }] }
const entry = { definition, n: 1, versionId: 'sha256:synthetic-v1', level: 'Valid' }
const list = { items: [{ id: definition.id, name: 'Synthetic', level: 'Valid', private: true, inUse: false, versionN: 1, bytes: 100, updatedAt: '2026-10-13T12:00:00Z', versionId: entry.versionId }], etag: '"synthetic-list-v1"' }
let platform: ReturnType<typeof createBrowserPlatform>, fetch: ReturnType<typeof vi.fn<(path: string, init?: RequestInit) => Promise<Response>>>, uid: string | null
const response = (body: unknown, status = 200) => new Response(status === 304 ? null : JSON.stringify(body), { status })
const restart = async () => {
  vi.resetModules()
  const { createProgrammeLibrary } = await import('../src/lib/programme-library')
  return createProgrammeLibrary(platform, () => uid)
}
beforeEach(() => {
  let clock = 1000000
  vi.spyOn(Date, 'now').mockImplementation(() => ++clock)
  localStorage.clear(); uid = 'synthetic-user-' + Math.random()
  platform = createBrowserPlatform(); platform.objects = browserObjectStore(new IDBFactory()); fetch = vi.fn(); platform.transport = { fetch }
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('program library transport and IndexedDB cache', () => {
  it('loads list, preserves its etag and sends it on the next request for a 304', async () => {
    fetch.mockResolvedValueOnce(response(list)).mockResolvedValueOnce(response(null, 304))
    const client = createProgrammeLibrary(platform, () => uid)
    expect(await client.list()).toEqual(list)
    const reloaded = createProgrammeLibrary(platform, () => uid)
    expect(await reloaded.list()).toEqual(list)
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('If-None-Match')).toBe(list.etag)
    expect((await platform.objects.keys('library')).length).toBeGreaterThan(0)
  })
  it('uses the persisted list and body offline after recreating the client', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(list)).mockResolvedValueOnce(response(entry))
    await client.list(); await client.get(definition.id)
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = createProgrammeLibrary(platform, () => uid)
    expect(await reloaded.list()).toEqual(list)
    expect(await reloaded.get(definition.id)).toEqual(entry)
  })
  it('preserves original definition key order and unknown fields through its persistent cache', async () => {
    const original = { ...entry, definition: { weeks: definition.weeks, unit: definition.unit, name: definition.name, id: definition.id, extension: { z: 1, a: 2 } } }
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(original))
    const received = await client.get(definition.id)
    expect(JSON.stringify(received.definition)).toBe(JSON.stringify(original.definition))
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = await createProgrammeLibrary(platform, () => uid).get(definition.id)
    expect(JSON.stringify(reloaded.definition)).toBe(JSON.stringify(original.definition))
  })
  it('fails closed when only a summary is cached or a pinned version is not cached', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(list)).mockResolvedValueOnce(response(entry))
    await client.list(); await client.get(definition.id)
    fetch.mockRejectedValue(new TypeError('offline'))
    await expect(client.get('synthetic-missing')).rejects.toMatchObject({ code: 'offline-uncached' })
    await expect(client.get(definition.id, 'sha256:other')).rejects.toMatchObject({ code: 'offline-uncached' })
  })
  it.each([401, 403, 404, 500])('does not use cached private data after HTTP %s', async status => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    fetch.mockResolvedValue(response({ error: 'refused' }, status))
    await expect(client.get(definition.id)).rejects.toMatchObject({ status })
  })
  it.each([401, 403])('keeps a known HTTP %s refusal across an offline reopen until authentication succeeds', async status => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(list)).mockResolvedValueOnce(response(entry))
    await client.list(); await client.get(definition.id)
    fetch.mockResolvedValueOnce(response({}, status))
    await expect(client.get(definition.id)).rejects.toMatchObject({ status })
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = createProgrammeLibrary(platform, () => uid)
    await expect(reloaded.get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
    if (status === 401) await expect(reloaded.list()).rejects.toMatchObject({ code: 'auth', status })
    else expect(await reloaded.list()).toEqual(list)
    fetch.mockResolvedValueOnce(response(entry)); await reloaded.get(definition.id)
    fetch.mockRejectedValue(new TypeError('offline'))
    expect(await reloaded.get(definition.id)).toEqual(entry)
  })
  it.each([401, 403])('ignores an older success after a newer HTTP %s refusal across restart', async status => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = client.get(definition.id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fetch.mockResolvedValueOnce(response({}, status))
    await expect(client.get(definition.id)).rejects.toMatchObject({ status })
    resolve(response({ ...entry, n: 2, versionId: 'sha256:stale' })); await older
    fetch.mockRejectedValue(new TypeError('offline'))
    await expect(client.get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
    const reloaded = await restart()
    await expect(reloaded.get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
    // A later authorised response clears the refusal, without making the stale body available.
    fetch.mockResolvedValueOnce(response(entry)); await reloaded.get(definition.id, entry.versionId)
    fetch.mockRejectedValue(new TypeError('offline'))
    expect(await reloaded.get(definition.id)).toEqual(entry)
    await expect(reloaded.get(definition.id, 'sha256:stale')).rejects.toMatchObject({ code: 'offline-uncached' })
    await expect(reloaded.get(definition.id, 2)).rejects.toMatchObject({ code: 'offline-uncached' })
  })
  it.each([401, 403])('ignores an older HTTP %s refusal after a newer success across restart', async status => {
    const client = createProgrammeLibrary(platform, () => uid)
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = client.get(definition.id)
    const rejected = expect(older).rejects.toMatchObject({ status })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    resolve(response({}, status)); await rejected
    fetch.mockRejectedValue(new TypeError('offline'))
    expect(await (await restart()).get(definition.id)).toEqual(entry)
  })
  it('keeps the newer cache when an older success arrives last, including version aliases', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = client.get(definition.id, 1)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    const stale = { ...entry, versionId: 'sha256:stale', definition: { ...definition, name: 'Stale' } }
    resolve(response(stale)); await older
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = await restart()
    expect(await reloaded.get(definition.id)).toEqual(entry)
    expect(await reloaded.get(definition.id, 1)).toEqual(entry)
    await expect(reloaded.get(definition.id, stale.versionId)).rejects.toMatchObject({ code: 'offline-uncached' })
  })
  it.each([200, 304])('keeps a newer list refusal when an older %s lands last', async status => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(list)); await client.list()
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = client.list()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fetch.mockResolvedValueOnce(response({}, 403))
    await expect(client.list()).rejects.toMatchObject({ status: 403 })
    resolve(response(list, status)); await older
    fetch.mockRejectedValue(new TypeError('offline'))
    await expect((await restart()).list()).rejects.toMatchObject({ code: 'auth', status: 403 })
  })
  it('does not let an older unrelated success erase a newer account-wide 401', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = client.list()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fetch.mockResolvedValueOnce(response({}, 401))
    await expect(client.get(definition.id)).rejects.toMatchObject({ status: 401 })
    resolve(response(list)); await older
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = await restart()
    await expect(reloaded.get(definition.id)).rejects.toMatchObject({ code: 'auth', status: 401 })
    await expect(reloaded.list()).rejects.toMatchObject({ code: 'auth', status: 401 })
    fetch.mockResolvedValueOnce(response(entry)); await reloaded.get(definition.id)
    fetch.mockRejectedValue(new TypeError('offline'))
    // No list existed before the refusal: the stale success must not create one.
    await expect(reloaded.list()).rejects.toBeInstanceOf(TypeError)
  })
  it('serializes a slow cache write before a newer response commits', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    const put = platform.objects.put.bind(platform.objects)
    let release!: () => void
    let held = false
    platform.objects.put = vi.fn(async (bucket, key, value) => {
      if (!held && key.includes('entry:')) {
        held = true
        await new Promise<void>(resolve => { release = resolve })
      }
      await put(bucket, key, value)
    })
    fetch.mockResolvedValueOnce(response(entry))
    const older = client.get(definition.id)
    await vi.waitFor(() => expect(held).toBe(true))
    const newerEntry = { ...entry, n: 2, versionId: 'sha256:new' }
    fetch.mockResolvedValueOnce(response(newerEntry))
    const newer = client.get(definition.id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    release(); await Promise.all([older, newer])
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = await restart()
    expect(await reloaded.get(definition.id)).toEqual(newerEntry)
    expect(await reloaded.get(definition.id, 2)).toEqual(newerEntry)
    expect(await reloaded.get(definition.id, 1)).toEqual(entry)
  })
  it.each([401, 403])('persists HTTP %s when a newer offline request has no access decision', async status => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = client.get(definition.id)
    const rejected = expect(older).rejects.toMatchObject({ status })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fetch.mockRejectedValueOnce(new TypeError('offline'))
    expect(await client.get(definition.id)).toEqual(entry)
    resolve(response({}, status)); await rejected
    fetch.mockRejectedValue(new TypeError('offline'))
    await expect((await restart()).get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
  })
  it('preserves an older account-wide 401 despite a newer resource-specific 403', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    const other = { ...entry, definition: { ...definition, id: 'other' } }
    fetch.mockResolvedValueOnce(response(other)); await client.get('other')
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = client.get(definition.id)
    const rejected = expect(older).rejects.toMatchObject({ status: 401 })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fetch.mockResolvedValueOnce(response({}, 403))
    await expect(client.get(definition.id)).rejects.toMatchObject({ status: 403 })
    resolve(response({}, 401)); await rejected
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = await restart()
    await expect(reloaded.get('other')).rejects.toMatchObject({ code: 'auth', status: 401 })
    await expect(reloaded.get(definition.id)).rejects.toMatchObject({ code: 'auth', status: 401 })
  })
  it.each([401, 403])('persists HTTP %s without waiting for an older slow body write', async status => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    const put = platform.objects.put.bind(platform.objects)
    let release!: () => void
    let held = false
    platform.objects.put = vi.fn(async (bucket, key, value) => {
      if (!held && key.includes('entry:')) {
        held = true
        await new Promise<void>(resolve => { release = resolve })
      }
      await put(bucket, key, value)
    })
    fetch.mockResolvedValueOnce(response(entry))
    const older = client.get(definition.id)
    await vi.waitFor(() => expect(held).toBe(true))
    fetch.mockResolvedValueOnce(response({}, status))
    try {
      await expect(client.get(definition.id)).rejects.toMatchObject({ status })
      fetch.mockRejectedValue(new TypeError('offline'))
      await expect(client.get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
      await expect((await restart()).get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
    } finally {
      release(); await older
    }
    await expect((await restart()).get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
  })
  it.each([401, 403])('shares request ordering across clients after HTTP %s', async status => {
    const first = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await first.get(definition.id)
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = first.get(definition.id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    // A second Platform wrapper still represents the same persisted account cache.
    const second = createProgrammeLibrary({ ...platform, objects: { ...platform.objects } }, () => uid)
    fetch.mockResolvedValueOnce(response({}, status))
    await expect(second.get(definition.id)).rejects.toMatchObject({ status })
    resolve(response({ ...entry, n: 2, versionId: 'sha256:stale' })); await older
    fetch.mockRejectedValue(new TypeError('offline'))
    await expect((await restart()).get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
  })
  it.each([401, 403])('rechecks a newer persisted HTTP %s denial from an isolated client', async status => {
    const first = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await first.get(definition.id)
    let resolve!: (response: Response) => void
    fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const older = first.get(definition.id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    // A fresh module has independent memory, like another browser tab, and shares IndexedDB.
    const isolated = await restart()
    fetch.mockResolvedValueOnce(response({}, status))
    await expect(isolated.get(definition.id)).rejects.toMatchObject({ status })
    resolve(response({ ...entry, n: 2, versionId: 'sha256:stale' })); await older
    fetch.mockRejectedValue(new TypeError('offline'))
    const reloaded = await restart()
    await expect(reloaded.get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
    fetch.mockResolvedValueOnce(response(entry)); await reloaded.get(definition.id, entry.versionId)
    fetch.mockRejectedValue(new TypeError('offline'))
    expect(await reloaded.get(definition.id)).toEqual(entry)
    await expect(reloaded.get(definition.id, 'sha256:stale')).rejects.toMatchObject({ code: 'offline-uncached' })
  })
  it.each([401, 403])('does not downgrade a newer persisted HTTP %s denial with an older refusal', async status => {
    fetch.mockResolvedValueOnce(response(entry))
    await createProgrammeLibrary(platform, () => uid).get(definition.id)
    let clock = 1000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    let refuseOlder!: (response: Response) => void, succeedMiddle!: (response: Response) => void
    try {
      const first = await restart()
      fetch.mockImplementationOnce(() => new Promise<Response>(r => { refuseOlder = r }))
      const older = first.get(definition.id)
      const rejected = expect(older).rejects.toMatchObject({ status })
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
      clock = 2000
      const middle = await restart()
      fetch.mockImplementationOnce(() => new Promise<Response>(r => { succeedMiddle = r }))
      const success = middle.get(definition.id)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
      clock = 3000
      const newest = await restart()
      fetch.mockResolvedValueOnce(response({}, status))
      await expect(newest.get(definition.id)).rejects.toMatchObject({ status })
      refuseOlder(response({}, status)); await rejected
      succeedMiddle(response({ ...entry, n: 2, versionId: 'sha256:stale' })); await success
      fetch.mockRejectedValue(new TypeError('offline'))
      await expect((await restart()).get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
    } finally { now.mockRestore() }
  })
  it.each([401, 403])('keeps a newer HTTP %s denial observed during an older initial cache read', async status => {
    fetch.mockResolvedValueOnce(response(entry))
    await createProgrammeLibrary(platform, () => uid).get(definition.id)
    let clock = 1000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const get = platform.objects.get.bind(platform.objects)
    let release!: () => void
    let held = false
    platform.objects.get = vi.fn(async (bucket, key) => {
      if (!held && key.includes('entry:')) {
        held = true
        await new Promise<void>(resolve => { release = resolve })
      }
      return get(bucket, key)
    })
    try {
      const first = await restart()
      const older = first.get(definition.id)
      await vi.waitFor(() => expect(held).toBe(true))
      clock = 2000
      const isolated = await restart()
      fetch.mockResolvedValueOnce(response({}, status))
      await expect(isolated.get(definition.id)).rejects.toMatchObject({ status })
      fetch.mockResolvedValueOnce(response({ ...entry, n: 2, versionId: 'sha256:stale' }))
      release(); await older
      fetch.mockRejectedValue(new TypeError('offline'))
      await expect((await restart()).get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
    } finally { now.mockRestore() }
  })
  it.each([401, 403])('keeps ambiguous equal-time HTTP %s denials across isolated clients', async status => {
    let clock = 1000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      const first = await restart()
      fetch.mockResolvedValueOnce(response(entry)); await first.get(definition.id)
      fetch.mockResolvedValueOnce(response({}, status))
      await expect(first.get(definition.id)).rejects.toMatchObject({ status })
      let resolve!: (response: Response) => void
      fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
      const older = first.get(definition.id)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
      const isolated = await restart()
      fetch.mockResolvedValueOnce(response({}, status))
      await expect(isolated.get(definition.id)).rejects.toMatchObject({ status })
      resolve(response({ ...entry, n: 2, versionId: 'sha256:stale' })); await older
      fetch.mockRejectedValue(new TypeError('offline'))
      const reloaded = await restart()
      await expect(reloaded.get(definition.id)).rejects.toMatchObject({ code: 'auth', status })
      clock = 2000
      fetch.mockResolvedValueOnce(response(entry)); await reloaded.get(definition.id)
      fetch.mockRejectedValue(new TypeError('offline'))
      expect(await reloaded.get(definition.id)).toEqual(entry)
      await expect(reloaded.get(definition.id, 'sha256:stale')).rejects.toMatchObject({ code: 'offline-uncached' })
    } finally { now.mockRestore() }
  })
  it('reuses head bodies by versionId or numeric version offline and preserves older pinned bodies', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry))
    await client.get(definition.id)
    fetch.mockRejectedValue(new TypeError('offline'))
    expect(await client.get(definition.id, entry.versionId)).toEqual(entry)
    expect(await client.get(definition.id, '1')).toEqual(entry)
    expect(await client.get(definition.id, 1)).toEqual(entry)
    fetch.mockResolvedValueOnce(response({ ...entry, n: 2, versionId: 'sha256:new' }))
    await client.get(definition.id)
    fetch.mockRejectedValue(new TypeError('offline'))
    expect((await client.get(definition.id)).n).toBe(2)
    expect(await client.get(definition.id, 1)).toEqual(entry)
    fetch.mockResolvedValueOnce(response(entry))
    expect(await client.get(definition.id, 1)).toEqual(entry)
  })
  it('separates account and server caches', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    fetch.mockRejectedValue(new TypeError('offline')); uid = 'other-account'
    await expect(client.get(definition.id)).rejects.toMatchObject({ code: 'offline-uncached' })
    uid = null; await expect(client.get(definition.id)).rejects.toMatchObject({ status: 401 })
    uid = 'third-account'; localStorage.setItem('gym_server_url', 'https://synthetic.invalid')
    await expect(client.get(definition.id)).rejects.toMatchObject({ code: 'offline-uncached' })
  })
  it('rejects an account change while the body is in flight', async () => {
    let resolve!: (response: Response) => void
    fetch.mockImplementation(() => new Promise<Response>(r => { resolve = r }))
    const pending = createProgrammeLibrary(platform, () => uid).get(definition.id)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    uid = 'changed'; resolve(response(entry))
    await expect(pending).rejects.toMatchObject({ code: 'scope-changed' })
  })
  it('rejects malformed successful bodies, mismatched ids and unsolicited 304s', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(new Response('<html>')).mockResolvedValueOnce(response({ ...entry, definition: { ...definition, id: 'wrong' } })).mockResolvedValueOnce(response(null, 304))
    await expect(client.list()).rejects.toMatchObject({ code: 'bad-response' })
    await expect(client.get(definition.id)).rejects.toMatchObject({ code: 'bad-response' })
    await expect(client.list()).rejects.toMatchObject({ code: 'bad-response' })
  })
  it('bounds a stalled body and falls back to a cached body', async () => {
    const client = createProgrammeLibrary(platform, () => uid, 10)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    fetch.mockResolvedValue(Object.assign(response(entry), { json: () => new Promise(() => {}) }))
    vi.useFakeTimers()
    const pending = client.get(definition.id)
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toEqual(entry)
  })
  it('keeps the prior cache if replacement cache storage is full', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    platform.objects.put = vi.fn().mockRejectedValue(new Error('quota'))
    fetch.mockResolvedValueOnce(response({ ...entry, n: 2, versionId: 'sha256:new' }))
    expect((await client.get(definition.id)).n).toBe(2)
    fetch.mockRejectedValue(new TypeError('offline'))
    expect(await client.get(definition.id)).toEqual(entry)
  })
  it('preserves usable caches when a successful response has malformed structure', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(list)).mockResolvedValueOnce(response(entry))
    await client.list(); await client.get(definition.id)
    fetch.mockResolvedValueOnce(response({ items: [{ id: definition.id, versionId: entry.versionId }], etag: 'bad' }))
    await expect(client.list()).rejects.toMatchObject({ code: 'bad-response' })
    fetch.mockResolvedValueOnce(response({ ...entry, definition: { id: definition.id, weeks: [] } }))
    await expect(client.get(definition.id)).rejects.toMatchObject({ code: 'bad-response' })
    fetch.mockRejectedValue(new TypeError('offline'))
    expect(await client.list()).toEqual(list)
    expect(await client.get(definition.id)).toEqual(entry)
    expect(await client.get(definition.id, entry.versionId)).toEqual(entry)
  })
  it('does not clear a definition access refusal when an unrelated resource succeeds', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    fetch.mockResolvedValueOnce(response({}, 403))
    await expect(client.get(definition.id)).rejects.toMatchObject({ status: 403 })
    fetch.mockResolvedValueOnce(response(list)); await client.list()
    fetch.mockResolvedValueOnce(response({ ...entry, definition: { ...definition, id: 'other' } }))
    await client.get('other')
    fetch.mockRejectedValue(new TypeError('offline'))
    await expect(createProgrammeLibrary(platform, () => uid).get(definition.id)).rejects.toMatchObject({ status: 403 })
    expect(await client.get('other')).toMatchObject({ definition: { id: 'other' } })
  })
  it('rejects a corrupt persistent body cache offline', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValueOnce(response(entry)); await client.get(definition.id)
    for (const key of await platform.objects.keys('library')) await platform.objects.put('library', key, '{unreadable')
    fetch.mockRejectedValue(new TypeError('offline'))
    await expect(client.get(definition.id)).rejects.toMatchObject({ code: 'offline-uncached' })
  })
  it('encodes version queries and rejects traversal ids before transport', async () => {
    const client = createProgrammeLibrary(platform, () => uid)
    fetch.mockResolvedValue(response(entry))
    await client.get(definition.id, entry.versionId)
    expect(fetch.mock.calls[0]![0]).toContain('?version=sha256%3Asynthetic-v1')
    await expect(client.get('../private')).rejects.toMatchObject({ code: 'invalid-id' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
