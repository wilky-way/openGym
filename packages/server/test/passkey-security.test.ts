import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createChallenges, CHALLENGE_TTL_MS } from '../src/challenges'
import { getInvite, putInvite, getUser } from '../src/storage'
import { CLOCK } from './auth-helpers'
import { startServer, softPasskey, user, mintSession, makeLink, ORIGIN } from './passkey-helpers'

test('challenge TTL, one-shot consumption and oldest eviction are deterministic', () => {
  let now = CLOCK
  const c = createChallenges(() => now, 2)
  const a = c.put({ kind: 'login', challenge: 'a' })
  const b = c.put({ kind: 'login', challenge: 'b' })
  c.put({ kind: 'register', challenge: 'c', uid: 'synthetic', name: 'Synthetic', code: '' })
  assert.equal(c.take(a), null)
  now += CHALLENGE_TTL_MS
  assert.equal(c.take(b)?.challenge, 'b') // legacy includes exact expiry instant
  assert.equal(c.take(b), null)
  const d = c.put({ kind: 'login', challenge: 'd' })
  now += CHALLENGE_TTL_MS + 1
  assert.equal(c.take(d), null)
  assert.equal(c.take({ toString: () => d }), null)
})

async function options(h: Awaited<ReturnType<typeof startServer>>, code = 'INVITE', name: unknown = 'New profile') {
  return h.req('POST', '/api/register/options', { body: { name, code } })
}
const verify = (h: Awaited<ReturnType<typeof startServer>>, o: any, key = softPasskey()) =>
  h.req('POST', '/api/register/verify', { body: { cid: o.cid, credential: key.attestation(o.options.challenge) } })

test('invite-only registration rechecks revocation and use, burns exactly once, and records ownership', async () => {
  const h = await startServer(undefined, { env: { INVITE_ONLY: '1' }, invites: [{ code: 'INVITE' }] })
  assert.equal((await options(h, 'WRONG')).body.code, 'invite')
  const a = (await options(h)).body, b = (await options(h)).body
  const [one, two] = await Promise.all([verify(h, a), verify(h, b)])
  assert.deepEqual([one.status, two.status].sort(), [200, 403])
  const winner = [one,two].find(r => r.status === 200)!
  assert.equal(getInvite(h.sql, 'INVITE')!.used_by, winner.body.user.id)
  assert.equal(getUser(h.sql, winner.body.user.id)!.invited_by, 'INVITE')
  assert.equal(h.db().users.length, 1)
  assert.equal(h.db().creds.length, 1)
  assert.equal((await options(h)).status, 403)
  putInvite(h.sql, { ...getInvite(h.sql, 'INVITE')!, used_by: null })
  const revoked = (await options(h)).body
  putInvite(h.sql, { ...getInvite(h.sql, 'INVITE')!, revoked: 1 })
  assert.equal((await verify(h, revoked)).body.code, 'invite')
  assert.equal(h.db().users.length, 1)
  assert.ok(h.audit().some(e => e.ev === 'auth.register.fail' && e.msg === 'invite-invalid'))
})

test('concurrent first-user registrations promote exactly one; public exposure forces invite-only', async () => {
  const h = await startServer(undefined, { env: { FIRST_USER_ADMIN: '1' } })
  const a = (await options(h)).body, b = (await options(h)).body
  const results = await Promise.all([verify(h,a), verify(h,b)])
  assert.deepEqual(results.map(r => r.status), [200,200])
  assert.equal(results.filter(r => r.body.user.admin).length, 1)
  assert.equal(h.db().users.filter(u => u.admin).length, 1)
  const publicServer = await startServer(undefined, { env: { EXPOSURE: 'public', ORIGIN: 'https://localhost:8080', DEVICE_TOKENS: '1' } })
  assert.equal((await options(publicServer)).status, 403)
  for (let n=1; n<30; n++) assert.equal((await options(publicServer)).status, 403)
  assert.equal((await options(publicServer)).status, 429)
})

