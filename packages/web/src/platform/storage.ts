import { QuotaError, type KeyValueStore, type ObjectStore } from '@opengym/contract/platform/adapters'

/** Pass keys and serialized values through unchanged; existing gym_* data stays readable. */
export function browserKeyValueStore(win: Window): KeyValueStore {
  return {
    get: key => win.localStorage.getItem(key),
    set(key, value) {
      try { win.localStorage.setItem(key, value) }
      catch (error) {
        if (error instanceof Error && error.name === 'QuotaExceededError') {
          throw new QuotaError(error.message, { cause: error })
        }
        throw error
      }
    },
    remove: key => win.localStorage.removeItem(key),
    subscribe(listener) {
      const changed = (event: StorageEvent) => {
        if (event.storageArea === win.localStorage) listener(event.key)
      }
      win.addEventListener('storage', changed)
      return () => win.removeEventListener('storage', changed)
    },
  }
}

// New cache only: deleted legacy upload records are neither imported nor migrated.
export const OBJECT_DATABASE = 'opengym-platform'
type Bucket = Parameters<ObjectStore['get']>[0]

export function browserObjectStore(idb: IDBFactory | undefined): ObjectStore {
  let connection: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('IndexedDB is unavailable'))
    if (connection) return connection
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(OBJECT_DATABASE, 1)
      let refused = false
      request.onupgradeneeded = () => {
        for (const name of ['media', 'library']) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
        }
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      request.onblocked = () => {
        refused = true
        reject(new Error('IndexedDB open blocked'))
      }
      request.onsuccess = () => {
        const db = request.result
        if (refused) { db.close(); return }
        db.onversionchange = () => { db.close(); connection = undefined }
        db.onclose = () => { connection = undefined }
        resolve(db)
      }
    }).catch(error => { connection = undefined; throw error })
    return connection
  }
  async function exchange<T>(bucket: Bucket, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(bucket, mode)
      let result: T
      // Resolve only after commit, never on request success (a later abort must reject).
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      try {
        const request = action(tx.objectStore(bucket))
        request.onsuccess = () => { result = request.result }
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
      } catch (error) {
        tx.abort()
        reject(error)
      }
    })
  }
  return {
    async get(bucket, key) {
      const value: unknown = await exchange(bucket, 'readonly', store => store.get(key))
      if (value === undefined) return null
      if (typeof value === 'string' || value instanceof Uint8Array) return value
      throw new Error('Invalid cached object')
    },
    async put(bucket, key, value) { await exchange(bucket, 'readwrite', store => store.put(value, key)) },
    async delete(bucket, key) { await exchange(bucket, 'readwrite', store => store.delete(key)) },
    async keys(bucket) {
      const keys = await exchange(bucket, 'readonly', store => store.getAllKeys())
      return keys.map(key => {
        if (typeof key !== 'string') throw new Error('Invalid cached key')
        return key
      })
    },
  }
}
