import {test, expect} from 'bun:test'
import {startServer, softPasskey} from './passkey-helpers'
const setup = 'SYNTHETIC_SETUP_TOKEN_0123456789ABCD'
const registration = async (h: Awaited<ReturnType<typeof startServer>>, name: string, code = '') => {
 const options = await h.req('POST', '/api/register/options', {body: {name, code}})
 if (options.status !== 200) return options
 return h.req('POST', '/api/register/verify', {body: {cid: options.body.cid, credential: softPasskey().attestation(options.body.options.challenge)}})
}
test('secure defaults close registration; a one-time setup token creates the first admin only', async () => {
 const h = await startServer(undefined, {env: {INVITE_ONLY: undefined, SETUP_TOKEN: setup}})
 expect((await registration(h, 'Anonymous')).status).toBe(403)
 expect((await registration(h, 'Wrong', setup + 'X')).status).toBe(403)
 const first = await registration(h, 'Synthetic owner', setup.toLowerCase())
 expect(first.status).toBe(200); expect(first.body.user.admin).toBe(true)
 expect((await registration(h, 'Replay', setup)).status).toBe(403)
 expect(h.db().users).toHaveLength(1); expect(JSON.stringify(h.db())).not.toContain(setup)
})
test('a setup challenge cannot race another first-admin registration', async () => {
 const h = await startServer(undefined, {env: {INVITE_ONLY: undefined, SETUP_TOKEN: setup}})
 const a = await h.req('POST', '/api/register/options', {body: {name: 'Synthetic A', code: setup}})
 const b = await h.req('POST', '/api/register/options', {body: {name: 'Synthetic B', code: setup}})
 expect(a.status).toBe(200); expect(b.status).toBe(200)
 const verify = (options: any) => h.req('POST', '/api/register/verify', {body: {cid: options.body.cid, credential: softPasskey().attestation(options.body.options.challenge)}})
 expect((await verify(a)).status).toBe(200); expect((await verify(b)).status).toBe(403)
 expect(h.db().users).toHaveLength(1)
})
test('a setup token cannot promote an account on an existing instance', async () => {
 const h = await startServer(undefined, {env: {INVITE_ONLY: undefined, SETUP_TOKEN: setup}, users: [{id: 'existing', name: 'Existing', created: '2026-10-12T00:00:00Z'}]})
 expect((await registration(h, 'Replay', setup)).status).toBe(403)
 expect(h.db().users[0].admin).not.toBe(true)
})
