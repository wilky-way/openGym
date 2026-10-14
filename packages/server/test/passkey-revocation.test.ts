import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { verifyRegistrationResponse, generateRegistrationOptions } from '@simplewebauthn/server'
import { getUser } from '../src/storage'
import { challengeGeneration } from '../src/challenges'
import { startServer, softPasskey, user, mintSession } from './passkey-helpers'

function pause() {
  let resume!: () => void, entered!: () => void
  const held = new Promise<void>(resolve => resume = resolve)
  const started = new Promise<void>(resolve => entered = resolve)
  return { held, started, resume, entered }
}
const modes = ['add', 'link'] as const
type Mode = typeof modes[number]
async function fixture(passkeys = {}) {
  const owner = softPasskey(), stolen = softPasskey(), unrelated = softPasskey(), attacker = softPasskey()
  const h = await startServer(undefined, { env: { DEVICE_TOKENS: '1' },
    users: [user('u1', 'Synthetic')], creds: [owner.row('u1'), stolen.row('u1'), unrelated.row('u1')], passkeys })
  const u = getUser(h.sql, 'u1')!
  const victimToken = h.auth.mint(u), ownerCookie = 'gymsid=' + h.auth.mint(u)
  const unrelatedToken = h.auth.mint(u)
  return { h, owner, stolen, unrelated, attacker, victimCookie: 'gymsid=' + victimToken, ownerCookie,
    victimId: victimToken.split('.')[1]!, unrelatedId: unrelatedToken.split('.')[1]! }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function pending(f: Fixture, mode: Mode) {
  const { h, stolen, victimCookie, attacker } = f
  const proof = await h.stepUp(stolen)
  let code: string | undefined
  const start = await h.req('POST', mode === 'add' ? '/api/account/passkeys/options' : '/api/account/device-link',
    { cookie: victimCookie, body: proof })
  assert.equal(start.status, 200)
  let options = start
  if (mode === 'link') {
    code = start.body.code
    options = await h.req('POST', '/api/device-link/options', { body: { code } })
    assert.equal(options.status, 200)
  }
  const body = { cid: options.body.cid, code, credential: attacker.attestation(options.body.options.challenge) }
  const complete = (cookie = victimCookie) => h.req('POST',
    mode === 'add' ? '/api/account/passkeys/verify' : '/api/device-link/verify', { cookie: mode === 'add' ? cookie : undefined, body })
  return { complete, code }
}
async function noAttackerLogin(f: Fixture) {
  assert.equal(f.h.db().creds.some(c => c.id === f.attacker.id), false)
  const options = (await f.h.req('POST', '/api/login/options', { body: {} })).body
  const login = await f.h.req('POST', '/api/login/verify', { body: { cid: options.cid, credential: f.attacker.assertion(options.options.challenge) } })
  assert.equal(login.status, 404)
  assert.equal(login.body.code, 'unknown-credential')
  assert.equal(login.cookie, null)
}

for (const mode of modes) {
  for (const revokeSuccessor of [false, true]) {
    test(`${mode} follows normal v1-to-v2 renewal and ${revokeSuccessor ? 'refuses a revoked successor' : 'completes with its live successor'}`, async () => {
      const key = softPasskey(), fresh = softPasskey()
      const h = await startServer(undefined, { env: { DEVICE_TOKENS: '1', SESSION_DAYS: '10' },
        users: [user('u1', 'Synthetic')], creds: [key.row('u1')] })
      const cookie = mintSession('u1'), token = cookie.slice('gymsid='.length)
      const start = await h.req('POST', mode === 'add' ? '/api/account/passkeys/options' : '/api/account/device-link',
        { cookie, body: await h.stepUp(key) })
      assert.equal(start.status, 200)
      const code = mode === 'link' ? start.body.code : undefined
      const options = mode === 'add' ? start : await h.req('POST', '/api/device-link/options', { body: { code } })
      assert.equal(options.status, 200)
      const original = (await h.req('GET', '/api/account/devices', { cookie })).body.current
      const renewed = await h.req('GET', '/api/me', { headers: { Authorization: 'Bearer ' + token } })
      assert.equal(renewed.status, 200)
      assert.ok(renewed.body.token?.startsWith('v2.'))
      assert.equal(h.sql.query('SELECT id FROM devices WHERE id=?').get(original), null)
      const successor = (await h.req('GET', '/api/account/devices', { cookie })).body.current
      assert.notEqual(successor, original)
      if (revokeSuccessor) {
        // Raw revocation isolates the provenance check from generation invalidation.
        h.sql.query('UPDATE devices SET revoked_at=? WHERE id=?').run(h.clock.t, successor)
      }
      const result = await h.req('POST', mode === 'add' ? '/api/account/passkeys/verify' : '/api/device-link/verify',
        { cookie: mode === 'add' ? cookie : undefined, body: { code, cid: options.body.cid, credential: fresh.attestation(options.body.options.challenge) } })
      assert.equal(result.status, revokeSuccessor ? (mode === 'add' ? 401 : 400) : 200)
      assert.equal(h.db().creds.some(c => c.id === fresh.id), !revokeSuccessor)
      if (revokeSuccessor) assert.equal(result.cookie, null)
    })
  }

  test(`default v1 session cannot finish ${mode} after passkey removal or ordinary logout`, async () => {
    for (const trigger of ['remove', 'logout'] as const) {
      const owner = softPasskey(), stolen = softPasskey(), attacker = softPasskey()
      const h = await startServer(undefined, { users: [user('u1', 'Synthetic')], creds: [owner.row('u1'), stolen.row('u1')] })
      const cookie = mintSession('u1'), proof = await h.stepUp(stolen)
      const start = await h.req('POST', mode === 'add' ? '/api/account/passkeys/options' : '/api/account/device-link', { cookie, body: proof })
      assert.equal(start.status, 200)
      const code = mode === 'link' ? start.body.code : undefined
      const options = mode === 'add' ? start : await h.req('POST', '/api/device-link/options', { body: { code } })
      assert.equal(options.status, 200)
      const before = challengeGeneration(h.sql, 'u1')
      const revoke = trigger === 'remove'
        ? await h.req('DELETE', '/api/account/passkeys?id=' + stolen.id, { cookie, body: await h.stepUp(owner) })
        : await h.req('POST', '/api/logout', { cookie, body: {} })
      assert.equal(revoke.status, 200)
      assert.equal(challengeGeneration(h.sql, 'u1'), before + 1)
      assert.equal((await h.req('GET', '/api/me', { cookie })).status, 200)
      const complete = await h.req('POST', mode === 'add' ? '/api/account/passkeys/verify' : '/api/device-link/verify',
        { cookie: mode === 'add' ? cookie : undefined, body: { cid: options.body.cid, code, credential: attacker.attestation(options.body.options.challenge) } })
      assert.equal(complete.status, 400)
      assert.equal(complete.cookie, null)
      assert.equal(h.db().creds.some(c => c.id === attacker.id), false)
      const loginOptions = (await h.req('POST', '/api/login/options', { body: {} })).body
      assert.equal((await h.req('POST', '/api/login/verify', { body: { cid: loginOptions.cid, credential: attacker.assertion(loginOptions.options.challenge) } })).status, 404)
    }
  })

  test(`stolen signed-in device cannot finish pending ${mode} after owner deletes its passkey or log in with the new key`, async () => {
    const f = await fixture(), p = await pending(f, mode)
    assert.equal((await f.h.req('DELETE', '/api/account/passkeys?id=' + f.stolen.id,
      { cookie: f.ownerCookie, body: await f.h.stepUp(f.owner) })).status, 200)
    // Removing a passkey does not log out the stolen device; invalidation must stand on its own.
    assert.equal((await f.h.req('GET', '/api/me', { cookie: f.victimCookie })).status, 200)
    const result = await p.complete()
    assert.equal(result.status, 400)
    assert.equal(result.cookie, null)
    assert.notEqual((await p.complete()).status, 200)
    await noAttackerLogin(f)
  })

  for (const trigger of ['remove-other-key', 'revoke-other-device', 'revoke-proving-device', 'logout', 'logout-all'] as const) {
    for (const timing of ['before-verify', 'during-verify'] as const) {
      test(`${mode} invalidated by ${trigger} ${timing}`, async () => {
        const gate = pause()
        const f = await fixture({ webauthn: { verifyRegistrationResponse: async (o: Parameters<typeof verifyRegistrationResponse>[0]) => {
          const v = await verifyRegistrationResponse(o)
          if (timing === 'during-verify') { gate.entered(); await gate.held }
          return v
        } } })
        const p = await pending(f, mode), before = challengeGeneration(f.h.sql, 'u1')
        const verifying = timing === 'during-verify' ? p.complete() : null
        if (verifying) await gate.started
        let revoked
        if (trigger === 'remove-other-key') revoked = await f.h.req('DELETE', '/api/account/passkeys?id=' + f.unrelated.id,
          { cookie: f.ownerCookie, body: await f.h.stepUp(f.owner) })
        else if (trigger.startsWith('revoke-')) revoked = await f.h.req('POST', '/api/account/devices/revoke',
          { cookie: f.ownerCookie, body: { id: trigger === 'revoke-other-device' ? f.unrelatedId : f.victimId } })
        else revoked = await f.h.req('POST', trigger === 'logout' ? '/api/logout' : '/api/logout/all',
          { cookie: f.ownerCookie, body: {} })
        assert.equal(revoked.status, 200)
        assert.equal(challengeGeneration(f.h.sql, 'u1'), before + 1)
        // Use a surviving or fresh owner session so cookie revocation cannot mask a stale challenge.
        const validCookie = 'gymsid=' + f.h.auth.mint(getUser(f.h.sql, 'u1')!)
        gate.resume()
        const result = verifying ? await verifying : await p.complete(validCookie)
        const staleSession = mode === 'add' && (trigger === 'logout-all' || (timing === 'during-verify' && trigger === 'revoke-proving-device'))
        assert.equal(result.status, staleSession ? 401 : 400)
        assert.equal(result.cookie, null)
        assert.notEqual((await p.complete(validCookie)).status, 200)
        if (mode === 'link') assert.equal((await f.h.req('POST', '/api/device-link/options', { body: { code: p.code } })).status, 400)
        await noAttackerLogin(f)
      })
    }
  }

  for (const mutation of ['delete-credential', 'delete-device', 'revoke-device'] as const) {
    test(`${mode} re-checks ${mutation} at completion even without a generation bump`, async () => {
      const gate = pause()
      const f = await fixture({ webauthn: { verifyRegistrationResponse: async (o: Parameters<typeof verifyRegistrationResponse>[0]) => {
        const v = await verifyRegistrationResponse(o); gate.entered(); await gate.held; return v
      } } })
      const p = await pending(f, mode), before = challengeGeneration(f.h.sql, 'u1'), verifying = p.complete()
      await gate.started
      if (mutation === 'delete-credential') f.h.sql.query('DELETE FROM creds WHERE id=?').run(f.stolen.id)
      else if (mutation === 'delete-device') f.h.sql.query('DELETE FROM devices WHERE id=?').run(f.victimId)
      else f.h.sql.query('UPDATE devices SET revoked_at=? WHERE id=?').run(f.h.clock.t, f.victimId)
      assert.equal(challengeGeneration(f.h.sql, 'u1'), before)
      gate.resume()
      const result = await verifying
      assert.equal(result.status, mode === 'add' && mutation !== 'delete-credential' ? 401 : 400)
      assert.equal(result.cookie, null)
      await noAttackerLogin(f)
    })
  }

  test(`${mode} cannot issue an options challenge across removal while generating options`, async () => {
    const gate = pause()
    const f = await fixture({ webauthn: { generateRegistrationOptions: async (o: Parameters<typeof generateRegistrationOptions>[0]) => {
      const v = await generateRegistrationOptions(o); gate.entered(); await gate.held; return v
    } } })
    const proof = await f.h.stepUp(f.stolen)
    let code: string | undefined
    if (mode === 'link') code = (await f.h.req('POST', '/api/account/device-link', { cookie: f.victimCookie, body: proof })).body.code
    const options = f.h.req('POST', mode === 'add' ? '/api/account/passkeys/options' : '/api/device-link/options',
      { cookie: f.victimCookie, body: mode === 'add' ? proof : { code } })
    await gate.started
    assert.equal((await f.h.req('DELETE', '/api/account/passkeys?id=' + f.unrelated.id,
      { cookie: f.ownerCookie, body: await f.h.stepUp(f.owner) })).status, 200)
    gate.resume()
    assert.equal((await options).status, 400)
  })
}

test('revocation for another user leaves pending enrollment valid; current generation permits new enrollment', async () => {
  const f = await fixture(), p = await pending(f, 'add')
  const second = user('u2', 'Other synthetic')
  // HTTP registration creates an unrelated account and device.
  const key = softPasskey(), options = (await f.h.req('POST', '/api/register/options', { body: { name: second.name } })).body
  const registered = await f.h.req('POST', '/api/register/verify', { body: { cid: options.cid, credential: key.attestation(options.options.challenge) } })
  assert.equal(registered.status, 200)
  assert.equal((await f.h.req('POST', '/api/logout/all', { cookie: registered.cookie, body: {} })).status, 200)
  assert.equal((await p.complete()).status, 200)
  assert.equal((await f.h.req('POST', '/api/account/devices/revoke', { cookie: f.ownerCookie, body: { id: f.unrelatedId } })).status, 200)
  const fresh = softPasskey(), addOptions = await f.h.req('POST', '/api/account/passkeys/options', { cookie: f.ownerCookie, body: await f.h.stepUp(f.owner) })
  assert.equal((await f.h.req('POST', '/api/account/passkeys/verify', { cookie: f.ownerCookie,
    body: { cid: addOptions.body.cid, credential: fresh.attestation(addOptions.body.options.challenge) } })).status, 200)
  const link = await f.h.req('POST', '/api/account/device-link', { cookie: f.ownerCookie, body: await f.h.stepUp(f.owner) })
  assert.equal(link.status, 200)
  const linkOptions = await f.h.req('POST', '/api/device-link/options', { body: { code: link.body.code } })
  const linked = await f.h.req('POST', '/api/device-link/verify', { body: { code: link.body.code, cid: linkOptions.body.cid,
    credential: softPasskey().attestation(linkOptions.body.options.challenge) } })
  assert.equal(linked.status, 200)
  assert.ok(linked.cookie)
})
