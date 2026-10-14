import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import {
  generateRegistrationOptions, generateAuthenticationOptions,
  verifyRegistrationResponse, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server'
import type { GymApp } from './app'
import { cookieHeaders, tokenHash, type AuthService, type Session } from './auth'
import { ApiError, json } from './http'
import type { ErrorCode } from '@opengym/contract/http/api'
import { createChallenges, challengeGeneration, invalidateChallenges, type OwnershipProof, type Challenge } from './challenges'
import { getDevice, predecessorDevice } from './storage/devices'
import {
  listAllCreds, listCreds, listUsers, getUser, getInvite, putUser, putCred, putInvite,
  getDeviceLink, putDeviceLink, deleteDeviceLink, pruneDeviceLinks, writeAccountsMirror,
  type CredRow, type UserRow, getMeta, setMeta,
} from './storage'
import {
  MAX_PASSKEYS, listPasskeys, addPasskeyRecord, renamePasskeyRecord,
  passkeyRemovalRefused, removePasskeyRecord, type PasskeyRecord,
} from './passkeys-store'
import { makeLinkCode, hashLinkCode, DEVICE_LINK_TTL_MS } from './device-link'
import { verifyError } from './verify-error'
import { saveAccountsMirror } from './accounts-mirror'

export type PasskeyOptions = {
  mirror?: typeof writeAccountsMirror
  log?: (message: string) => void
  /** Verification seam for deterministic race probes. Production uses the real verifier. */
  webauthn?: Partial<{
    generateRegistrationOptions: typeof generateRegistrationOptions
    generateAuthenticationOptions: typeof generateAuthenticationOptions
    verifyRegistrationResponse: typeof verifyRegistrationResponse
    verifyAuthenticationResponse: typeof verifyAuthenticationResponse
  }>
}
const opaqueId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id)
const text = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
class NotVerified extends Error {}
const expired = () => new ApiError(400, 'challenge expired, try again', { code: 'challenge-expired' })
const invalidLink = () => new ApiError(400, 'that code is wrong, used or expired', { code: 'link-invalid' })
const limit = () => new ApiError(409, `a profile can have at most ${MAX_PASSKEYS} passkeys`, { code: 'passkey-limit' })
const required = (s: Session | null): Session => { if (!s) throw new ApiError(401, 'not signed in'); return s }
const record = (c: CredRow): PasskeyRecord => ({
  id: c.id, userId: c.user_id, publicKey: c.public_key, counter: c.counter,
  transports: JSON.parse(c.transports) as unknown,
  ...(c.created ? { created: c.created } : {}), ...(c.last_used ? { lastUsed: c.last_used } : {}),
  ...(c.name ? { name: c.name } : {}),
})

