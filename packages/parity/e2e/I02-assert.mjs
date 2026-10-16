import fs from 'node:fs'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
export function assertI02Evidence(read) {
const cutovers=read('timed-cutovers.json'),sw=read('timed-sw.json'),auth=read('timed-auth.json')
const step=(rows,name)=>{const row=rows.find(r=>r.name===name);assert(row&&row.seconds>=0,'missing timed proof: '+name);return row.result}
assert(step(cutovers,'boot-before-reconcile-refused').refused)
assert(step(cutovers,'second-boot-before-reconcile-refused').refused)
const lastCount=step(cutovers,'cutover-A-third-time').legacyWorkoutCount
assert(lastCount>=2&&lastCount===step(cutovers,'second-legacy-workout').workouts)
for(const name of ['rollback-A','code-rollback-after-B'])assert(step(cutovers,name).verified&&step(cutovers,name).legacyBooted&&step(cutovers,name).workerComplete)
assert(step(cutovers,'legacy-workout-after-rollback').synced)
assert(step(cutovers,'second-legacy-workout').synced&&lastCount===step(cutovers,'legacy-workout-after-rollback').workouts+1)
assert(step(cutovers,'cutover-B').moved===82)
assert(step(cutovers,'rollback-B').definitionsEqual&&step(cutovers,'rollback-B').newWorkoutPreserved)
assert(step(sw,'partial-install').legacyShellPreserved&&step(sw,'partial-install').failedNewInstall)
assert(step(sw,'upgrade-old-tab-lazy-chunks').onlineQrFirstUse&&step(sw,'upgrade-old-tab-lazy-chunks').offlineMediaFirstUse)
assert(step(sw,'second-upgrade-two-generations').generations.length===2&&step(sw,'second-upgrade-two-generations').priorRewriteLazyOffline)
assert(step(sw,'second-reload-prunes-previous').previousPruned)
assert(step(sw,'reload-handshake-prunes-previous').previousPruned&&step(sw,'reload-handshake-prunes-previous').unrelatedCachePreserved)
assert(step(sw,'return-to-shipped-image').shippedBuildRestored)
assert(step(auth,'register-recovery-passkey').registered)
assert(step(auth,'auth-cutover-A').passkeyLogin&&step(auth,'auth-cutover-A').v2)
assert(step(auth,'auth-rollback-A').passkeyLogin&&step(auth,'auth-rollback-A').v2===false)
assert(step(auth,'v2-carrier-refused-by-legacy').legacyRefusesV2&&step(auth,'v2-carrier-refused-by-legacy').status===401)
assert(step(auth,'legacy-agent-repair').paired&&step(auth,'legacy-agent-repair').v2===false&&step(auth,'legacy-agent-repair').readStatus===200)
assert(step(auth,'auth-boot-before-reconcile-refused').refused)
assert(step(auth,'auth-re-upgrade').reconciled&&step(auth,'auth-re-upgrade').integrity==='ok')
assert(step(auth,'auth-phone-re-login').passkeyLogin&&step(auth,'auth-phone-re-login').v2)
for(const rows of [cutovers,auth]){const renewed=step(rows,'v2-agent-renewal');assert(renewed.legacyBearerAccepted&&renewed.v2Issued)}
assert(read('renewal-read.json').renewedReadStatus===200)
const repaired=step(cutovers,'new-agent-repair');assert(repaired.paired&&repaired.readStatus===200&&repaired.v2)
assert(read('get-comparison.json').byteEqual)
assert(read('week-comparison.json').byteEqualAfterWriterIdNormalization)
const cold=read('cold-reopen.json').data.result
assert(cold.offlineColdOpen&&cold.controlled&&cold.unknownFieldPreserved&&cold.workouts===lastCount&&cold.buildCaches.length===1)
const guard=read('scratch-guards.json');assert(guard.symlinkRefused&&guard.hardlinkRefused&&guard.outsideBytesUnchanged)
const smoke=read('container-smoke.json');assert(smoke.status==='PASS'&&smoke.healthchecks&&smoke.runtimePayloadPublic&&smoke.compiledExecutableOnly&&smoke.proxySecurityHeaders&&smoke.apiNoopPut.putStatus===200&&smoke.apiNoopPut.revisionAdvanced&&smoke.integrity.mirrorsEqual&&smoke.integrity.integrity==='ok')
assert(read('redirected-shell.json').data.result.workingShellPreserved&&read('redirected-shell.json').data.result.redirected)
}
if(import.meta.main){
 const index=process.argv.indexOf('--evidence-dir')
 assert(index>=0&&process.argv[index+1], 'Measured I02 receipts required: --evidence-dir <owned receipt directory>; synthetic checker inputs are not integration proof')
 const root=resolve(process.argv[index+1])
 const read=name=>JSON.parse(fs.readFileSync(join(root,name),'utf8'))
 assertI02Evidence(read);console.log('I02 supplied receipt validation: PASS (receipt provenance and actual execution require separate review)')
}
