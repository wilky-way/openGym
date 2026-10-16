import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { start } from './helpers'

// Deliberately injected verified-session hook; actual token verification belongs to S03.
const cookie = { Cookie: 'gymsid=synthetic-valid-session' }
const bearer = { Authorization: 'Bearer synthetic-valid-session' }
function fixture(env: Record<string, string> = {}) {
  const h = start({ INVITE_ONLY: '1', ALLOW_GUEST: '0', ...env }, {
    signedIn: request => request.headers.get('cookie') === cookie.Cookie || request.headers.get('authorization') === bearer.Authorization,
  })
  const config = (headers?: HeadersInit) => fetch(`${h.api}/api/config`, { headers }).then(response => response.json())
  return { ...h, config }
}

test('GET /api/config: public flags are identical for anonymous, cookie and bearer callers', async () => {
  const h = fixture()
  const expected = { invite_only: true, allow_guest: false }
  assert.deepEqual(await h.config(), expected)
  assert.deepEqual(await h.config(cookie), { ...expected, signedIn: true })
  assert.deepEqual(await h.config(bearer), { ...expected, signedIn: true })
  assert.deepEqual(await h.config({ Cookie: 'gymsid=synthetic-invalid-session' }), expected)
})

test('GET /api/config: password, language and media capabilities remain public', async () => {
  const h = fixture({ PASSWORD_LOGIN: '1', DEFAULT_LANG: 'en-US', MEDIA_UPLOADS: '1' })
  const anon = await h.config()
  assert.deepEqual(Object.keys(anon).sort(), ['allow_guest', 'default_lang', 'invite_only'])
  assert.equal(anon.invite_only, true)
  assert.equal(anon.allow_guest, false)
  assert.equal('password_login' in anon, false)
  assert.equal(anon.default_lang, 'en-US')
  assert.equal('media' in anon, false)
  assert.equal('coach' in anon, false)
  assert.deepEqual(await h.config(cookie), { ...anon, signedIn: true })
  assert.deepEqual(await h.config(bearer), { ...anon, signedIn: true })
})

test('GET /api/config: legacy provider settings disclose nothing to any caller', async () => {
  const h = fixture()
  writeFileSync(join(h.dataDir, 'coach.json'), JSON.stringify({ enabled: true, provider: 'compatible', baseUrl: 'https://synthetic.example' }))
  for (const headers of [undefined, cookie, bearer]) {
    assert.deepEqual(await h.config(headers), { invite_only: true, allow_guest: false, ...(headers ? { signedIn: true } : {}) })
  }
})

test('GET /api/config: DEFAULT_LANG is public when set, absent when unset or malformed (#303)', async () => {
  const set = fixture({ DEFAULT_LANG: 'en-US' })
  assert.deepEqual(await set.config(), { invite_only: true, allow_guest: false, default_lang: 'en-US' })
  const bad = fixture({ DEFAULT_LANG: '<script>' })
  assert.equal('default_lang' in await bad.config(), false)
  const unset = fixture({ DEFAULT_LANG: '' })
  assert.equal('default_lang' in await unset.config(), false)
})

test('contract-unsure:GET /api/config replaces the legacy presence signal with verified signedIn only', async () => {
  const signedOut = start({}, { signedIn: () => false })
  const signedIn = start({}, { signedIn: () => true })
  assert.deepEqual(await fetch(`${signedOut.api}/api/config`).then(response => response.json()), { invite_only: false, allow_guest: true })
  assert.deepEqual(await fetch(`${signedIn.api}/api/config`).then(response => response.json()), { invite_only: false, allow_guest: true, signedIn: true })
})
