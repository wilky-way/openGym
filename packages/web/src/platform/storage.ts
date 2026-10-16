import type { WorkoutJournalStorage } from '@opengym/contract/platform/adapters'
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
export function browserObjectStore(idb: IDBFactory | undefined): ObjectStore {
  return createObjectStore(idb, OBJECT_DATABASE, ['media', 'library'])
}

export const WORKOUT_JOURNAL_DATABASE = 'opengym-workout-journal'
export function browserWorkoutJournal(idb: IDBFactory | undefined): WorkoutJournalStorage {
  const store = createObjectStore(idb, WORKOUT_JOURNAL_DATABASE, ['sessions', 'terminals'], 2)
  return {
    async get(key) { const value = await store.get('sessions', key); return typeof value === 'string' ? value : null },
    async put(key, value) {
      const record = JSON.parse(value) as {active?: unknown; finished?: unknown; closed?: {deletedAt?:number}; ts?: number}
      const rank = record.closed ? 2 : record.finished ? 1 : 0
      let accepted=false
      await store.transaction(['sessions','terminals'], tx => {
        const sessions=tx.objectStore('sessions'), terminals=tx.objectStore('terminals')
        const read=terminals.get(key)
        read.onsuccess=() => {
          const previous=read.result && typeof read.result === 'object' ? read.result : {}
          const payload=sessions.get(key)
          payload.onsuccess=() => {
            let stored: typeof record | undefined
            if (typeof payload.result === 'string') {
              try { stored=JSON.parse(payload.result) } catch { return }
            }
            // Read the old payload as well as metadata: v1 journals did not
            // carry ordering metadata and must remain safe during upgrade.
            const payloadRank=stored?.closed ? 2 : stored?.finished ? 1 : 0
            const metadataRank=typeof read.result === 'number' ? read.result : Number(previous.rank) || 0
            const terminal=Math.max(metadataRank,payloadRank)
            if (rank < terminal) return
            const deletedAt=Number(record.closed?.deletedAt) || 0
            const priorDeleted=Math.max(Number(previous.deletedAt) || 0,Number(stored?.closed?.deletedAt) || 0)
            const priorTs=Math.max(metadataRank === rank ? Number(previous.ts) || 0 : 0,payloadRank === rank ? Number(stored?.ts) || 0 : 0)
            if (rank === terminal && (priorDeleted > deletedAt || priorDeleted === deletedAt && priorTs > (record.ts || 0))) return
            // Equal independent clocks establish no causal order. A conflicting
            // active writer is refused and honestly reports memory durability.
            if (rank === 0 && stored && priorTs === (record.ts || 0) && JSON.stringify(stored.active) !== JSON.stringify(record.active)) return
            // Every rank has ordering metadata, checked with its payload in the
            // same transaction even across suspended engines and separate tabs.
            terminals.put({rank,ts:record.ts || 0,deletedAt,...(record.closed ? {receipt:value} : {})},key)
            if (record.closed) sessions.delete(key)
            else sessions.put(value,key)
            accepted=true
          }
        }
      })
      return accepted
    },
    async delete(key, expected) {
      let accepted=false
      await store.transaction(['sessions','terminals'], tx => {
        const terminals=tx.objectStore('terminals'), sessions=tx.objectStore('sessions'), read=terminals.get(key)
        read.onsuccess=() => {
          const previous=read.result && typeof read.result === 'object' ? read.result : {}
          const payload=sessions.get(key)
          payload.onsuccess=() => {
            // An acknowledgement/prune may have waited outside this transaction.
            // Retire only the exact decision it observed, never a newer receipt.
            if (expected !== undefined && ((payload.result !== expected && previous.receipt !== expected) || previous.receipt !== undefined && previous.receipt !== expected)) return
            const next={...previous,rank:2}
            if (expected !== undefined) delete next.receipt
            terminals.put(next,key)
            sessions.delete(key)
            accepted=true
          }
        }
      })
      return accepted
    },
    keys: () => store.keys('sessions'),
    async receipts() {
      const receipts: [string,string][]=[]
      for (const key of await store.keys('terminals')) {
        const raw=await store.raw('terminals',key)
        if (raw && typeof raw === 'object' && 'receipt' in raw && typeof raw.receipt === 'string') receipts.push([key,raw.receipt])
      }
      return receipts
    },
  }
}

function createObjectStore<Bucket extends string>(idb: IDBFactory | undefined, database: string, buckets: Bucket[], version = 1) {
  let connection: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('IndexedDB is unavailable'))
    if (connection) return connection
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = idb.open(database, version)
      let refused = false
      request.onupgradeneeded = () => {
        for (const name of buckets) {
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
    async transaction(selected: Bucket[], action: (tx: IDBTransaction) => void) {
      const db=await open()
      return new Promise<void>((resolve,reject) => {
        const tx=db.transaction(selected,'readwrite')
        tx.oncomplete=() => resolve()
        tx.onerror=() => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort=() => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
        try { action(tx) } catch(error) { tx.abort(); reject(error) }
      })
    },
    async raw(bucket: Bucket,key: string): Promise<unknown> { return exchange(bucket,'readonly',store => store.get(key)) },
    async get(bucket: Bucket, key: string) {
      const value: unknown = await exchange(bucket, 'readonly', store => store.get(key))
      if (value === undefined) return null
      if (typeof value === 'string' || value instanceof Uint8Array) return value
      throw new Error('Invalid cached object')
    },
    async put(bucket: Bucket, key: string, value: Uint8Array | string) { await exchange(bucket, 'readwrite', store => store.put(value, key)) },
    async delete(bucket: Bucket, key: string) { await exchange(bucket, 'readwrite', store => store.delete(key)) },
    async keys(bucket: Bucket) {
      const keys = await exchange(bucket, 'readonly', store => store.getAllKeys())
      return keys.map(key => {
        if (typeof key !== 'string') throw new Error('Invalid cached key')
        return key
      })
    },
  }
}
