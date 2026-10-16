import { afterEach, test } from 'bun:test'
import fs from 'node:fs'
import { startOracle } from '../../parity/src/oracle'
import { decodeBytes, type SyntheticProfile } from '../../parity/src/types'
import { CLOCK } from './auth-helpers'
import { passkeyPositive, deviceLinkPositive } from './passkey-transcript-flows'
import type { FlowServer, FlowHarness } from './passkey-transcript-flows'

// Derived requests use each server's own challenge and cookie; both recordings must equal
// the SAME checked-in positive transcript. Keys, credential IDs and clock are fixed.
const oracleServer: FlowServer = async (_t, { users = [], creds = [] } = {}) => {
  const profile: SyntheticProfile = { seed: 13, now: CLOCK, db: { users, creds, subs: [], invites: [] }, docs: {} }
  const oracle = await startOracle(profile)
  afterEach(() => oracle.stop())
  const req: FlowHarness['req'] = async (method, path, { body, cookie, headers = {} } = {}) => {
    const response = await oracle.request({ method, path, headers: {
      'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers,
      ...(cookie && !cookie.startsWith('gymsid=u1:') ? { Cookie: cookie } : {}),
    }, ...(cookie?.startsWith('gymsid=u1:') ? { session: { uid: 'u1' } } : {}),
      ...(body === undefined ? {} : { body: { encoding: 'utf8', data: JSON.stringify(body) } }) })
    const h = new Headers()
    for (const [key, values] of Object.entries(response.headers)) for (const value of values) h.append(key,value)
    const sc = h.getSetCookie().find(c=>c.startsWith('gymsid=')&&!c.startsWith('gymsid=;'))
    return { status: response.status, body: JSON.parse(decodeBytes(response.body).toString('utf8')), headers: h, cookie: sc ? sc.split(';')[0]! : null }
  }
  // Flow code only calls req/db. A structural facade deliberately keeps mutation operations unavailable.
  return { req, db: () => JSON.parse(fs.readFileSync(oracle.dataDir+'/db.json','utf8')), dataDir: oracle.dataDir }
}

test('S13:passkey-positive-ceremony matches frozen Node 22 oracle across three recordings',()=>passkeyPositive(oracleServer))
test('S13:device-link-positive matches frozen Node 22 oracle across three recordings',()=>deviceLinkPositive(oracleServer))
