import { test, expect } from 'bun:test'
import { authServer, bearer, cookie, mint } from './auth-helpers'
import { getMeta, getUser, putDeviceLink, listAudit, writeAccountsMirror } from '../src/storage'
import { listDevices } from '../src/storage/devices'
import { challengeGeneration } from '../src/challenges'
import { startServer, softPasskey, user } from './passkey-helpers'

for (const trigger of ['revoke', 'logout'] as const) {
  test(`stolen v2 device cannot redeem its saved pairing after ${trigger}`, async () => {
    const h = authServer({ DEVICE_TOKENS: '1' }), u = getUser(h.db, 'u_phone')!
    const stolen = h.auth.mint(u), owner = h.auth.mint(u), did = stolen.split('.')[1]!
    const created = await h.post('/api/pair/create', bearer(stolen))
    expect(created.status).toBe(200)
    const { code } = await created.json(), before = challengeGeneration(h.db, u.id)
    const revocation = trigger === 'revoke'
      ? await h.post('/api/account/devices/revoke', bearer(owner), { id: did })
      : await h.post('/api/logout', bearer(stolen))
    expect(revocation.status).toBe(200)
    expect((await h.me(bearer(stolen))).status).toBe(401)
    expect((await h.me(bearer(owner))).status).toBe(200)
    expect(challengeGeneration(h.db, u.id)).toBe(before + 1)
    const count = listDevices(h.db, u.id).length
    const redeemed = await h.post('/api/pair/redeem', {}, { code })
    expect(redeemed.status).toBe(400)
    expect(await redeemed.json()).toEqual({ error: 'invalid or expired code', code: 'pair-invalid' })
    expect(redeemed.headers.getSetCookie()).toHaveLength(0)
    expect(listDevices(h.db, u.id)).toHaveLength(count)
    expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
  })

  test(`${trigger} removes that device's saved link and cannot create a new passkey or session`, async () => {
    const key = softPasskey(), attacker = softPasskey()
    const h = await startServer(undefined, { env: { DEVICE_TOKENS: '1' }, users: [user('u1', 'Synthetic')], creds: [key.row('u1')] })
    const u = getUser(h.sql, 'u1')!, stolen = h.auth.mint(u), owner = h.auth.mint(u)
    const created = await h.req('POST', '/api/account/device-link', { cookie: 'gymsid=' + stolen, body: await h.stepUp(key) })
    expect(created.status).toBe(200)
    const { code } = created.body
    const options = await h.req('POST', '/api/device-link/options', { body: { code } })
    expect(options.status).toBe(200)
    expect(h.db().deviceLinks).toHaveLength(1)
    const revoked = await h.req('POST', trigger === 'revoke' ? '/api/account/devices/revoke' : '/api/logout',
      { cookie: 'gymsid=' + (trigger === 'revoke' ? owner : stolen), body: trigger === 'revoke' ? { id: stolen.split('.')[1] } : {} })
    expect(revoked.status).toBe(200)
    expect(h.db().deviceLinks).toHaveLength(0)
    expect(getMeta(h.sql, 'device_link_proof:u1')).toBeNull()
    expect((await h.req('POST', '/api/device-link/options', { body: { code } })).status).toBe(400)
    const verified = await h.req('POST', '/api/device-link/verify', { body: { code, cid: options.body.cid,
      credential: attacker.attestation(options.body.options.challenge) } })
    expect(verified.status).toBe(400)
    expect(verified.cookie).toBeNull()
    expect(h.db().creds.map(c => c.id)).toEqual([key.id])
  })

  test(`${trigger} preserves pairing initiated by a different live device`, async () => {
    const h = authServer({ DEVICE_TOKENS: '1' }), u = getUser(h.db, 'u_phone')!
    const initiator = h.auth.mint(u), other = h.auth.mint(u)
    const { code } = await (await h.post('/api/pair/create', bearer(initiator))).json()
    const revoked = trigger === 'revoke'
      ? await h.post('/api/account/devices/revoke', bearer(initiator), { id: other.split('.')[1] })
      : await h.post('/api/logout', bearer(other))
    expect(revoked.status).toBe(200)
    const redeemed = await h.post('/api/pair/redeem', {}, { code })
    expect(redeemed.status).toBe(200)
    expect((await h.me(bearer((await redeemed.json()).token))).status).toBe(200)
  })
}