test('opaque credential identifiers reject encoded slash, dot-dot and backslash on the wire', async () => {
  const key = softPasskey(), spare = softPasskey()
  const h = await startServer(undefined, { users: [user('u1','Synthetic')], creds: [key.row('u1'),spare.row('u1')] })
  for (const id of ['a%2Fb','%2e%2e%2F','a%5Cb','a/b','../','a\\b','a%252Fb']) {
    const query = id.includes('%') ? id : encodeURIComponent(id)
    assert.equal((await h.req('DELETE','/api/account/passkeys?id='+query,{cookie:mintSession('u1'),body:{}})).status,404)
    assert.equal((await h.req('POST','/api/account/passkeys/rename',{cookie:mintSession('u1'),body:{id,name:'untrusted'}})).status,404)
  }
  assert.deepEqual(h.db().creds.map(c=>c.id), [key.id,spare.id])
  assert.equal((await h.req('POST','/api/register/options',{body:{name:{toString:1},code:{toString:1}}})).status,400)
  assert.equal((await h.req('POST','/api/register/options',{body:{name:42,code:{toString:1}}})).status,200)
  assert.equal((await h.req('POST','/api/register/verify',{body:{cid:{toString:1},credential:{id:[]}}})).status,400)
  const missingCid = await h.req('POST','/api/account/passkeys/options',{cookie:mintSession('u1'),body:{credential:{id:key.id}}})
  assert.equal(missingCid.status,403)
  assert.equal(missingCid.body.code,'passkey')
  assert.ok(h.audit().some(e=>e.ev==='auth.proof.fail' && e.msg==='step-up-failed'))
  assert.equal((await h.req('POST','/api/login/verify',{body:{cid:[],credential:{id:{toString:1}}}})).status,400)
})

test('real authenticator rejects wrong RP, origin, challenge, signature, user-presence and replayed counters', async () => {
  const key = softPasskey('S13-counter-replay')
  const h = await startServer(undefined, {users:[user('u1','Synthetic')],creds:[key.row('u1')]})
  for (const extra of [{origin:'https://evil.example'}, {rpId:'evil.example'}, {flags:0}]) {
    const o = (await h.req('POST','/api/login/options')).body
    assert.equal((await h.req('POST','/api/login/verify',{body:{cid:o.cid,credential:key.assertion(o.options.challenge,extra)}})).status,400)
  }
  let o = (await h.req('POST','/api/login/options')).body
  assert.equal((await h.req('POST','/api/login/verify',{body:{cid:o.cid,credential:key.assertion('not-the-challenge')}})).status,400)
  o = (await h.req('POST','/api/login/options')).body
  const bad = key.assertion(o.options.challenge)
  const bytes = Buffer.from(bad.response.signature, 'base64url'); bytes[bytes.length-1]! ^= 1
  const tampered = {...bad,response:{...bad.response,signature:bytes.toString('base64url')}}
  const invalid = await h.req('POST','/api/login/verify',{body:{cid:o.cid,credential:tampered}})
  assert.equal(invalid.status,400)
  assert.equal(invalid.body.error,'not verified')
  assert.ok(h.audit().some(e=>e.ev==='auth.login.fail' && e.msg==='not-verified'))
  o = (await h.req('POST','/api/login/options')).body
  const signed = key.assertion(o.options.challenge)
  assert.equal((await h.req('POST','/api/login/verify',{body:{cid:o.cid,credential:signed}})).status,200)
  assert.equal((await h.req('POST','/api/login/verify',{body:{cid:o.cid,credential:signed}})).status,400)
  // A zero counter on a backed-up authenticator is supported by SimpleWebAuthn; counters are compared where nonzero.
  assert.equal(h.db().creds[0].counter,6)
  const resetKey = softPasskey('S13-counter-replay')
  const next = (await h.req('POST','/api/login/options')).body
  assert.equal((await h.req('POST','/api/login/verify',{body:{cid:next.cid,credential:resetKey.assertion(next.options.challenge)}})).status,400)
  assert.equal(h.db().creds[0].counter,6)
})

test('device-link TTL exact boundary refuses redemption and leaves credential material unchanged', async () => {
  const key = softPasskey()
  const h = await startServer(undefined,{users:[user('u1','Synthetic')],creds:[key.row('u1')]})
  const {code,expires} = (await makeLink(h,key,'u1','198.51.100.1')).body
  h.clock.t = expires
  assert.equal((await h.req('POST','/api/device-link/options',{body:{code}})).body.code,'link-invalid')
  assert.equal(h.db().creds.length,1)
  assert.equal(h.db().deviceLinks.length,0)
})
