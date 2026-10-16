import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { stampPut, highestStamp, mergeEdits, type SyncRecord, type StampReport } from '../src/server-stamp'
// @ts-expect-error Frozen JS oracle has no TS declarations; allowed only in differential tests.
import * as legacy from '../../../packages/parity/fixtures/oracle/api/sync-stamps.js'
// Frozen client oracle is declared by K10 test-only legacy-sync.d.ts; named drifts stay covered.
import * as client from '../../../packages/parity/fixtures/oracle/frontend/src/lib/sync-merge.js'

const scalar = fc.oneof(fc.integer({min:-1000,max:2000}),fc.string({maxLength:8}),fc.boolean(),fc.constant(null))
const stamp = fc.oneof(fc.integer({min:-1000,max:2000}),fc.constantFrom('20',null))
const clocks = fc.dictionary(fc.constantFrom('name','ex','status','weekIndex','queue','restSec','future','_wid','_wids'),stamp,{maxKeys:4})
const extras = fc.dictionary(fc.constantFrom('future','unknownSetting','accentCustom','lastEffortScale'),fc.jsonValue({maxDepth:2}),{maxKeys:3})
const exercise = fc.record({id:fc.constantFrom('sq','bench','sq'),sets:fc.integer({min:1,max:4}),reps:scalar,pyramid:fc.array(scalar,{maxLength:3})})
const entry = fc.record({id:fc.constantFrom('r','s','w'),name:scalar,_ts:stamp,_f:clocks,_u:fc.constant({name:[0,30,30]}),ex:fc.array(exercise,{maxLength:3})})
const occurrence = fc.record({instanceId:fc.constantFrom('one','two'),routineId:fc.constantFrom('r','s'),status:fc.constantFrom('pending','done','skipped'),weekIndex:fc.constantFrom(1,2),_ts:stamp,_f:clocks})
const cycle = fc.record({id:fc.constantFrom('c','d'),status:fc.constantFrom('active','paused','finished','archived'),programmeId:fc.constantFrom('a','b'),since:fc.integer({min:0,max:100}),weekIndex:fc.constantFrom(1,2),occurrences:fc.array(occurrence,{maxLength:2}),_ts:stamp,_f:clocks})
const programmes = fc.record({definitions:fc.array(fc.record({id:fc.constantFrom('a','b'),name:scalar,_ts:stamp,_f:clocks}),{maxLength:2}),cycles:fc.array(cycle,{maxLength:2})})
const doc = fc.tuple(extras,fc.record({
 _ts:stamp,restSec:scalar,edited:clocks,deleted:fc.record({routines:clocks,workouts:clocks,favEx:clocks}),
 routines:fc.oneof(fc.array(entry,{maxLength:3}),fc.constant(null),fc.constant({legacy:true})),
 workouts:fc.array(fc.record({id:fc.constantFrom('w','v'),d:fc.constant('2026-10-01'),start:stamp,end:stamp,entries:fc.array(fc.record({id:fc.constant('sq'),occurrenceId:fc.constantFrom('one','two'),sets:fc.array(fc.record({w:scalar,r:scalar}),{maxLength:2})}),{maxLength:2})}),{maxLength:2}),
 bodyweight:fc.array(fc.record({d:fc.constant('2026-10-01'),t:stamp}),{maxLength:2}),
 week:fc.dictionary(fc.constantFrom('1','2'),scalar),queue:fc.oneof(fc.constant(null),fc.record({ids:fc.array(fc.constantFrom('r','s'),{maxLength:2}),programmeCycleId:fc.constantFrom('c','d')})),
 resetAt:fc.constantFrom(0,10,100),resetIds:fc.constant({programmeDefinitions:['a'],programmeCycles:['c']}),
 programmes:fc.option(programmes,{nil:undefined}),
 plates:fc.record({kg:fc.record({_ts:stamp,value:scalar})}),
 _unstamped:fc.constant({fp:'none',ed:{restSec:10}}),_prior:fc.constant({restSec:['u'], 'routines|r|name':['u']}),
}),fc.boolean()).map(([extra,fields,omit]) => {
 const out: SyncRecord = {...extra,...fields}
 if(omit){delete out.edited;delete out.programmes;delete out.resetIds}
 return JSON.parse(JSON.stringify(out)) as SyncRecord
})

