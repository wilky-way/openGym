// Legacy names retained; filesystem failures now arrive through the authenticated API.
import { describe, test, expect } from 'vitest'
import { withRemoteState, getState, getUser } from '../src/state'
import type { Fetcher } from '../src/http-client'
const env = { OPENGYM_URL: 'http://127.0.0.1:1234', OPENGYM_TOKEN: 'synthetic-token', OPENGYM_UID: 'the operator' }
function fixture({ state = null, status = 200, corrupt = false, user = 'the operator' }: any = {}) {
  const calls: string[] = []
  const fetcher: Fetcher = async url => {
    calls.push(url)
    if (url.endsWith('/api/me')) return { ok: true, status: 200, json: async () => ({ user: { id: user, name: 'Synthetic', created: '2026-01-01' } }) }
    if (url.endsWith('/rev')) return { ok: true, status: 200, json: async () => ({ rev: 1, wid: 'epoch' }) }
    return { ok: status === 200, status, json: async () => { if (corrupt) throw new Error('private server parse details'); return { state, rev: 1 } } }
  }
  return { calls, load: () => withRemoteState(() => getState(), { env, fetcher }) }
}
describe('a read failure is not "you never signed in"', () => {
  test('no state file at all is still null — that account really has never synced', async () => {
    const f = fixture(); expect(await f.load()).toBeNull(); expect(f.calls).toHaveLength(3)
  })
  test('a corrupt state file throws EIO naming the parse failure', async () => {
    const err: any = await fixture({ corrupt: true }).load().catch(e => e)
    expect(err).toBeTruthy(); expect(err.code).toBe('API_UNAVAILABLE'); expect(err.message).toMatch(/invalid response/)
    expect(err.message).not.toMatch(/sign in/i); expect(err.message).not.toContain('private server')
  })
  test('a state file that cannot be read throws EIO naming the failure, not null', async () => {
    const err: any = await fixture({ status: 500 }).load().catch(e => e)
    expect(err).toBeTruthy(); expect(err.code).toBe('API_REFUSED'); expect(err.message).toMatch(/refused.*500/)
    expect(err.message).not.toMatch(/sign in/i)
  })
  test('a permission failure names the file, not the server\'s path', async () => {
    const err: any = await fixture({ status: 403 }).load().catch(e => e)
    expect(err).toBeTruthy(); expect(err.code).toBe('API_REFUSED'); expect(err.message).toMatch(/refused.*403/)
    expect(err.message).not.toContain('/'); expect(err.message).not.toContain('the operator')
  })
  test('a good state file still loads, with the app defaults merged in', async () => {
    const S = await fixture({ state: { unit: 'lb', routines: [{ id: 'r1', name: 'R', ex: [] }], _wid: 'epoch' } }).load()
    expect(S.unit).toBe('lb'); expect(S.routines.length).toBe(1); expect(S.dayPlan).toEqual({}); expect(S._rev).toBe(1)
  })
})
describe('the "which profile?" error is a config message, not a roster', () => {
  for (const label of ['several state files', 'several users, none synced yet']) {
    test(`${label}: names no uid and no absolute path`, async () => {
      const calls: string[] = [], ids = ['the operator', 'secret-partner-uid', 'third-account']
      const fetcher: Fetcher = async url => { calls.push(url); throw new Error(ids.join(', ') + '/private/data') }
      const err: any = await withRemoteState(getState, { env: { ...env, OPENGYM_UID: '' }, fetcher }).catch(e => e)
      expect(err).toBeTruthy(); expect(err.code).toBe('CONFIG_REQUIRED'); expect(err.message).toMatch(/OPENGYM_UID/)
      expect(err.message).toMatch(/profile/); for (const uid of ids) expect(err.message).not.toContain(uid)
      expect(err.message).not.toContain('/private/data'); expect(err.message).not.toContain('/'); expect(calls).toEqual([])
    })
  }
})
test('rechecks profile on every tool call and does not serve a cached doc after mismatch', async () => {
  let uid = 'the operator', gets = 0
  const fetcher: Fetcher = async url => ({ ok: true, status: 200, json: async () => {
    if (url.endsWith('/me')) return { user: { id: uid, name: 'Synthetic' } }
    if (url.endsWith('/rev')) return { rev: 2, wid: 'e' }
    gets++; return { rev: 2, state: { _wid: 'e', routines: [] } }
  } })
  await withRemoteState(() => { expect(getUser().id).toBe('the operator') }, { env, fetcher })
  await withRemoteState(getState, { env, fetcher }); expect(gets).toBe(1)
  uid = 'different'; await expect(withRemoteState(getState, { env, fetcher })).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' }); expect(gets).toBe(1)
})
test('same-revision restore with a different wid invalidates the cache', async () => {
  let wid = 'a', pulls = 0
  const fetcher: Fetcher = async url => ({ ok: true, status: 200, json: async () => url.endsWith('/me') ? { user: { id: 'the operator', name: 'Synthetic' } } : url.endsWith('/rev') ? { rev: 7, wid } : (++pulls, { rev: 7, state: { _wid: wid } }) })
  expect((await withRemoteState(getState, { env, fetcher }))._wid).toBe('a')
  wid = 'b'; expect((await withRemoteState(getState, { env, fetcher }))._wid).toBe('b'); expect(pulls).toBe(2)
})
