import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  authServer,
  mint as rawMint,
  bearer,
  SECRET,
  DAY,
} from './auth-helpers'
const SESSION_DAYS = 10
const mint = (
  uid: string,
  { daysLeft, sv = 0 }: { daysLeft: number; sv?: number },
) => rawMint(uid, daysLeft, sv)
const verifies = (token: string) => {
  const i = token.lastIndexOf('.')
  return (
    token.slice(i + 1) ===
    createHmac('sha256', SECRET).update(token.slice(0, i)).digest('base64url')
  )
}
test('a bearer token past half its lifetime gets a fresh one from /api/me; a younger one and a cookie do not', async () => {
  const h = authServer({ DEVICE_TOKENS: '0' })
  const me = (headers: HeadersInit) => fetch(`${h.api}/api/me`, { headers })

  // Four of ten days left: past half. The new token verifies, lasts the full SESSION_DAYS
  // from now, keeps the account's session version, and is itself accepted.
  const old = await me(bearer(mint('u_phone', { daysLeft: 4 })))
  assert.equal(old.status, 200)
  const body = await old.json()
  assert.equal(body.user.id, 'u_phone')
  assert.equal(typeof body.token, 'string')
  assert.ok(verifies(body.token))
  const [uid, exp, sv] = body.token.split('.')[0].split(':')
  assert.equal(uid, 'u_phone')
  assert.equal(sv, '0')
  assert.ok(Math.abs(Number(exp) - (h.clock.t + SESSION_DAYS * DAY)) < 60000)
  const again = await me(bearer(body.token))
  assert.equal(again.status, 200)
  assert.equal((await again.json()).token, undefined) // brand new — nothing to renew

  // Eight of ten days left: not yet.
  const young = await me(bearer(mint('u_phone', { daysLeft: 8 })))
  assert.deepEqual(Object.keys(await young.json()), ['user'])

  // A browser's cookie is renewed by signing in, not here.
  const cookie = await me({
    Cookie: `gymsid=${mint('u_phone', { daysLeft: 1 })}`,
  })
  assert.equal(cookie.status, 200)
  assert.equal((await cookie.json()).token, undefined)
})

test('revocation still works: an old session version is refused, and "sign out everywhere" ends a renewed token', async () => {
  const h = authServer({ DEVICE_TOKENS: '0' })
  const me = (headers: HeadersInit) => fetch(`${h.api}/api/me`, { headers })

  // Revoked before it was ever renewed: refused, and no new token handed out.
  const revoked = await me(bearer(mint('u_bumped', { daysLeft: 2, sv: 0 })))
  assert.equal(revoked.status, 401)
  assert.equal((await revoked.json()).token, undefined)

  // Renewed first, then the account signs out everywhere: the renewed token dies with it.
  const r = await me(bearer(mint('u_phone', { daysLeft: 1 })))
  const { token } = await r.json()
  assert.equal((await me(bearer(token))).status, 200)
  const out = await fetch(`${h.api}/api/logout/all`, {
    method: 'POST',
    headers: { Cookie: `gymsid=${mint('u_phone', { daysLeft: 9 })}` },
  })
  assert.equal(out.status, 200)
  assert.equal((await me(bearer(token))).status, 401)
})
