import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from '../../server/src/app'
import { openStore, putUser, commitStateDoc } from '../../server/src/storage'
import { createAuth } from '../../server/src/auth'
import { DataService } from '../../server/src/data'
import { loadConfig } from '../../server/src/config'
import { progressionDisplay } from '../src/lib/progression-display'
import { p7Fixture } from '../test/regression-fixture'
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).reverse().forEach(close => close()))
function target(S: any) {
  const root = mkdtempSync(join(tmpdir(),'p7-preview-')), store = openStore(join(root,'server'))
  const now = () => Date.parse('2026-10-12T12:00:00Z')
  const user = {id:'synthetic',name:'Synthetic',created:'2026-10-12',admin:0,disabled:0,sv:0,invited_by:null,last_pull:null,last_reminder:null,last_nudge:null,ord:0,x:'{}'}
  putUser(store.db,user); commitStateDoc(store.db,user.id,JSON.stringify(S),now(),4)
  const config = loadConfig({DATA_DIR:store.dataDir,DEVICE_TOKENS:'1',ORIGIN:'http://localhost:8080'})
  const auth = createAuth(store.db,config,{now,address:()=> '127.0.0.1'})
  const data = new DataService(store.db,store.dataDir,{now,log:()=> {}})
  const app = createApp(config,{auth,data,now,log:()=> {},progression:{today:()=> '2026-10-12'}})
  const headers = {'content-type':'application/json',Authorization:`Bearer ${auth.mint(user,'agent')}`}
  cleanups.push(() => {store.close();rmSync(root,{recursive:true,force:true})})
  return {data,user,request:() => app.request('/api/progression/preview',{method:'POST',headers,body:JSON.stringify({source:{definition:S.programmes.cycles[0].snapshot},cycleId:'c',weeks:[1,2]})})}
}
for (const mode of ['base','rpe','bad-date','history','custom-assisted'] as const) test(`web Why and sets equal real progression API HTTP preview (${mode}); both documents stay byte-identical`, async () => {
  const S = {...p7Fixture(),_rev:4,_wid:'synthetic-read'}, c = S.programmes.cycles[0]
  if (mode === 'rpe') S.effort = 'rpe'
  if (mode === 'bad-date') S.workouts = [{d:'2026-02-30',opaque:'preserve'}]
  if (mode === 'history') S.workouts = [{id:'completed',d:'2026-10-12',entries:[{id:'0025',occurrenceId:c.occurrences[0].instanceId,target:{slotId:'bench'},sets:[{w:80,r:5,done:true}]}]}]
  if (mode === 'custom-assisted') {
    S.customEx = [{id:'synthetic-assisted',n:'Synthetic assisted',eq:'leverage machine',assisted:true}]
    c.snapshot.progressionRules = [{id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}]
    for (const w of c.snapshot.weeks) {const e = w.days[0].sessions[0].routineSnapshot.ex[0];e.id='synthetic-assisted';e.weight=100;e.progression.rules=['linear']}
    S.workouts = [{id:'completed',d:'2026-10-12',entries:[{id:'synthetic-assisted',occurrenceId:c.occurrences[0].instanceId,target:{slotId:'bench',sets:2,reps:5},sets:[{w:100,r:5,done:true},{w:100,r:5,done:true}]}]}]
  }
  const h = target(S), before = JSON.stringify(S), stored = JSON.stringify(h.data.get(h.user.id))
  const response = await h.request(); expect(response.status).toBe(200)
  const remote = await response.json(), local = progressionDisplay(S,c.snapshot,c,[1,2],'2026-10-12')!
  expect(local.result).toEqual(remote); expect(JSON.stringify(local.result)).toBe(JSON.stringify(remote))
  expect(JSON.stringify(S)).toBe(before); expect(JSON.stringify(h.data.get(h.user.id))).toBe(stored)
})

test('web and progression API refuse an invalid cycle date instead of rolling it into a prescription', async () => {
  const S = {...p7Fixture(),_rev:4,_wid:'synthetic-read'}, c=S.programmes.cycles[0];c.week1StartDate='2026-02-30'
  const h=target(S), before=JSON.stringify(S), stored=JSON.stringify(h.data.get(h.user.id))
  expect((await h.request()).status).toBe(422)
  const local=progressionDisplay(S,c.snapshot,c,[1,2],'2026-10-12')!
  expect(local.slots).toEqual([]);expect(local.result.error).toBeTruthy()
  expect(JSON.stringify(S)).toBe(before);expect(JSON.stringify(h.data.get(h.user.id))).toBe(stored)
})