function compare(cur: SyncRecord | null, next: SyncRecord, flags: {stamped:boolean;overRead:boolean;now:number}) {
 const oldCur=structuredClone(cur),newCur=structuredClone(cur),oldNext=structuredClone(next),newNext=structuredClone(next)
 const oldReport: StampReport={},newReport: StampReport={}
 legacy.stampPut(oldCur,oldNext,{...flags,report:oldReport})
 const result=stampPut(newCur,newNext,{...flags,report:newReport})
 expect(result).toBe(newNext)
 expect(newNext).toEqual(oldNext)
 expect(JSON.stringify(newNext)).toBe(JSON.stringify(oldNext))
 expect(newReport).toEqual(oldReport)
 expect(JSON.stringify(newReport)).toBe(JSON.stringify(oldReport))
 expect(newCur).toEqual(oldCur)
 return newNext
}

describe('server stamper differential parity',()=>{
 it('100,000 seeded cur/next/flag cases preserve bytes and report.changed',()=>{
  fc.assert(fc.property(fc.option(doc,{nil:null}),doc,fc.record({stamped:fc.boolean(),overRead:fc.boolean(),now:fc.integer({min:0,max:3000})}),
   (cur,next,flags)=>{compare(cur,next,flags)}),{seed:170013,numRuns:100_000})
 },120_000)
 it('repeated writes retain private history and do not mutate the stored input',()=>{
  fc.assert(fc.property(doc,fc.array(doc,{minLength:2,maxLength:5}),(cur,updates)=>{
   for(const [i,next] of updates.entries()) cur=compare(cur,next,{stamped:i%2===0,overRead:true,now:3000+i})
  }),{seed:170014,numRuns:1000})
 })
 it('existing manifests are consumed even with offload producers disabled',()=>{
  const cur={programmes:{definitions:[{id:'a'}],cycles:[],offloaded:{a:{versionId:'sha256:a',at:50}}}}
  const next=structuredClone(cur),report:StampReport={}
  stampPut(cur,next,{stamped:false,overRead:true,now:100,report})
  expect(next.programmes.definitions).toEqual([])
  expect(next.programmes.offloaded).toEqual(cur.programmes.offloaded)
  expect(report.changed).toBe(true)
 })
})

describe('R5 intentional server/client drifts',()=>{
 it('server highestStamp ignores weigh-in and measurement t; client includes them',()=>{
  const doc={_ts:1,bodyweight:[{d:'2026-10-01',t:500}],measurements:[{d:'2026-10-01',t:600}]}
  expect(highestStamp(doc)).toBe(1)
  expect(client.highestStamp(doc)).toBe(600)
 })
 it('server retains old setting stamps; only the client prunes at 180 days',()=>{
  const now=1_800_000_000_000,doc: SyncRecord={_ts:now,edited:{restSec:1},restSec:60}
  stampPut(doc,structuredClone(doc),{stamped:true,now})
  expect(mergeEdits(doc.edited,{})).toEqual({restSec:1})
  const edited=client.stampEdits(doc,{...doc,restSec:90},now).edited
  expect(edited.restSec).toBe(now)
  const settings: SyncRecord={_ts:now,edited:{'dayPlan.2026-01-01':1,sound:now},sound:true}
  expect(client.stampEdits(settings,{...structuredClone(settings),sound:false},now).edited['dayPlan.2026-01-01']).toBeUndefined()
  expect(mergeEdits(settings.edited,{sound:now})).toEqual({'dayPlan.2026-01-01':1,sound:now})
 })
 it('server programme field merge ignores Undo markers while the client honours them',()=>{
  const a={id:'a',name:'undo',_ts:30,_f:{name:30},_u:{name:[10,30,30]}}
  const b={id:'a',name:'concurrent',_ts:20,_f:{name:20}}
  const next: SyncRecord={programmes:{definitions:[a],cycles:[]}}
  stampPut({programmes:{definitions:[b],cycles:[]}},next,{stamped:true,now:100})
  expect(next.programmes.definitions[0].name).toBe('undo')
  expect(client.mergeEntry(a,b).name).toBe('concurrent')
 })
})
