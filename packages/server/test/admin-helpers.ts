import { afterEach } from 'bun:test'
import fs from 'node:fs'
import { createAuth } from '../src/auth'
import { loadConfig, type Environment } from '../src/config'
import { startServer } from '../src/index'
import { openStore, putUser, putCred, putSub, putInvite, commitStateDoc, writeStateMirror, writeAccountsMirror, exportAccounts } from '../src/storage'
import { scratchDir, user } from './helpers'
import { CLOCK, SECRET, mint } from './auth-helpers'
import type { AdminServices } from '../src/admin-routes'

export const ADMIN = 'u_adm_1', ADMIN2 = 'u_adm_2', VICTIM = 'u_vic_1'
export const as = (uid: string) => ({ Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' })
export const asAdmin = as(ADMIN)
export const mintSession = mint
export function startAdmin({ twoAdmins = false, env = {}, presence = {} }: {
  twoAdmins?: boolean; env?: Environment; presence?: AdminServices
} = {}) {
  const dataDir = scratchDir(), store = openStore(dataDir), db = store.db, clock = { t: CLOCK }, log: string[] = []
  putUser(db, user(ADMIN, 0, { name: 'Adminna', admin: 1 }))
  putUser(db, user(VICTIM, 1, { name: 'Mallory', invited_by: 'CODE1' }))
  if (twoAdmins) putUser(db, user(ADMIN2, 2, { name: 'Second', admin: 1 }))
  for (const [i, uid] of [VICTIM, ADMIN].entries()) {
    putCred(db, { id: 'c-' + uid, user_id: uid, public_key: 'x', counter: 0, transports: '[]', created: null,
      last_used: null, name: null, ord: i, x: '{}' })
    putSub(db, { endpoint: 'https://push/' + uid, user_id: uid, p256dh: 'x', auth: 'y', device_id: null, created: null, ord: i })
  }
  putInvite(db, { code: 'CODE1', note: '', created_by: ADMIN, created: new Date(CLOCK).toISOString(),
    used_by: VICTIM, used_at: new Date(CLOCK).toISOString(), revoked: 0, ord: 0 })
  const config = loadConfig({ INVITE_ONLY: '0', PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', ...env })
  const auth = createAuth(db, config, { secret: SECRET, now: () => clock.t, address: () => '127.0.0.1', log: v => log.push(v) })
  const server = startServer(config, { auth, now: () => clock.t, log: v => log.push(v), admin: presence }, () => {})
  afterEach(async () => { await server.stop(true); store.close() })
  const api = `http://127.0.0.1:${server.port}`
  const get = async (p: string, uid = ADMIN) => {
    const r = await fetch(api + p, { headers: as(uid) }); return { status: r.status, body: await r.json() }
  }
  const post = async (p: string, body?: unknown, uid = ADMIN) => {
    const r = await fetch(api + p, { method: 'POST', headers: as(uid), ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: r.status, body: await r.json() }
  }
  const plant = (s: Record<string, unknown>) => {
    commitStateDoc(db, VICTIM, JSON.stringify({ _rev: 3, ...s }), clock.t, 30)
    writeStateMirror(db, dataDir, VICTIM)
  }
  plant({ unit: 'kg', workouts: [] })
  writeAccountsMirror(db, dataDir)
  return { api, dataDir, log, get, post, clock, auth, config, store, sqlite: db, plant,
    del: (id: string, uid = ADMIN) => post('/api/admin/user/delete', { id }, uid),
    db: () => exportAccounts(db) as any, // adversarial legacy fixture inspection
    stackFrames: () => log.filter(l => /^\s+at /.test(l)).length }
}
