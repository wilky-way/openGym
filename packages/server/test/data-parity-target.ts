// Test-only SQLite-backed F3 target. storedDocs reads authoritative bytes, never mirrors.
import { createApp } from '../src/app'
import { createAuth } from '../src/auth'
import { DataService } from '../src/data'
import { loadConfig } from '../src/config'
import { openStore, putUser } from '../src/storage'
import { SYNTHETIC_SECRET, mintSession } from '../../parity/src/oracle'
import { decodeBytes, encodeBytes, type ParityTarget, type StoredDocs, type SyntheticProfile } from '../../parity/src/types'
import { scratchDir, user } from './helpers'

export function dataParityTarget(profile: SyntheticProfile): ParityTarget & { close(): void } {
  const store = openStore(scratchDir()), clock = { now: profile.now }
  for (const [i, record] of profile.db.users.entries()) putUser(store.db, user(record.id, i, { name: record.name, created: record.created, sv: record.sv ?? 0, admin: record.admin ? 1 : 0 }))
  const config = loadConfig({ DATA_DIR: store.dataDir, ORIGIN: 'http://localhost:8080' })
  const auth = createAuth(store.db, config, { secret: SYNTHETIC_SECRET, now: () => clock.now, address: () => '127.0.0.1' })
  const data = new DataService(store.db, store.dataDir, { now: () => clock.now, log: () => {} })
  const app = createApp(config, { auth, data, log: () => {} })
  const restoreDocs = async (docs: StoredDocs) => {
    store.db.run('PRAGMA ignore_check_constraints=ON')
    try {
      store.db.transaction(() => {
        store.db.run('DELETE FROM state_docs')
        store.db.run('DELETE FROM state_doc_history')
        for (const [uid, raw] of Object.entries(docs)) {
          let parsed: any = {}
          try { parsed = JSON.parse(raw.toString('utf8')) } catch {}
          // CAST retains the exact byte sequence, including deliberately invalid UTF-8
          // fixtures, without changing the production STRICT TEXT schema.
          store.db.query('INSERT INTO state_docs(profile_id,rev,wid,json,bytes,updated_at) VALUES(?,?,?,CAST(? AS TEXT),?,?)')
            .run(uid, parsed?._rev || 0, parsed?._wid || null, raw, raw.length, clock.now)
        }
      }).immediate()
    } finally { store.db.run('PRAGMA ignore_check_constraints=OFF') }
  }
  void restoreDocs(Object.fromEntries(Object.entries(profile.docs).map(([uid, text]) => [uid, Buffer.from(text)])))
  return {
    close: store.close,
    setTime: async now => { clock.now = now },
    storedDocs: async () => Object.fromEntries(store.db.query<{ profile_id: string; bytes: Uint8Array }, []>('SELECT profile_id,CAST(json AS BLOB) AS bytes FROM state_docs ORDER BY profile_id').all().map(row => [row.profile_id, Buffer.from(row.bytes)])),
    restoreDocs,
    request: async request => {
      const headers = { ...request.headers }
      if (request.session) {
        const token = mintSession(request.session.uid, clock.now, request.session.sv, request.session.expires)
        if (request.session.bearer) headers.Authorization = `Bearer ${token}`
        else headers.Cookie = `gymsid=${token}`
      }
      const response = await app.request(request.path, { method: request.method, headers, ...(request.body ? { body: new Uint8Array(decodeBytes(request.body)) } : {}) })
      const selected: Record<string, string[]> = {}
      response.headers.forEach((value, key) => { selected[key] = key === 'set-cookie' ? response.headers.getSetCookie() : [value] })
      return { status: response.status, headers: selected, body: encodeBytes(new Uint8Array(await response.arrayBuffer())) }
    },
  }
}
