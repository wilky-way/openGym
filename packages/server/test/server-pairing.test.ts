import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { authServer, cookie } from './auth-helpers'
import { getDevice } from '../src/storage/devices'
test("logout/all invalidates the account's outstanding pairing codes and nobody else's", async () => {
  const h = authServer()
  const post = (p: string, headers: HeadersInit, body?: unknown) =>
    fetch(`${h.api}${p}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const create = async (uid: string, sv: number) => {
    const r = await post('/api/pair/create', cookie(uid, sv))
    assert.equal(r.status, 200)
    return (await r.json()).code
  }
  const redeem = (code: string) => post('/api/pair/redeem', {}, { code })

  // control: mint and redeem with nothing in between
  assert.equal((await redeem(await create('u_test_1', 0))).status, 200)

  // a code minted before "sign out everywhere" is refused after it
  const stale = await create('u_test_1', 0)
  const other = await create('u_test_2', 0)
  assert.equal(
    (await post('/api/logout/all', cookie('u_test_1', 0))).status,
    200,
  )
  const r = await redeem(stale)
  assert.equal(r.status, 400)
  assert.deepEqual(await r.json(), {
    error: 'invalid or expired code',
    code: 'pair-invalid',
  })

  // the other account's code is untouched
  assert.equal((await redeem(other)).status, 200)

  // and a code minted after the sign-out (session version 1 now) redeems for a token of that version
  const fresh = await redeem(await create('u_test_1', 1))
  assert.equal(fresh.status, 200)
  const { token } = await fresh.json()
  assert.match(token, /^v2\./)
  assert.equal(getDevice(h.db, token.split('.')[1])?.sv, 1)
})
