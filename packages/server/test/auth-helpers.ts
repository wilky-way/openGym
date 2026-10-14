import { afterEach } from 'bun:test'
import { createHmac } from 'node:crypto'
import { createAuth } from '../src/auth'
import type { AccountsMirrorOptions } from '../src/accounts-mirror'
import { openStore, putUser } from '../src/storage'
import { scratchDir, user } from './helpers'
import { loadConfig, type Environment } from '../src/config'
import { startServer } from '../src/index'
export const SECRET = 'a'.repeat(64),
  DAY = 86400000
export const CLOCK = 1791840000000
export const mint = (uid: string, daysLeft = 1, sv = 0, now = CLOCK) => {
  const payload = `${uid}:${now + daysLeft * DAY}:${sv}`
  return (
    payload +
    '.' +
    createHmac('sha256', SECRET).update(payload).digest('base64url')
  )
}
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
export const cookie = (uid: string, sv = 0) => ({
  Cookie: `gymsid=${mint(uid, 1, sv)}`,
})
export function authServer(env: Environment = {}, mirrorOptions: AccountsMirrorOptions = {}) {
  const store = openStore(scratchDir()),
    clock = { t: CLOCK }
  for (const [i, id] of [
    'u_test_1',
    'u_test_2',
    'u_phone',
    'u_bumped',
  ].entries())
    putUser(store.db, user(id, i, { sv: id === 'u_bumped' ? 1 : 0 }))
  const config = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: scratchDir(),
    ORIGIN: 'http://localhost:8080',
    SESSION_DAYS: '10', INVITE_ONLY: '0',
    ...env,
  })
  const auth = createAuth(store.db, config, {
    ...mirrorOptions,
    secret: SECRET,
    now: () => clock.t,
    address: () => '127.0.0.1',
  })
  const server = startServer(config, { auth, now: () => clock.t }, () => {})
  afterEach(async () => {
    await server.stop(true)
    store.close()
  })
  const api = `http://127.0.0.1:${server.port}`
  const me = (headers: HeadersInit) => fetch(api + '/api/me', { headers })
  const post = (p: string, headers: HeadersInit = {}, body?: unknown) =>
    fetch(api + p, {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { auth, db: store.db, clock, api, me, post, config }
}
