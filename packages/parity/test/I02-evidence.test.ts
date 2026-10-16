import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
// @ts-expect-error -- integration CLI is JavaScript; this regression invokes its actual exported checker.
import { assertI02Evidence } from '../e2e/I02-assert.mjs'
// Invented complete input for the checker. These values do not certify an integration run.
const evidence=JSON.parse(readFileSync(new URL('./fixtures/I02-synthetic-checker.json',import.meta.url),'utf8')).evidence
describe('I02 synthetic checker rejects failed or missing cutover proofs',()=>{
  it('accepts the explicitly synthetic complete checker input',()=>{expect(()=>assertI02Evidence((name:string)=>evidence[name])).not.toThrow()})
  const mutations=[
    ['timed-sw.json','partial-install','failedNewInstall',false],
    ['timed-sw.json','second-upgrade-two-generations','priorRewriteLazyOffline',false],
    ['timed-sw.json','second-reload-prunes-previous','previousPruned',false],
    ['timed-sw.json','reload-handshake-prunes-previous','previousPruned',false],
    ['timed-auth.json','auth-cutover-A','passkeyLogin',false],
    ['timed-auth.json','auth-rollback-A','v2',true],
    ['timed-auth.json','auth-phone-re-login','passkeyLogin',false],
    ['timed-auth.json','v2-carrier-refused-by-legacy','status',200],
    ['timed-auth.json','legacy-agent-repair','readStatus',401],
    ['timed-auth.json','v2-agent-renewal','v2Issued',false],
    ['timed-cutovers.json','v2-agent-renewal','legacyBearerAccepted',false],
    ['timed-cutovers.json','new-agent-repair','v2',false],
    ['timed-cutovers.json','new-agent-repair','readStatus',401],
  ] as const
  it.each(mutations)('rejects %s %s with failed %s', (file,row,key,value)=>{
    const copy=structuredClone(evidence)
    copy[file].find((r:{name:string})=>r.name===row).result[key]=value
    expect(()=>assertI02Evidence((name:string)=>copy[name])).toThrow()
  })
  it.each([['timed-auth.json','v2-agent-renewal'],['timed-cutovers.json','new-agent-repair'],['timed-sw.json','second-reload-prunes-previous']])('rejects missing %s %s',(file,row)=>{
    const copy=structuredClone(evidence);copy[file]=copy[file].filter((r:{name:string})=>r.name!==row)
    expect(()=>assertI02Evidence((name:string)=>copy[name])).toThrow()
  })
})

it('runbook deletes the bearer curl configuration immediately after the export', () => {
 const runbook = readFileSync(new URL('../e2e/I02-export.md', import.meta.url), 'utf8')
 expect(runbook).toMatch(/curl --fail[^\n]+api-data-before\.json"\n\s+rm -f "\$CUTOVER_DIR\/curl\.conf"/)
})

it('retains the historical 82 target and refuses invalid timing',()=>{
 for(const moved of [0,81,83]){const copy=structuredClone(evidence);copy['timed-cutovers.json'].find((r:{name:string})=>r.name==='cutover-B').result.moved=moved;expect(()=>assertI02Evidence((name:string)=>copy[name])).toThrow()}
 for(const seconds of [-1,undefined]){const copy=structuredClone(evidence);copy['timed-sw.json'][0].seconds=seconds;expect(()=>assertI02Evidence((name:string)=>copy[name])).toThrow()}
})
