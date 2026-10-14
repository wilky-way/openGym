import { afterEach } from 'bun:test'
import crypto from 'node:crypto'
import { createAuth } from '../src/auth'
import { openStore, putUser, putCred, putInvite, putDeviceLink, exportAccounts, listAudit } from '../src/storage'
import { startServer as listen } from '../src/index'
import { loadConfig, type Environment } from '../src/config'
import { scratchDir, user as storedUser } from './helpers'
import { mint, CLOCK, SECRET } from './auth-helpers'
import type { PasskeyOptions } from '../src/passkey-routes'
export const ORIGIN = 'http://localhost:8080'
export const b64u = (b: string | Uint8Array) => Buffer.from(b as Uint8Array).toString('base64url')
const sha = (b: string | Uint8Array) => crypto.createHash('sha256').update(b).digest()
export const mintSession = (uid: string, sv = 0) => 'gymsid=' + mint(uid, 1, sv)
export const user = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, created: new Date(CLOCK).toISOString(), ...extra })
export const withPassword = (id: string, name: string) => user(id, name, { pw: { h: 'deleted-password-fixture' } })
export const GOOD = 'deleted-password-proof'
const cborHead = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255])
const cborText = (s: string) => Buffer.concat([cborHead(3, Buffer.byteLength(s)), Buffer.from(s)])
const cborBytes = (b: Buffer) => Buffer.concat([cborHead(2, b.length), b])
let keyNumber = 0
/** Fixed seeds derive synthetic P-256 keys; none of this material is a real credential. */
export function softPasskey(seed = `passkeys-software-authenticator-${++keyNumber}`) {
  const d = sha(seed), ecdh = crypto.createECDH('prime256v1')
  ecdh.setPrivateKey(d)
  const point = ecdh.getPublicKey(), x = point.subarray(1, 33), y = point.subarray(33)
  const privateKey = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(x), y: b64u(y) } })
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y])
  const raw = sha(`credential:${seed}`).subarray(0,16), id = b64u(raw)
  let counter = 0
  return {
    id,
    row: (userId: string, extra: Record<string, unknown> = {}) => ({ id, userId, publicKey: b64u(cose), counter: 0, transports: ['internal'], ...extra }),
    attestation(challenge: string, { origin = ORIGIN, rpId = 'localhost', flags = 0x45 } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }))
      const len = Buffer.from([raw.length >> 8, raw.length & 255])
      const authData = Buffer.concat([sha(rpId), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), len, raw, cose])
      const attestationObject = Buffer.concat([Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]), cborText('authData'), cborBytes(authData)])
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] } } as const
    },
    assertion(challenge: string, { origin = ORIGIN, rpId = 'localhost', flags = 0x05 } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }))
      const c = Buffer.alloc(4); c.writeUInt32BE(++counter)
      const authData = Buffer.concat([sha(rpId), Buffer.from([flags]), c])
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), privateKey)
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null } } as const
    },
  }
}
export async function startServer(_t: unknown, { env = {}, users = [], creds = [], deviceLinks = [], invites = [], passkeys = {} }: {
  env?: Environment; users?: any[]; creds?: any[]; deviceLinks?: any[]; invites?: any[]; passkeys?: PasskeyOptions
} = {}) {
  const dataDir = scratchDir(), store = openStore(dataDir), clock = { t: CLOCK }
  users.forEach((u, i) => putUser(store.db, storedUser(u.id, i, { name: u.name, created: u.created, admin: +!!u.admin, disabled: +!!u.disabled, sv: u.sv || 0, x: JSON.stringify(u.pw ? { pw: u.pw } : {}) })))
  creds.forEach((c, ord) => putCred(store.db, { id: c.id, user_id: c.userId, public_key: c.publicKey, counter: c.counter || 0, transports: JSON.stringify(c.transports || []), created: c.created || null, last_used: c.lastUsed || null, name: c.name || null, ord, x: '{}' }))
  deviceLinks.forEach(l => putDeviceLink(store.db, { h: l.h, user_id: l.userId, exp: l.exp, created: l.created }))
  invites.forEach((i, ord) => putInvite(store.db, { code: i.code, note: '', created_by: null, created: null, used_by: i.usedBy || null, used_at: null, revoked: +!!i.revoked, ord }))
  const config = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ORIGIN, INVITE_ONLY: '0', RP_ID: 'localhost', TRUST_PROXY: '1', ...env })
  const auth = createAuth(store.db, config, { secret: SECRET, now: () => clock.t, address: () => '127.0.0.1' })
  const server = listen(config, { auth, passkeys, now: () => clock.t, userCount: () => users.length }, () => {})
  afterEach(async () => { await server.stop(true); store.close() })
  const api = `http://127.0.0.1:${server.port}`
  const req = async (method: string, p: string, { body, cookie, ip = '198.51.100.1', headers = {} }: { body?: unknown; cookie?: string | null; ip?: string; headers?: Record<string,string> } = {}) => {
    const r = await fetch(api + p, { method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const setCookie = r.headers.getSetCookie().find(c => /^(?:__Host-)?gymsid=.+/.test(c) && !/gymsid=;/.test(c))
    return { status: r.status, body: await r.json() as any, headers: r.headers, cookie: setCookie ? setCookie.split(';')[0]! : null }
  }
  const stepUp = async (key: ReturnType<typeof softPasskey>, ip?: string) => {
    const { cid, options } = (await req('POST', '/api/login/options', { body: {}, ip })).body
    return { cid, credential: key.assertion(options.challenge) }
  }
  return { api, dataDir, req, stepUp, clock, auth, sql: store.db,
    db: () => exportAccounts(store.db) as { users: any[]; creds: any[]; deviceLinks: any[]; invites: any[]; subs: any[] }, audit: () => listAudit(store.db, 10000) }
}

export async function makeLink(h: Awaited<ReturnType<typeof startServer>>, key: ReturnType<typeof softPasskey>, uid: string, ip: string) {
  return h.req('POST', '/api/account/device-link', { body: await h.stepUp(key, ip), cookie: mintSession(uid), ip })
}
export async function redeem(h: Awaited<ReturnType<typeof startServer>>, code: string, fresh: ReturnType<typeof softPasskey>, ip: string, name?: string) {
  const opt = await h.req('POST', '/api/device-link/options', { body: { code }, ip })
  if (opt.status !== 200) return opt
  return h.req('POST', '/api/device-link/verify', { body: { code, cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge), name }, ip })
}
