import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { startServer, softPasskey, user } from './passkey-helpers'
import { deviceResponse, listDevices } from '../src/storage/devices'
import { passkeyPositive, deviceLinkPositive } from './passkey-transcript-flows'

test('S13:passkey-positive-ceremony', () => passkeyPositive())
test('S13:device-link-positive', () => deviceLinkPositive())

test('default passkey and link sign-ins mint browser devices; secure cookies migrate', async () => {
  const owner=softPasskey(),phone=softPasskey()
  const h=await startServer(undefined,{users:[user('u1','Synthetic')],creds:[owner.row('u1')]})
  const login=(await h.req('POST','/api/login/options')).body
  const entered=await h.req('POST','/api/login/verify',{body:{cid:login.cid,credential:owner.assertion(login.options.challenge)}})
  assert.match(entered.cookie!,/^gymsid=v2\./)
  const proof=await h.stepUp(owner)
  const {code}=(await h.req('POST','/api/account/device-link',{cookie:entered.cookie,body:proof})).body
  const o=(await h.req('POST','/api/device-link/options',{body:{code}})).body
  const added=await h.req('POST','/api/device-link/verify',{body:{code,cid:o.cid,credential:phone.attestation(o.options.challenge)}})
  assert.match(added.cookie!,/^gymsid=v2\./)
  const devices=listDevices(h.sql,'u1').map(deviceResponse)
  assert.deepEqual(devices.map(d=>d.kind),['browser','browser'])
  assert.equal(devices.length,2)
  await h.req('POST','/api/logout',{cookie:entered.cookie,body:{}})
  assert.equal((await h.req('GET','/api/me',{cookie:entered.cookie})).status,401)
  assert.equal((await h.req('GET','/api/me',{cookie:added.cookie})).status,200)
  const secure=await startServer(undefined,{env:{ORIGIN:'https://localhost:8080'}})
  const so=(await secure.req('POST','/api/register/options',{body:{name:'Secure athlete'}})).body
  const key=softPasskey()
  const result=await secure.req('POST','/api/register/verify',{body:{cid:so.cid,credential:key.attestation(so.options.challenge,{origin:'https://localhost:8080'})}})
  const cookies=result.headers.getSetCookie()
  assert.match(cookies[0]!,/^__Host-gymsid=.+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/)
  assert.match(cookies[1]!,/^gymsid=; Path=\/; Max-Age=0;/)
})
