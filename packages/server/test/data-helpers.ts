import { afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { request } from 'node:http'
import { openStore, putUser, writeAccountsMirror } from '../src/storage'
import type { ProgressionServices } from '../src/progression'
import { DataService, type DataOptions } from '../src/data'
import { createAuth } from '../src/auth'
import { loadConfig } from '../src/config'
import { startServer } from '../src/index'
import { scratchDir, user } from './helpers'
import { CLOCK, SECRET, mint } from './auth-helpers'

export { CLOCK, SECRET, mint }
export const dataHeaders = (uid: string) => ({ Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' })
export function dataServer(ids: string[] = ['u1'], options: DataOptions = {}, progression?: ProgressionServices) {
  const store = openStore(scratchDir())
  for (const [i, id] of ids.entries()) putUser(store.db, user(id, i))
  const clock = { t: CLOCK }, logs: string[] = []
  const config = loadConfig({ INVITE_ONLY: '0', PORT: '0', HOST: '127.0.0.1', DATA_DIR: store.dataDir, ORIGIN: 'http://localhost:8080' })
  const auth = createAuth(store.db, config, { secret: SECRET, now: () => clock.t, address: () => '127.0.0.1' })
  const data = new DataService(store.db, store.dataDir, { now: () => clock.t, log: message => logs.push(message), ...options })
  const server = startServer(config, { auth, data, progression, log: message => logs.push(message) }, () => {})
  afterEach(async () => { await server.stop(true); store.close() })
  const api = `http://127.0.0.1:${server.port}`
  const call = (method: string, endpoint: string, body?: unknown, uid = ids[0]!) => new Promise<{status:number;body:any}>((resolve,reject)=> {
    const req=request(api+endpoint,{method,headers:dataHeaders(uid),agent:false},res=> {
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{try {resolve({status:res.statusCode!,body:JSON.parse(text)})} catch(error){reject(error)}})
    });req.on('error',reject);req.end(body===undefined ? undefined : JSON.stringify(body))
  })
  // Test-only legacy restore analogue. No production route exposes this hook.
  const plant = (raw: string | object, uid = ids[0]!) => {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    let doc: any = {}
    try { doc = JSON.parse(text) } catch {}
    store.db.run('PRAGMA ignore_check_constraints=ON')
    try { store.db.query(`INSERT INTO state_docs(profile_id,rev,wid,json,bytes,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(profile_id) DO UPDATE SET rev=excluded.rev,wid=excluded.wid,json=excluded.json,bytes=excluded.bytes`)
      .run(uid, doc?._rev || 0, doc?._wid || null, text, Buffer.byteLength(text), clock.t) }
    finally { store.db.run('PRAGMA ignore_check_constraints=OFF') }
    fs.writeFileSync(path.join(store.dataDir, `state-${uid}.json`), text)
  }
  writeAccountsMirror(store.db, store.dataDir)
  return { ...store, data, auth, clock, logs, api, server, port: server.port, call, plant,
    stored: (uid = ids[0]!) => store.db.query<{ json: string }, [string]>('SELECT json FROM state_docs WHERE profile_id=?').get(uid)?.json }
}
