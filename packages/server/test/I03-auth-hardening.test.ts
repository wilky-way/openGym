import { test, expect } from 'bun:test'
import { startAdmin, VICTIM, as } from './admin-helpers'
import { mint, cookie as authCookie, authServer, bearer } from './auth-helpers'
import { fixture, cookie, other } from './notification-helpers'
import { listSubs } from '../src/storage'
test('disable then enable never revives an existing session; a fresh session still works', async () => {
  const h = startAdmin()
  const old = as(VICTIM)
  expect((await fetch(h.api + '/api/me', {headers: old})).status).toBe(200)
  await h.post('/api/admin/user/disable', {id: VICTIM, disabled: true})
  expect((await fetch(h.api + '/api/me', {headers: old})).status).toBe(401)
  await h.post('/api/admin/user/disable', {id: VICTIM, disabled: false})
  expect((await fetch(h.api + '/api/me', {headers: old})).status).toBe(401)
  expect(h.sqlite.query<{sv: number}, [string]>('SELECT sv FROM users WHERE id=?').get(VICTIM)!.sv).toBe(1)
  expect((await fetch(h.api + '/api/me', {headers: {Cookie: 'gymsid=' + mint(VICTIM, 1, 1)}})).status).toBe(200)
})
test('hostile mixed cookie/Bearer request is CSRF refused; Bearer-only retains its exemption', async () => {
  const h = authServer(), token = mint('u_test_1')
  const headers = {...authCookie('u_test_1'), ...bearer(token), Origin: 'https://evil.example', 'Content-Type': 'application/json'}
  expect((await fetch(h.api + '/api/logout/all', {method: 'POST', headers, body: '{}'})).status).toBe(403)
  const {Cookie: _, ...onlyBearer} = headers
  expect((await fetch(h.api + '/api/logout/all', {method: 'POST', headers: onlyBearer, body: '{}'})).status).toBe(200)
})
test('a push endpoint stays bound to its original owner, with unchanged keys on refusal', async () => {
  const h = fixture(), endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-i03'
  const body = JSON.stringify({subscription: {endpoint, keys: {p256dh: 'synthetic-public-key', auth: 'synthetic-auth'}}})
  const post = (headers: Record<string,string>, content = body) => fetch(h.api + '/api/push/subscribe', {method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: content})
  expect((await post(cookie)).status).toBe(200)
  const before = listSubs(h.store.db, 'u_test_1')
  expect((await post(other, body.replace('synthetic-auth', 'replacement'))).status).toBe(409)
  expect(listSubs(h.store.db, 'u_test_1')).toEqual(before); expect(listSubs(h.store.db, 'u_test_2')).toEqual([])
  expect((await post(cookie, body.replace('synthetic-auth', 'rotated'))).status).toBe(200)
  expect(listSubs(h.store.db, 'u_test_1')[0]!.auth).toBe('rotated')
})