for (const mutation of ['missing', 'revoked', 'wrong-owner', 'wrong-sv'] as const) {
  test(`pairing re-checks a ${mutation} initiating device at redemption without generation invalidation`, async () => {
    const h = authServer({ DEVICE_TOKENS: '1' }), u = getUser(h.db, 'u_phone')!
    const token = h.auth.mint(u), did = token.split('.')[1]!
    const { code } = await (await h.post('/api/pair/create', bearer(token))).json()
    const before = challengeGeneration(h.db, u.id)
    if (mutation === 'missing') h.db.query('DELETE FROM devices WHERE id=?').run(did)
    else if (mutation === 'revoked') h.db.query('UPDATE devices SET revoked_at=? WHERE id=?').run(h.clock.t, did)
    else if (mutation === 'wrong-owner') h.db.query('UPDATE devices SET user_id=? WHERE id=?').run('u_test_2', did)
    else h.db.query('UPDATE devices SET sv=sv+1 WHERE id=?').run(did)
    const count = listDevices(h.db, u.id).length
    expect(challengeGeneration(h.db, u.id)).toBe(before)
    expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
    expect(listDevices(h.db, u.id)).toHaveLength(count)
    expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
  })
}

test('legacy pairing follows its authenticated renewal successor and is deleted on successor logout', async () => {
  for (const logout of [false, true]) {
    const h = authServer({ DEVICE_TOKENS: '1' }), token = mint('u_phone', 1)
    const { code } = await (await h.post('/api/pair/create', { Cookie: 'gymsid=' + token })).json()
    const renewed = await (await h.me(bearer(token))).json()
    expect(renewed.token).toStartWith('v2.')
    if (logout) expect((await h.post('/api/logout', bearer(renewed.token))).status).toBe(200)
    const redeemed = await h.post('/api/pair/redeem', {}, { code })
    expect(redeemed.status).toBe(logout ? 400 : 200)
    if (!logout) expect((await h.me(bearer((await redeemed.json()).token))).status).toBe(200)
  }
})

test('logout-all keeps committed revocation and legacy 200 when the shared accounts mirror fails, then clears stale on repair', async () => {
  for (const deviceTokens of ['0', '1']) {
    let fail = true
    const logs: string[] = []
    const h = authServer({ DEVICE_TOKENS: deviceTokens }, {
      mirror: (...args) => { if (fail) throw new Error('synthetic sensitive mirror details'); return writeAccountsMirror(...args) },
      log: message => logs.push(message),
    })
    const u = getUser(h.db, 'u_phone')!, a = h.auth.mint(u), b = deviceTokens === '1' ? h.auth.mint(u) : mint(u.id, 2)
    const { code } = await (await h.post('/api/pair/create', { Cookie: 'gymsid=' + a })).json()
    putDeviceLink(h.db, { h: 'synthetic-hash', user_id: u.id, exp: h.clock.t + 100000, created: h.clock.t })
    const before = challengeGeneration(h.db, u.id)
    const response = await h.post('/api/logout/all', { Cookie: 'gymsid=' + a })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.getSetCookie()[0]).toContain('gymsid=; Path=/; Max-Age=0')
    expect(getUser(h.db, u.id)?.sv).toBe(u.sv + 1)
    expect(challengeGeneration(h.db, u.id)).toBe(before + 1)
    expect(getMeta(h.db, 'accounts_mirror_stale')).toBe('1')
    expect(logs).toEqual(['accounts mirror write failed'])
    expect((await h.me(bearer(a))).status).toBe(401)
    expect((await h.me(bearer(b))).status).toBe(401)
    expect(h.db.query('SELECT * FROM device_links').all()).toHaveLength(0)
    expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
    expect(listAudit(h.db).some(e => e.ev === 'auth.logout.all' && e.ok === 1)).toBe(true)
    fail = false
    const fresh = h.auth.mint(getUser(h.db, u.id)!)
    expect((await h.post('/api/logout/all', { Cookie: 'gymsid=' + fresh })).status).toBe(200)
    expect(getMeta(h.db, 'accounts_mirror_stale')).toBe('0')
  }
})

test('ordinary legacy logout removes its pending pairing while retaining cookie-only session behavior', async () => {
  const h = authServer(), headers = cookie('u_phone')
  const { code } = await (await h.post('/api/pair/create', headers)).json()
  expect((await h.post('/api/logout', headers)).status).toBe(200)
  expect((await h.me(headers)).status).toBe(200)
  expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
})
