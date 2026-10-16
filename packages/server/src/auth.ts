import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'bun:sqlite'
import type { DeviceRow, User } from '@opengym/contract/http/api'
import type { ServerConfig } from './config'
import {
  atomicWrite,
  getUser,
  getMeta,
  setMeta,
  appendAudit,
  pruneAudit,
  type UserRow,
} from './storage'
import {
  getDevice,
  putDevice,
  touchDevice,
  putPredecessor,
  predecessorDevice,
  revokeDevice as revokeStoredDevice,
  type StoredDevice,
} from './storage/devices'
import { createBackoff, createWindow } from './rate-limit'
import { ApiError } from './http'
import { limitAddress, clientIp } from './auth-address'
import { invalidateChallenges } from './challenges'
import { saveAccountsMirror, type AccountsMirrorOptions } from './accounts-mirror'
import { createAudit } from './audit'

export interface Session {
  user: UserRow
  exp: number
  bearer: boolean
  token: string
  device: StoredDevice
  v2: boolean
  legacyCookie?: boolean
}
const DAY = 86400000
export const tokenHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex')
export function loadSecret(dataDir: string): string {
  const file = join(dataDir, 'secret')
  if (!existsSync(file))
    atomicWrite(file, randomBytes(32).toString('hex'), 0o600)
  const secret = readFileSync(file, 'utf8').trim()
  if (!/^[a-fA-F0-9]{64}$/.test(secret))
    throw new Error('invalid session secret')
  return secret
}
export function sign(payload: string, secret: string): string {
  return (
    payload +
    '.' +
    createHmac('sha256', secret).update(payload).digest('base64url')
  )
}
export function verifySig(token: string, secret: string): string | null {
  const i = token.lastIndexOf('.')
  if (i < 0) return null
  const payload = token.slice(0, i),
    mac = Buffer.from(token.slice(i + 1))
  const expected = Buffer.from(
    createHmac('sha256', secret).update(payload).digest('base64url'),
  )
  return mac.length === expected.length && timingSafeEqual(mac, expected)
    ? payload
    : null
}
export function cookieToken(
  request: Request,
  secure: boolean,
): { token: string | null; shadowed: boolean; plain?: boolean } {
  for (const name of secure ? ['__Host-gymsid', 'gymsid'] : ['gymsid']) {
    const values = (request.headers.get('cookie') || '')
      .split(';')
      .flatMap((c) => {
        const i = c.indexOf('=')
        return i >= 0 && c.slice(0, i).trim() === name
          ? [c.slice(i + 1).trim()]
          : []
      })
    if (!values.length) continue
    if (values.some((v) => v !== values[0]))
      return { token: null, shadowed: true }
    return { token: values[0] || null, shadowed: false, plain: name === 'gymsid' }
  }
  return { token: null, shadowed: false }
}
export function cookieHeaders(config: ServerConfig, token?: string): Headers {
  const headers = new Headers()
  const names = config.secure ? ['__Host-gymsid', 'gymsid'] : ['gymsid']
  for (const [i, name] of names.entries())
    headers.append(
      'Set-Cookie',
      `${name}=${i === 0 && token ? token : ''}; Path=/; Max-Age=${i === 0 && token ? config.sessionDays * 86400 : 0}; HttpOnly;${config.secure ? ' Secure;' : ''} SameSite=Lax`,
    )
  return headers
}
export function createAuth(
  db: Database,
  config: ServerConfig,
  options: AccountsMirrorOptions & {
    secret?: string
    now?: () => number
    address?: (request: Request) => string
    log?: (message: string) => void
  } = {},
) {
  const secret = options.secret ?? loadSecret(config.dataDir),
    now = options.now ?? Date.now
  const migratingCookies = new WeakSet<Request>()
  type Initiator = { deviceId: string; predecessorHash?: string }
  const pairings = new Map<string, { uid: string; exp: number; sv: number } & Initiator>()
  const initiatingDevice = (p: Initiator) => getDevice(db, p.deviceId)
    ?? (p.predecessorHash ? getDevice(db, predecessorDevice(db, p.predecessorHash) ?? '') : null)
  const burst = createWindow({
    max: config.exposure === 'public' ? 30 : 60,
    now,
  })
  const fails = createBackoff({
    free: config.exposure === 'public' ? 10 : 20,
    baseMs: 30000,
    maxMs: 900000,
    forgetMs: 3600000,
    now,
  })
  const failAudit = createWindow({ max: 10, now }),
    failAuditAll = createWindow({ max: 120, now })
  let swept = now()
  const validUser = (uid: string, sv: number) => {
    const u = getUser(db, uid)
    return u && !u.disabled && u.sv === sv ? u : null
  }
  function mint(
    user: UserRow,
    kind: Exclude<DeviceRow['kind'], 'legacy'> = 'browser',
    did?: string,
  ): string {
    const current = validUser(user.id, user.sv)
    if (!current) throw new ApiError(401, 'not signed in')
    const exp = now() + config.sessionDays * DAY
    if (!config.deviceTokens && !did)
      return sign(`${user.id}:${exp}:${user.sv}`, secret)
    const id = did ?? randomBytes(12).toString('base64url')
    if (did) {
      const d = getDevice(db, did)
      if (
        !d ||
        d.user_id !== user.id ||
        d.revoked_at !== null ||
        d.sv !== current.sv ||
        d.kind === 'legacy'
      )
        throw new ApiError(401, 'not signed in')
    } else
      putDevice(db, {
        id,
        user_id: user.id,
        kind,
        name: '',
        sv: user.sv,
        created: now(),
        last_seen: now(),
        revoked_at: null,
      })
    return sign(`v2.${id}.${exp}`, secret)
  }
  function sessionOf(request: Request): Session | null {
    const cookie = cookieToken(request, config.secure)
    if (cookie.shadowed) return null
    const authorization = request.headers.get('authorization') || ''
    const token =
      cookie.token ||
      (authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : null)
    if (!token) return null
    const payload = verifySig(token, secret)
    if (!payload) return null
    const v2 = payload.startsWith('v2.')
    const legacyCookie = config.secure && !!cookie.token && !!cookie.plain
    // The unprefixed secure cookie is only a one-time v1 migration path.
    if (legacyCookie && (v2 || (getMeta(db, `secure_cookie_migrated:${tokenHash(token)}`) && !migratingCookies.has(request)))) return null
    let device: StoredDevice | null, user: UserRow | null, exp: number
    if (v2) {
      const parts = payload.split('.')
      if (
        parts.length !== 3 ||
        !/^[A-Za-z0-9_-]{16}$/.test(parts[1] || '') ||
        !/^\d+$/.test(parts[2] || '')
      )
        return null
      exp = Number(parts[2])
      device = getDevice(db, parts[1]!)
      if (!device || device.kind === 'legacy' || device.revoked_at !== null)
        return null
      user = validUser(device.user_id, device.sv)
    } else {
      const parts = payload.split(':')
      if (
        parts.length < 2 ||
        parts.length > 3 ||
        !parts[0] ||
        !/^\d+$/.test(parts[1] || '')
      )
        return null
      exp = Number(parts[1])
      const sv = parts[2] === undefined ? 0 : Number(parts[2])
      if (!Number.isInteger(sv)) return null
      user = validUser(parts[0]!, sv)
      if (!user || !Number.isSafeInteger(exp) || exp < now()) return null
      const hash = tokenHash(token),
        predecessor = predecessorDevice(db, hash),
        did = predecessor ?? `legacy:${hash.slice(0, 16)}`
      device = getDevice(db, did)
      if (predecessor && !device) return null
      if (!device) {
        device = {
          id: did,
          user_id: user.id,
          kind: 'legacy',
          name: '',
          sv,
          created: now(),
          last_seen: now(),
          revoked_at: null,
        }
        putDevice(db, device)
      }
      if (
        device.user_id !== user.id ||
        device.sv !== sv ||
        device.revoked_at !== null
      )
        return null
    }
    if (!user || !Number.isSafeInteger(exp) || exp < now()) return null
    touchDevice(db, device.id, now())
    return { user, exp, bearer: !cookie.token, token, device, v2, legacyCookie }
  }
  function renew(s: Session): string {
    return db
      .transaction(() => {
        const latest = sessionOf(
          new Request('http://auth/', {
            headers: { Authorization: 'Bearer ' + s.token },
          }),
        )
        if (!latest) throw new ApiError(401, 'not signed in')
        s = { ...latest, bearer: s.bearer }
        if (s.v2 || s.device.kind !== 'legacy')
          return mint(s.user, 'paired', s.device.id)
        if (!config.deviceTokens) return mint(s.user)
        const token = mint(s.user, s.bearer ? 'paired' : 'browser')
        const did = token.split('.')[1]!
        putPredecessor(db, tokenHash(s.token), did)
        db.query('DELETE FROM devices WHERE id=?').run(s.device.id)
        return token
      })
      .immediate()
  }
  function publicUser(u: UserRow): User {
    return {
      id: u.id,
      name: u.name,
      admin: !!u.admin || config.adminUids.includes(u.id),
    }
  }
  function migrateCookie(s: Session, request: Request): boolean {
    const accepted = db.transaction(() => {
      const key = `secure_cookie_migrated:${tokenHash(s.token)}`
      if (getMeta(db, key)) return false
      setMeta(db, key, '1')
      return true
    }).immediate()
    // Only this request may re-check its consumed legacy cookie after a body await.
    if (accepted) migratingCookies.add(request)
    return accepted
  }
  function limit(request: Request, kind?: string): void {
    if (now() - swept >= 60000) {
      burst.sweep()
      fails.sweep()
      failAudit.sweep()
      failAuditAll.sweep()
      for (const [k, p] of pairings) if (p.exp < now()) pairings.delete(k)
      swept = now()
    }
    const addr = address(request),
      wait =
        burst.take(addr) || (kind ? fails.retryAfter(kind + '|' + addr) : 0)
    if (wait)
      throw new ApiError(
        429,
        'too many attempts, try again later',
        { code: 'locked', retryAfter: wait },
        { 'Retry-After': String(wait) },
      )
  }
  function address(request: Request): string {
    return limitAddress(request, config, options.address?.(request))
  }
  function checkFailure(request: Request, kind: string): void {
    const wait = fails.retryAfter(kind + '|' + address(request))
    if (wait)
      throw new ApiError(
        429,
        'too many attempts, try again later',
        { code: 'locked', retryAfter: wait },
        { 'Retry-After': String(wait) },
      )
  }
  function failed(request: Request, kind: string): void {
    if (kind !== 'pair' || config.exposure === 'public') {
      const lock = fails.fail(kind + '|' + address(request))
      if (lock) audit('auth.throttled', undefined, false, kind, request)
    }
  }
  const auditLog = createAudit(db, config, {
    now, ip: request => clientIp(request, config, options.address?.(request)), log: options.log,
  })
  function audit(
    ev: string, s?: Pick<Session, 'user'>, ok = true, msg: string | null = null,
    request?: Request, uid?: string, fields: { act?: string; name?: string } = {},
  ): void {
    auditLog.write(ev, { user: s?.user, uid, ok, msg, ...fields }, request)
  }
  function auditFailure(request: Request, ev: string, msg: string, s?: Pick<Session, 'user'>, fields: { act?: string; name?: string } = {}): void {
    if (failAudit.take(ev + '|' + address(request)) || failAuditAll.take(ev))
      return
    audit(ev, s, false, msg, request, undefined, fields)
  }
  function createPair(s: Session): string {
    for (const [k, p] of pairings)
      if (p.uid === s.user.id || p.exp < now()) pairings.delete(k)
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code: string
    do {
      code = Array.from(
        { length: 8 },
        () => alphabet[randomInt(alphabet.length)],
      ).join('')
    } while (pairings.has(code))
    pairings.set(code, { uid: s.user.id, sv: s.user.sv, exp: now() + 300000,
      deviceId: s.device.id, ...(s.v2 ? {} : { predecessorHash: tokenHash(s.token) }) })
    return code
  }
  function redeem(
    code: string,
    request?: Request,
  ): { token: string; user: User } | null {
    const p = pairings.get(code)
    pairings.delete(code)
    if (!p || p.exp < now()) {
      if (request) auditFailure(request, 'auth.pair.fail', 'code-invalid')
      return null
    }
    return db.transaction(() => {
      const u = validUser(p.uid, p.sv), device = initiatingDevice(p)
      if (!u || !device || device.user_id !== p.uid || device.sv !== p.sv || device.revoked_at !== null) {
        audit(
          'auth.pair.fail',
          undefined,
          false,
          'user-unavailable',
          request,
          p.uid,
        )
        return null
      }
      return { token: mint(u, 'paired'), user: publicUser(u) }
    }).immediate()
  }
  function dropDeviceLinks(uid: string, id: string): void {
    const key = `device_link_proof:${uid}`, saved = getMeta(db, key)
    if (!saved) {
      // Legacy links have no initiating-device provenance; never leave them redeemable.
      db.query('DELETE FROM device_links WHERE user_id=?').run(uid)
      return
    }
    const p = JSON.parse(saved) as { lh: string; ownership: Initiator }
    if (p.ownership.deviceId === id || initiatingDevice(p.ownership)?.id === id) {
      db.query('DELETE FROM device_links WHERE user_id=? AND h=?').run(uid, p.lh)
      db.query('DELETE FROM meta WHERE key=?').run(key)
    }
  }
  function dropPairings(uid: string, id: string): void {
    for (const [code, p] of pairings)
      if (p.uid === uid && (p.deviceId === id || initiatingDevice(p)?.id === id)) pairings.delete(code)
  }
  // S13 security: device revocation and pending enrollment invalidation are one write.
  function revokeDevice(id: string, uid: string): boolean {
    const revoked = db.transaction(() => {
      if (!revokeStoredDevice(db, id, uid, now())) return false
      dropDeviceLinks(uid, id)
      invalidateChallenges(db, uid)
      return true
    }).immediate()
    if (revoked) { dropPairings(uid, id); saveAccountsMirror(db, config.dataDir, options) }
    return revoked
  }
  function logout(s: Session): void {
    if (s.v2) revokeDevice(s.device.id, s.user.id)
    else {
      db.transaction(() => { dropDeviceLinks(s.user.id, s.device.id); invalidateChallenges(db, s.user.id) }).immediate()
      dropPairings(s.user.id, s.device.id)
      saveAccountsMirror(db, config.dataDir, options)
    }
  }
  function logoutAll(s: Session): void {
    db.transaction(() => {
      db.query('UPDATE users SET sv=sv+1 WHERE id=?').run(s.user.id)
      invalidateChallenges(db, s.user.id)
      db.query('DELETE FROM device_links WHERE user_id=?').run(s.user.id)
    }).immediate()
    for (const [k, p] of pairings) if (p.uid === s.user.id) pairings.delete(k)
    saveAccountsMirror(db, config.dataDir, options)
  }
  return {
    db,
    config,
    now,
    mint,
    sessionOf,
    renew,
    migrateCookie,
    publicUser,
    limit,
    checkFailure,
    failed,
    audit,
    auditLog,
    auditFailure,
    createPair,
    redeem,
    logoutAll,
    logout,
    revokeDevice,
  }
}
export type AuthService = ReturnType<typeof createAuth>
