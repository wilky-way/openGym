import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, softPasskey, user, mintSession } from './passkey-helpers'

export type FlowHarness = Pick<Awaited<ReturnType<typeof startServer>>, 'req' | 'db'>
export type FlowServer = (_t: unknown, options?: { users?: any[]; creds?: any[] }) => Promise<FlowHarness>
export function recorder(h: FlowHarness) {
  const rows: unknown[] = [], identities = new Map<string,string>(), counters = new Map<string,number>()
  function remember(v: string, kind: string) {
    if (!identities.has(v)) { const n = (counters.get(kind) || 0) + 1; counters.set(kind,n); identities.set(v,`$${kind}${n}`) }
  }
  return {
    rows,
    async req(method: string, route: string, init: Parameters<typeof h.req>[2] = {}) {
      const result = await h.req(method,route,init), body = result.body
      if (body.cid) remember(body.cid,'cid')
      if (body.options?.challenge) remember(body.options.challenge,'challenge')
      if (body.options?.user?.id) remember(body.options.user.id,'handle')
      if (body.user?.id) remember(body.user.id,'uid')
      if (body.code && result.status===200) remember(body.code,'link')
      const cookies = result.headers.getSetCookie().map(c => c.replace(/((?:__Host-)?gymsid=)[^;]+/, '$1$session'))
      function normalise(v: unknown): unknown {
        if (typeof v==='string') return identities.get(v) ?? v
        if (Array.isArray(v)) return v.map(normalise)
        if (v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,n])=>[k,normalise(n)]))
        return v
      }
      rows.push({method,route,status:result.status,body:normalise(body),cookies})
      return result
    },
  }
}
export function golden(name: string, rows: unknown[]) {
  const file=path.join(import.meta.dir,'transcripts',name+'.json')
  if (process.env.RECORD_S13==='1') fs.writeFileSync(file,JSON.stringify(rows,null,2)+'\n')
  assert.deepEqual(rows,JSON.parse(fs.readFileSync(file,'utf8')))
}

export async function passkeyPositive(start: FlowServer = startServer) {
  const recordings: string[]=[]
  for(let run=0;run<3;run++) {
    const h=await start(undefined), rec=recorder(h), owner=softPasskey('S13-transcript-owner'), extra=softPasskey('S13-transcript-extra')
    const reg=(await rec.req('POST','/api/register/options',{body:{name:'Synthetic athlete'}})).body
    const created=await rec.req('POST','/api/register/verify',{body:{cid:reg.cid,credential:owner.attestation(reg.options.challenge)}})
    assert.equal(created.status,200)
    const cookie=created.cookie!, uid=created.body.user.id
    const lo=(await rec.req('POST','/api/login/options',{body:{}})).body
    assert.equal((await rec.req('POST','/api/login/verify',{body:{cid:lo.cid,credential:owner.assertion(lo.options.challenge)}})).status,200)
    assert.equal((await rec.req('GET','/api/account/passkeys',{cookie})).body.lastWayIn,true)
    const proof=async()=>{const o=(await rec.req('POST','/api/login/options',{body:{}})).body;return{cid:o.cid,credential:owner.assertion(o.options.challenge)}}
    const add=(await rec.req('POST','/api/account/passkeys/options',{cookie,body:await proof()})).body
    assert.equal((await rec.req('POST','/api/account/passkeys/verify',{cookie,body:{cid:add.cid,credential:extra.attestation(add.options.challenge),name:'Laptop'}})).status,200)
    assert.equal((await rec.req('POST','/api/account/passkeys/rename',{cookie,body:{id:extra.id,name:'Security key'}})).body.passkeys[1].name,'Security key')
    assert.equal((await rec.req('DELETE','/api/account/passkeys?id='+extra.id,{cookie,body:await proof()})).status,200)
    assert.deepEqual(h.db().creds.map(c=>c.id),[owner.id])
    assert.equal(h.db().users[0].id,uid)
    golden('S13-passkey-positive',rec.rows);recordings.push(JSON.stringify(rec.rows))
  }
  assert.equal(new Set(recordings).size,1)
}

export async function deviceLinkPositive(start: FlowServer = startServer) {
  const recordings: string[]=[]
  for(let run=0;run<3;run++) {
    const owner=softPasskey('S13-link-owner'),phone=softPasskey('S13-link-phone')
    const h=await start(undefined,{users:[user('u1','Synthetic athlete')],creds:[owner.row('u1')]}),rec=recorder(h),cookie=mintSession('u1')
    const login=(await rec.req('POST','/api/login/options',{body:{}})).body
    const made=await rec.req('POST','/api/account/device-link',{cookie,body:{cid:login.cid,credential:owner.assertion(login.options.challenge)}})
    const code=made.body.code
    assert.equal(made.status,200)
    assert.equal(h.db().deviceLinks[0].h.length,64)
    const opt=(await rec.req('POST','/api/device-link/options',{body:{code}})).body
    const done=await rec.req('POST','/api/device-link/verify',{body:{code,cid:opt.cid,credential:phone.attestation(opt.options.challenge),name:'Phone'}})
    assert.equal(done.status,200)
    assert.equal((await rec.req('GET','/api/me',{cookie:done.cookie})).body.user.id,'u1')
    assert.equal(h.db().creds[1].id,phone.id)
    assert.equal(h.db().deviceLinks.length,0)
    assert.equal((await rec.req('POST','/api/device-link/options',{body:{code}})).status,400)
    golden('S13-device-link-positive',rec.rows);recordings.push(JSON.stringify(rec.rows))
  }
  assert.equal(new Set(recordings).size,1)
}

