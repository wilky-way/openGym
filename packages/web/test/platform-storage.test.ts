import { afterEach, describe, expect, it, vi } from 'vitest'
import { Window as HappyWindow } from 'happy-dom'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { QuotaError } from '@opengym/contract/platform/adapters'
import { browserKeyValueStore, browserObjectStore } from '../src/platform/storage'

afterEach(() => vi.restoreAllMocks())
const page = () => new HappyWindow({ url: 'https://gym.example/gym/' }) as unknown as Window
const changed = (win: Window, key: string | null, storageArea: Storage) => {
  const Event = (win as Window & typeof globalThis).StorageEvent
  win.dispatchEvent(new Event('storage', { key, storageArea }))
}

describe('browser KeyValueStore', () => {
  it('preserves legacy keys and serialized values byte for byte', () => {
    const win = page(), kv = browserKeyValueStore(win)
    const keys = ['gym_state_v1', 'gym_sync', 'gym_stash', 'gym_adopt', 'gym_rest_timer', 'gym_day_reminder']
    const bytes = '{"z":1,"unknown":null,"a":"☃"}'
    for (const key of keys) {
      win.localStorage.setItem(key, bytes)
      expect(kv.get(key)).toBe(bytes)
      kv.set(key, bytes + ' ')
      expect(win.localStorage.getItem(key)).toBe(bytes + ' ')
      kv.remove(key)
      expect(win.localStorage.getItem(key)).toBeNull()
    }
  })

  it('notifies only other-tab local storage changes, including clear, and unsubscribes', () => {
    const win = page(), kv = browserKeyValueStore(win), listener = vi.fn()
    const stop = kv.subscribe(listener)
    kv.set('gym_sync', '1')
    expect(listener).not.toHaveBeenCalled()
    changed(win, 'gym_sync', win.sessionStorage)
    changed(win, 'gym_sync', win.localStorage)
    changed(win, null, win.localStorage)
    expect(listener.mock.calls).toEqual([['gym_sync'], [null]])
    stop()
    changed(win, 'gym_sync', win.localStorage)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('maps quota errors and preserves other storage failures', () => {
    const win = page(), kv = browserKeyValueStore(win)
    const quota = new DOMException('full', 'QuotaExceededError')
    vi.spyOn(win.localStorage, 'setItem').mockImplementation(() => { throw quota })
    expect(() => kv.set('gym_state_v1', '{}')).toThrow(QuotaError)
    try { kv.set('gym_state_v1', '{}') } catch (error) { expect((error as Error).cause).toBe(quota) }
    const denied = new DOMException('denied', 'SecurityError')
    vi.spyOn(win.localStorage, 'setItem').mockImplementation(() => { throw denied })
    expect(() => kv.set('gym_state_v1', '{}')).toThrow(denied)
  })
})

describe('browser ObjectStore', () => {
  it('persists strings and bytes across adapters, isolates buckets, and lists/deletes keys', async () => {
    const idb = new IDBFactory(), store = browserObjectStore(idb)
    expect(await store.get('library', 'missing')).toBeNull()
    const bytes = new Uint8Array([0, 127, 255])
    await Promise.all([store.put('library', 'b', '{"etag":"synthetic"}'), store.put('library', 'a', bytes)])
    bytes[0] = 99
    const reopened = browserObjectStore(idb)
    expect(await reopened.get('library', 'a')).toEqual(new Uint8Array([0, 127, 255]))
    expect(await reopened.get('library', 'b')).toBe('{"etag":"synthetic"}')
    expect(await reopened.get('media', 'b')).toBeNull()
    expect(await reopened.keys('library')).toEqual(['a', 'b'])
    await reopened.delete('library', 'a')
    await reopened.delete('library', 'missing')
    expect(await store.keys('library')).toEqual(['b'])
    await reopened.put('library', 'b', '')
    expect(await store.get('library', 'b')).toBe('')
  })

  it('rejects unavailable IndexedDB without claiming a persistent write', async () => {
    const store = browserObjectStore(undefined)
    await expect(store.get('library', 'x')).rejects.toThrow('unavailable')
    await expect(store.put('library', 'x', 'x')).rejects.toThrow('unavailable')
    await expect(store.delete('library', 'x')).rejects.toThrow('unavailable')
    await expect(store.keys('library')).rejects.toThrow('unavailable')
  })

  it('rejects transaction aborts after request success and retries subsequent writes', async () => {
    const store = browserObjectStore(new IDBFactory()), original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = original.apply(this, args)
      request.addEventListener('success', () => this.transaction.abort())
      return request
    })
    await expect(store.put('library', 'x', 'lost')).rejects.toThrow('aborted')
    spy.mockRestore()
    expect(await store.get('library', 'x')).toBeNull()
    await store.put('library', 'x', 'committed')
    expect(await store.get('library', 'x')).toBe('committed')
  })

  it('retries a refused database open', async () => {
    const idb = new IDBFactory(), store = browserObjectStore(idb), open = idb.open.bind(idb)
    vi.spyOn(idb, 'open').mockImplementationOnce(() => { throw new Error('private browsing denied') }).mockImplementation(open)
    await expect(store.keys('library')).rejects.toThrow('private browsing denied')
    await store.put('library', 'x', 'recovered')
    expect(await store.get('library', 'x')).toBe('recovered')
  })
})