export function installPasskeys(app: GymApp, auth: AuthService, options: PasskeyOptions = {}): void {
  const { db, config, now } = auth
  const webauthn = { generateRegistrationOptions, generateAuthenticationOptions, verifyRegistrationResponse, verifyAuthenticationResponse, ...options.webauthn }
  const challenges = createChallenges(now)
  const session = (r: Request) => required(auth.sessionOf(r))
  const snapshot = () => ({ creds: listAllCreds(db).map(record) })
  const count = (uid: string) => listCreds(db, uid).length
  const state = (u: UserRow) => {
    const passkeys = listPasskeys(snapshot(), u.id)
    return { passkeys, password: false, lastWayIn: passkeys.length <= 1 }
  }
  const save = () => saveAccountsMirror(db, config.dataDir, options)
  const iso = () => new Date(now()).toISOString()
  const getCred = (id: unknown) => typeof id === 'string' && opaqueId(id) ? db.query<CredRow, [string]>('SELECT * FROM creds WHERE id=?').get(id) : null
  const audit = (r: Request, ev: string, ok: boolean, msg: string | null, u?: UserRow, act?: string, name?: string) => {
    // The audit service only reads the user from this structural session; no token is manufactured.
    const s = u ? { user: u } : undefined
    auth.audit(ev, s, ok, msg, r, undefined, { act, name })
  }
  const auditFail = (r: Request, ev: string, msg: string, u?: UserRow, name?: string) =>
    auth.auditFailure(r, ev, msg, u ? { user: u } : undefined, { name })
  // Refusal audits live outside the mutation transaction: rolling back the mutation must
  // not roll back the evidence that a replay, invite race or cap check was refused.
  function commit<T>(r: Request, ev: string, u: UserRow | undefined, mutate: () => T, name?: string): T {
    try { return db.transaction(mutate).immediate() }
    catch (e) {
      if (e instanceof ApiError) {
        const msg = e.extra.code === 'invite' ? 'invite-invalid'
          : e.extra.code ?? (e.message === 'credential already registered' ? 'credential-exists' : 'mutation-refused')
        audit(r, ev, false, msg, u, undefined, name)
      }
      throw e
    }
  }
  const persistCred = (c: PasskeyRecord, uid: string, lastUsed?: string) => {
    const ord = db.query<{ n: number }, []>('SELECT COALESCE(MAX(ord),-1)+1 AS n FROM creds').get()!.n
    putCred(db, { id: c.id, user_id: uid, public_key: c.publicKey, counter: c.counter || 0,
      transports: JSON.stringify(c.transports || []), created: c.created || iso(), last_used: lastUsed ?? null,
      name: typeof c.name === 'string' ? c.name : null, ord, x: '{}' })
  }
  const add = (c: PasskeyRecord, uid: string, used = false) => {
    const added = addPasskeyRecord(snapshot(), uid, c, now())
    if ('error' in added) throw new ApiError(409, added.error!, { code: added.code! })
    persistCred(added.row, uid, used ? added.row.created : undefined)
    return added.row
  }
  const liveLink = (code: unknown) => {
    pruneDeviceLinks(db, now())
    if (text(code).toUpperCase().replace(/[^A-Z0-9]/g, '').length !== 12) return null
    return getDeviceLink(db, hashLinkCode(code))
  }
  const invite = (code: string) => {
    const i = getInvite(db, code)
    return i && !i.used_by && !i.revoked ? i : null
  }
  const moreOptions = (u: Pick<UserRow, 'id' | 'name'>) => webauthn.generateRegistrationOptions({
    rpName: config.rpName, rpID: config.rpId, userID: new Uint8Array(Buffer.from(u.id)),
    userName: u.name, userDisplayName: u.name, attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: listCreds(db, u.id).map(c => ({ id: c.id, transports: JSON.parse(c.transports) as AuthenticatorTransportFuture[] })),
  })
  async function registration(r: Request, c: Challenge, body: Record<string, unknown>, ev: string, u?: UserRow): Promise<PasskeyRecord> {
    let v
    try {
      v = await webauthn.verifyRegistrationResponse({ response: body.credential as RegistrationResponseJSON,
        expectedChallenge: c.challenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: false })
    } catch (e) {
      if (ev === 'auth.register.fail') auditFail(r, ev, 'verify-error', u, c.kind === 'register' ? c.name : undefined)
      else audit(r, ev, false, 'verify-error', u)
      throw new ApiError(400, verifyError(e, { rpId: config.rpId, origin: config.origin }))
    }
    if (!v.verified || !v.registrationInfo) {
      if (ev === 'auth.register.fail') auditFail(r, ev, 'not-verified', u)
      else audit(r, ev, false, 'not-verified', u)
      throw new ApiError(400, 'not verified')
    }
    const cred = v.registrationInfo.credential
    const response = body.credential as RegistrationResponseJSON
    return { id: cred.id, publicKey: Buffer.from(cred.publicKey).toString('base64url'), counter: cred.counter || 0,
      transports: response?.response?.transports, name: body.name }
  }
  async function assertion(c: Challenge, body: Record<string, unknown>, cred: CredRow): Promise<number> {
    const v = await webauthn.verifyAuthenticationResponse({ response: body.credential as AuthenticationResponseJSON,
      expectedChallenge: c.challenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: false,
      credential: { id: cred.id, publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')), counter: cred.counter,
        transports: JSON.parse(cred.transports) as AuthenticatorTransportFuture[] } })
    if (!v.verified) throw new NotVerified()
    return v.authenticationInfo.newCounter
  }
  // A verifier awaits crypto: compare the still-live credential/counter and session before committing.
  function updateUse(cred: CredRow, counter: number): void {
    if (!db.query('UPDATE creds SET counter=?,last_used=? WHERE id=? AND user_id=? AND counter=? AND public_key=?')
      .run(counter, iso(), cred.id, cred.user_id, cred.counter, cred.public_key).changes)
      throw new ApiError(403, 'the passkey could not be verified', { code: 'passkey' })
  }
  function ownershipLive(p: OwnershipProof): boolean {
    const u = getUser(db, p.uid), cred = getCred(p.credentialId)
    // Authentication atomically transfers a legacy token's device to its authenticated v2
    // successor during renewal. A revoked original row must never use this fallback.
    const successor = p.predecessorHash ? predecessorDevice(db, p.predecessorHash) : null
    const device = getDevice(db, p.deviceId) ?? (successor ? getDevice(db, successor) : null)
    return !!u && !u.disabled && u.sv === p.sv && challengeGeneration(db, p.uid) === p.generation
      && !!cred && cred.user_id === p.uid && cred.public_key === p.publicKey
      && !!device && device.user_id === p.uid && device.sv === p.sv && device.revoked_at === null
  }
  const linkProofKey = (uid: string) => `device_link_proof:${uid}`
  const linkProof = (uid: string, lh: string): OwnershipProof | null => {
    const saved = getMeta(db, linkProofKey(uid))
    if (!saved) return null
    const p = JSON.parse(saved) as { lh: string; ownership: OwnershipProof }
    return p.lh === lh && ownershipLive(p.ownership) ? p.ownership : null
  }
  async function proveOwner(r: Request, body: Record<string, unknown>, act: string): Promise<{ session: Session; ownership: OwnershipProof }> {
    const s = session(r)
    if (!body.credential) {
      throw new ApiError(403, 'confirm with your passkey first', { code: 'passkey-required' })
    }
    const c = challenges.take(body.cid), credential = body.credential as AuthenticationResponseJSON
    const cred = c?.kind === 'login' ? getCred(credential.id) : null
    try {
      if (!c || !cred || cred.user_id !== s.user.id) throw new Error('wrong proof')
      const ownership: OwnershipProof = { uid: s.user.id, sv: s.user.sv, generation: challengeGeneration(db, s.user.id),
        credentialId: cred.id, publicKey: cred.public_key, deviceId: s.device.id,
        ...(s.v2 ? {} : { predecessorHash: tokenHash(s.token) }) }
      const counter = await assertion(c, body, cred)
      db.transaction(() => {
        const current = session(r)
        if (current.user.sv !== s.user.sv) throw new ApiError(401, 'not signed in')
        if (!ownershipLive(ownership)) throw expired()
        updateUse(cred, counter)
      }).immediate()
      save()
      return { session: session(r), ownership }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e
      audit(r, 'auth.proof.fail', false, 'step-up-failed', s.user, act)
      throw new ApiError(403, 'the passkey could not be verified', { code: 'passkey' })
    }
  }
  const signedIn = (u: UserRow) => {
    const token = auth.mint(u, 'browser')
    const response = json(200, { user: auth.publicUser(u) })
    for (const c of cookieHeaders(config, token).getSetCookie()) response.headers.append('Set-Cookie', c)
    return response
  }
  const setupProof = (code: string) => !!config.setupToken && !getMeta(db, 'setup_token_used') && listUsers(db).length === 0
    && timingSafeEqual(createHash('sha256').update(code).digest(), createHash('sha256').update(config.setupToken).digest())
  app.post('/api/register/options', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw
    const name = text(body.name).trim().slice(0, 40), code = text(body.code).trim().toUpperCase()
    if (!name) throw new ApiError(400, 'name required')
    if (config.inviteOnly && !invite(code) && !setupProof(code)) {
      audit(r, 'auth.register.denied', false, 'invite-rejected', undefined, undefined, name)
      throw new ApiError(403, 'a valid invite code is required', { code: 'invite' })
    }
    const uid = randomBytes(12).toString('base64url')
    const options = await moreOptions({ id: uid, name })
    const cid = challenges.put({ kind: 'register', challenge: options.challenge, name, uid, code })
    return json(200, { cid, options })
  })
  app.post('/api/register/verify', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw, ch = challenges.take(body.cid)
    if (!ch || ch.kind !== 'register') { auditFail(r, 'auth.register.fail', 'challenge-expired'); throw expired() }
    const cred = await registration(r, ch, body, 'auth.register.fail')
    const result = commit(r, 'auth.register.fail', undefined, () => {
      if (getCred(cred.id)) throw new ApiError(409, 'credential already registered')
      const setup = setupProof(ch.code)
      const i = config.inviteOnly ? invite(ch.code) : null
      if (config.inviteOnly && !i && !setup) throw new ApiError(403, 'invite code is no longer valid, ask for a new one', { code: 'invite' })
      const users = listUsers(db), created = iso()
      const u: UserRow = { id: ch.uid, name: ch.name, created, admin: setup || config.firstUserAdmin && users.length === 0 ? 1 : 0,
        disabled: 0, sv: 0, invited_by: i?.code ?? null, last_pull: null, last_reminder: null, last_nudge: null,
        ord: users.reduce((n,u) => Math.max(n,u.ord+1),0), x: '{}' }
      putUser(db, u)
      if (setup) setMeta(db, 'setup_token_used', u.id)
      if (i) putInvite(db, { ...i, used_by: u.id, used_at: created })
      // Registration keeps legacy's supplied transports and no Settings label.
      persistCred({ ...cred, name: undefined, created }, u.id, created)
      if (u.admin) audit(r, 'admin.first-user', true, null, u)
      return { u, response: signedIn(u) }
    }, ch.name)
    save(); audit(r, 'auth.register.ok', true, result.u.invited_by, result.u)
    return result.response
  })
  app.post('/api/login/options', async () => {
    const options = await webauthn.generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'preferred', allowCredentials: [] })
    const cid = challenges.put({ kind: 'login', challenge: options.challenge })
    return json(200, { cid, options })
  })
  app.post('/api/login/verify', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw, ch = challenges.take(body.cid)
    if (!ch || ch.kind !== 'login') { auditFail(r, 'auth.login.fail', 'challenge-expired'); throw expired() }
    const cred = getCred((body.credential as AuthenticationResponseJSON | undefined)?.id)
    if (!cred) { auditFail(r, 'auth.login.fail', 'unknown-credential'); throw new ApiError(404, 'unknown passkey, create a profile first', { code: 'unknown-credential' }) }
    let counter
    try { counter = await assertion(ch, body, cred) } catch (e) {
      auditFail(r, 'auth.login.fail', e instanceof NotVerified ? 'not-verified' : 'verify-error', getUser(db, cred.user_id) ?? undefined)
      throw new ApiError(400, e instanceof NotVerified ? 'not verified' : verifyError(e, { rpId: config.rpId, origin: config.origin }))
    }
    const result = db.transaction(() => {
      const u = getUser(db, cred.user_id)
      if (!u) throw new ApiError(500, 'user missing')
      updateUse(cred, counter)
      if (u.disabled) return { u, response: json(403, { error: 'this account has been disabled', code: 'disabled' }) }
      return { u, response: signedIn(u) }
    }).immediate()
    save(); audit(r, result.u.disabled ? 'auth.login.fail' : 'auth.login.ok', !result.u.disabled, result.u.disabled ? 'account-disabled' : null, result.u)
    return result.response
  })
  app.get('/api/account/passkeys', c => json(200, state(session(c.req.raw).user)))
  app.post('/api/account/passkeys/options', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw, s = session(r)
    if (count(s.user.id) >= MAX_PASSKEYS) throw limit()
    const proved = await proveOwner(r, body, 'passkey-add')
    const options = await moreOptions(proved.session.user), current = session(r)
    if (!ownershipLive(proved.ownership)) throw expired()
    const cid = challenges.put({ kind: 'add', challenge: options.challenge, uid: current.user.id, ownership: proved.ownership, proof: 'passkey' })
    return json(200, { cid, options })
  })
  app.post('/api/account/passkeys/verify', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw, s = session(r), ch = challenges.take(text(body.cid))
    if (!ch || ch.kind !== 'add' || ch.uid !== s.user.id) { audit(r, 'auth.passkey.fail', false, 'challenge-expired', s.user); throw expired() }
    const cred = await registration(r, ch, body, 'auth.passkey.fail', s.user)
    commit(r, 'auth.passkey.fail', s.user, () => {
      const current = session(r)
      if (current.user.sv !== ch.ownership.sv) throw new ApiError(401, 'not signed in')
      if (!ownershipLive(ch.ownership)) throw expired()
      add(cred, current.user.id)
    })
    save(); audit(r, 'auth.passkey.add', true, ch.proof, s.user)
    return json(200, { ok: true, ...state(s.user) })
  })
  app.post('/api/account/passkeys/rename', async c => {
    const body = await c.get('body').readJson(), s = session(c.req.raw)
    if (!opaqueId(text(body.id))) throw new ApiError(404, 'passkey not found', { code: 'not-found' })
    const renamed = renamePasskeyRecord(snapshot(), s.user.id, text(body.id), body.name)
    if ('error' in renamed) throw new ApiError(404, renamed.error!, { code: renamed.code! })
    db.query('UPDATE creds SET name=? WHERE id=? AND user_id=?').run(renamed.row.name ? String(renamed.row.name) : null, renamed.row.id, s.user.id)
    save(); return json(200, { ok: true, ...state(s.user) })
  })
  app.delete('/api/account/passkeys', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw, s = session(r), id = new URL(r.url).searchParams.get('id') || ''
    if (!opaqueId(id)) throw new ApiError(404, 'passkey not found', { code: 'not-found' })
    const refuse = (e: {error: string; code: ErrorCode}) => { throw new ApiError(e.code === 'last-way-in' ? 409 : 404, e.error, { code: e.code }) }
    const refused = passkeyRemovalRefused(snapshot(), s.user.id, id)
    if (refused) return refuse(refused)
    await proveOwner(r, body, 'passkey-remove')
    const removed = db.transaction(() => {
      session(r)
      const result = removePasskeyRecord(snapshot(), s.user.id, id)
      if ('error' in result) return refuse(result)
      db.query('DELETE FROM creds WHERE id=? AND user_id=?').run(id, s.user.id)
      invalidateChallenges(db, s.user.id)
      db.query('DELETE FROM device_links WHERE user_id=?').run(s.user.id)
      return result.row
    }).immediate()
    save(); audit(r, 'auth.passkey.remove', true, typeof removed.name === 'string' ? removed.name : null, s.user)
    return json(200, { ok: true, ...state(s.user) })
  })
  app.post('/api/account/device-link', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw, s = session(r)
    if (count(s.user.id) >= MAX_PASSKEYS) throw limit()
    const proved = await proveOwner(r, body, 'device-link')
    const code = makeLinkCode(), expires = now() + DEVICE_LINK_TTL_MS
    db.transaction(() => {
      session(r); pruneDeviceLinks(db, now())
      if (!ownershipLive(proved.ownership)) throw expired()
      const uid = proved.session.user.id, lh = hashLinkCode(code)
      db.query('DELETE FROM device_links WHERE user_id=?').run(uid)
      putDeviceLink(db, { h: lh, user_id: uid, exp: expires, created: now() })
      setMeta(db, linkProofKey(uid), JSON.stringify({ lh, ownership: proved.ownership }))
    }).immediate()
    save(); audit(r, 'auth.link.create', true, 'passkey', proved.session.user)
    return json(200, { code, expires })
  })
  app.post('/api/device-link/options', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw
    auth.checkFailure(r, 'link')
    const link = liveLink(text(body.code))
    if (!link) { auth.failed(r, 'link'); audit(r, 'auth.link.fail', false, 'link-invalid'); throw invalidLink() }
    const u = getUser(db, link.user_id)
    if (!u || u.disabled) { auth.audit('auth.link.fail', undefined, false, 'user-unavailable', r, link.user_id); throw invalidLink() }
    if (count(u.id) >= MAX_PASSKEYS) throw limit()
    const ownership = linkProof(u.id, link.h)
    if (!ownership) throw invalidLink()
    const options = await moreOptions(u)
    if (!ownershipLive(ownership)) throw invalidLink()
    const cid = challenges.put({ kind: 'link', challenge: options.challenge, uid: u.id, lh: link.h, ownership })
    return json(200, { cid, options, id: u.id, name: u.name })
  })
  app.post('/api/device-link/verify', async c => {
    const body = await c.get('body').readJson(), r = c.req.raw
    auth.checkFailure(r, 'link')
    const code = text(body.code), ch = challenges.take(text(body.cid)), link = liveLink(code)
    if (!link) { auth.failed(r, 'link'); audit(r, 'auth.link.fail', false, 'link-invalid'); throw invalidLink() }
    if (!ch || ch.kind !== 'link' || ch.lh !== link.h || ch.uid !== link.user_id) {
      auth.audit('auth.link.fail', undefined, false, 'challenge-expired', r, link.user_id); throw expired()
    }
    const cred = await registration(r, ch, body, 'auth.link.fail', getUser(db, link.user_id) ?? undefined)
    const result = commit(r, 'auth.link.fail', getUser(db, link.user_id) ?? undefined, () => {
      const latest = liveLink(code), u = getUser(db, link.user_id)
      if (!latest || latest.h !== link.h || !u || u.disabled) throw invalidLink()
      if (!ownershipLive(ch.ownership)) throw invalidLink()
      const added = add(cred, u.id, true); deleteDeviceLink(db, link.h)
      return { u, added, response: signedIn(u) }
    })
    save(); audit(r, 'auth.link.ok', true, typeof result.added.name === 'string' ? result.added.name : null, result.u)
    return result.response
  })
}
