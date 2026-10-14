import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server'
import { startServer, softPasskey, user, mintSession, makeLink } from './passkey-helpers'

function pause() {
  let resume!: () => void, entered!: () => void
  const held = new Promise<void>(resolve => resume = resolve)
  const started = new Promise<void>(resolve => entered = resolve)
  return { held, started, resume, entered }
}

test('revoking a device or its sv during awaited registration prevents Settings addition', async () => {
  for (const revoke of ['device','sv'] as const) {
    const key = softPasskey(), fresh = softPasskey(), gate = pause()
    const h = await startServer(undefined,{env:{DEVICE_TOKENS:'1'}, users:[user('u1','Synthetic')], creds:[key.row('u1')],
      passkeys:{webauthn:{verifyRegistrationResponse:async o=>{const v=await verifyRegistrationResponse(o);gate.entered();await gate.held;return v}}}})
    const token = h.auth.mint(h.sql.query<any,[]>("SELECT * FROM users WHERE id='u1'").get()), cookie = 'gymsid='+token
    const opt = (await h.req('POST','/api/account/passkeys/options',{cookie,body:await h.stepUp(key)})).body
    const verifying = h.req('POST','/api/account/passkeys/verify',{cookie,body:{cid:opt.cid,credential:fresh.attestation(opt.options.challenge)}})
    await gate.started
    assert.equal((await h.req('POST',revoke==='device'?'/api/logout':'/api/logout/all',{cookie,body:{}})).status,200)
    gate.resume()
    assert.equal((await verifying).status,401)
    assert.deepEqual(h.db().creds.map(c=>c.id),[key.id])
  }
})

test('a removed proof credential cannot complete an awaited assertion even with a still-valid cookie', async () => {
  const key = softPasskey(), gate = pause()
  const h = await startServer(undefined,{users:[user('u1','Synthetic')],creds:[key.row('u1')],
    passkeys:{webauthn:{verifyAuthenticationResponse:async o=>{const v=await verifyAuthenticationResponse(o);gate.entered();await gate.held;return v}}}})
  const proof = await h.stepUp(key)
  const adding = h.req('POST','/api/account/passkeys/options',{cookie:mintSession('u1'),body:proof})
  await gate.started
  h.sql.query('DELETE FROM creds WHERE id=?').run(key.id)
  gate.resume()
  assert.equal((await adding).status,403)
  assert.equal(h.db().creds.length,0)
  assert.equal(h.db().deviceLinks.length,0)
})

test('replaced or disabled device link during crypto verification adds no key and opens no session', async () => {
  for (const mutation of ['replace','disable','logout'] as const) {
    const key = softPasskey(), fresh = softPasskey(), gate = pause()
    const h = await startServer(undefined,{users:[user('u1','Synthetic')],creds:[key.row('u1')],
      passkeys:{webauthn:{verifyRegistrationResponse:async o=>{const v=await verifyRegistrationResponse(o);gate.entered();await gate.held;return v}}}})
    const {code} = (await makeLink(h,key,'u1','198.51.100.1')).body
    const opt = (await h.req('POST','/api/device-link/options',{body:{code}})).body
    const verifying = h.req('POST','/api/device-link/verify',{body:{code,cid:opt.cid,credential:fresh.attestation(opt.options.challenge)}})
    await gate.started
    if (mutation==='replace') await makeLink(h,key,'u1','198.51.100.1')
    else if (mutation==='disable') h.sql.query("UPDATE users SET disabled=1 WHERE id='u1'").run()
    else await h.req('POST','/api/logout/all',{cookie:mintSession('u1'),body:{}})
    gate.resume()
    const result = await verifying
    assert.equal(result.status,400)
    assert.equal(result.cookie,null)
    assert.deepEqual(h.db().creds.map(c=>c.id),[key.id])
  }
})

test('racing Settings registrations enforce the cap at the commit boundary', async () => {
  const key = softPasskey(), extras = Array.from({length:18},()=>softPasskey())
  const h = await startServer(undefined,{users:[user('u1','Synthetic')],creds:[key.row('u1'),...extras.map(k=>k.row('u1'))]})
  const cookie = mintSession('u1')
  const a = (await h.req('POST','/api/account/passkeys/options',{cookie,body:await h.stepUp(key)})).body
  const b = (await h.req('POST','/api/account/passkeys/options',{cookie,body:await h.stepUp(key)})).body
  const results = await Promise.all([a,b].map(o=>h.req('POST','/api/account/passkeys/verify',{cookie,body:{cid:o.cid,credential:softPasskey().attestation(o.options.challenge)}})))
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  assert.equal(h.db().creds.length,20)
  assert.equal(results.find(r=>r.status===409)!.body.code,'passkey-limit')
  assert.ok(h.audit().some(e=>e.ev==='auth.passkey.fail' && e.msg==='passkey-limit'))
})

test('racing removals never remove the last way in', async () => {
  const a=softPasskey(),b=softPasskey()
  const h=await startServer(undefined,{users:[user('u1','Synthetic')],creds:[a.row('u1'),b.row('u1')]})
  const proofs = await Promise.all([h.stepUp(a),h.stepUp(b)])
  const results = await Promise.all([a,b].map((key,n)=>h.req('DELETE','/api/account/passkeys?id='+key.id,{cookie:mintSession('u1'),body:proofs[n]})))
  assert.equal(results.filter(r=>r.status===200).length,1)
  assert.equal(results.some(r=>[403,409].includes(r.status)),true)
  assert.equal(h.db().creds.length,1)
})
