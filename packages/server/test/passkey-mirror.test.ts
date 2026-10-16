import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { getMeta, writeAccountsMirror } from '../src/storage'
import { startServer, softPasskey, redeem } from './passkey-helpers'

test('committed registration and device-link redemption return sessions despite a failed mirror, and repair clears the stale flag', async () => {
  let fail = true
  const log: string[]=[]
  const owner=softPasskey(),phone=softPasskey()
  const h=await startServer(undefined,{env:{DEVICE_TOKENS:'1',INVITE_ONLY:'1'},invites:[{code:'S13-SYNTHETIC'}],passkeys:{
    mirror:(...args)=>{if(fail)throw new Error('synthetic mirror fault');return writeAccountsMirror(...args)},
    log:line=>log.push(line),
  }})
  const opt=(await h.req('POST','/api/register/options',{body:{name:'Synthetic',code:'S13-SYNTHETIC'}})).body
  const done=await h.req('POST','/api/register/verify',{body:{cid:opt.cid,credential:owner.attestation(opt.options.challenge)}})
  assert.equal(done.status,200)
  assert.ok(done.cookie)
  assert.equal(h.db().users.length,1)
  assert.equal(h.db().invites[0].usedBy,done.body.user.id)
  assert.equal(h.db().creds.length,1)
  assert.equal(getMeta(h.sql,'accounts_mirror_stale'),'1')
  assert.equal((await h.req('GET','/api/me',{cookie:done.cookie})).status,200)
  const proof=await h.stepUp(owner)
  const made=await h.req('POST','/api/account/device-link',{cookie:done.cookie,body:proof})
  assert.equal(made.status,200)
  const linked=await redeem(h,made.body.code,phone,'198.51.100.2','\u202EPhone\n\t')
  assert.equal(linked.status,200)
  assert.ok(linked.cookie)
  assert.equal(h.db().deviceLinks.length,0)
  assert.equal(h.db().creds.length,2)
  assert.equal(h.db().creds[1].name,'Phone')
  assert.ok(h.audit().some(e=>e.ev==='auth.link.ok' && e.msg==='Phone'))
  assert.equal((await h.req('GET','/api/me',{cookie:linked.cookie})).status,200)
  assert.equal(getMeta(h.sql,'accounts_mirror_stale'),'1')
  assert.ok(log.length>=3)
  assert.ok(log.every(line=>line==='accounts mirror write failed'))
  fail=false
  const lo=(await h.req('POST','/api/login/options')).body
  assert.equal((await h.req('POST','/api/login/verify',{body:{cid:lo.cid,credential:owner.assertion(lo.options.challenge)}})).status,200)
  assert.equal(getMeta(h.sql,'accounts_mirror_stale'),'0')
})
