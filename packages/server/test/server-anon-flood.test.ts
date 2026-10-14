import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { authServer, cookie } from './auth-helpers'
import { listAudit } from '../src/storage'

test('wrong pairing codes are all answered, but only a few of them reach the audit log', async () => {
  const h = authServer()
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await h.post('/api/pair/redeem', {}, { code: 'WRONG' + i })).status,
      400,
    )
  assert.equal(
    listAudit(h.db).filter((r) => r.ev === 'auth.pair.fail').length,
    10,
    'ten a minute per address, not thirty',
  )
})

test("minting a pairing code retires the profile's previous one", async () => {
  const h = authServer(),
    create = async () =>
      (
        await (
          await h.post('/api/pair/create', {
            ...cookie('u_phone'),
            Origin: 'http://localhost:8080',
          })
        ).json()
      ).code
  const first = await create(),
    second = await create()
  assert.notEqual(first, second)
  assert.equal(
    (await h.post('/api/pair/redeem', {}, { code: first })).status,
    400,
    'the older code is gone',
  )
  assert.equal(
    (await h.post('/api/pair/redeem', {}, { code: second })).status,
    200,
    'the newest one works',
  )
})

test('junk passkey sign-ins and sign-ups are answered but not each written to the audit log', async () => {
  const h = authServer({ TRUST_PROXY: '1', AUDIT_IP: 'full' });
  for (let i = 0; i < 25; i++) {
    assert.equal((await h.post('/api/login/verify', {}, { cid: 'junk' + i, credential: { id: 'x' } })).status, 400);
    assert.equal((await h.post('/api/register/verify', {}, { cid: 'junk' + i })).status, 400);
  }
  // A valid challenge with an unknown passkey is the other cheap miss.
  for (let i = 0; i < 15; i++) {
    const { cid } = await (await h.post('/api/login/options', { 'X-Forwarded-For': '198.51.100.2' })).json();
    assert.equal((await h.post('/api/login/verify', { 'X-Forwarded-For': '198.51.100.2' }, { cid, credential: { id: 'nobody' + i } })).status, 404);
  }
  const rows = listAudit(h.db);
  assert.equal(rows.filter(r => r.ev === 'auth.login.fail').length, 20);
  assert.equal(rows.filter(r => r.ev === 'auth.login.fail' && r.ip === '127.0.0.1').length, 10);
  assert.equal(rows.filter(r => r.ev === 'auth.login.fail' && r.ip === '198.51.100.2').length, 10);
  assert.equal(rows.filter(r => r.ev === 'auth.register.fail').length, 10);
});
