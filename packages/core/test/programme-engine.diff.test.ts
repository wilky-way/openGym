import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import * as engine from '../src/programme'
import * as lifecycle from '../src/programme-lifecycle'
import * as today from '../src/programme-today'
import * as importer from '../src/programme-import'
import { refreshProgrammeDefinitions } from '../src/programme-refresh'
import * as agent from '../src/programme-agent'
import type { ProgrammeState, ProgrammeDefinition } from '../src/programme-engine-types'
// @ts-expect-error Frozen JS oracle has no declarations; differential-only.
import * as oldEngine from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme.js'
// @ts-expect-error Frozen JS oracle has no declarations; differential-only.
import * as oldLifecycle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-lifecycle.js'
// @ts-expect-error Frozen JS oracle has no declarations; differential-only.
import * as oldToday from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-today.js'
// @ts-expect-error Frozen JS oracle has no declarations; differential-only.
import * as oldImporter from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-import.js'
// @ts-expect-error Frozen JS oracle has no declarations; differential-only.
import { refreshProgrammeDefinitions as oldRefresh } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-refresh.js'
// @ts-expect-error Frozen JS oracle has no declarations; differential-only.
import * as oldAgent from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-agent.js'

const TODAY='2026-10-12'
const runs={seed:120012,numRuns:Number(process.env.PARITY_RUNS ?? 1000)}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));vi.spyOn(Math,'random').mockReturnValue(.125)})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
const outcome=(fn:()=>unknown)=>{try{return {value:fn()}}catch(error){return {error:(error as Error).message,name:(error as Error).name}}}
function equal(next:()=>unknown,old:()=>unknown){const n=outcome(next),o=outcome(old);expect(n).toEqual(o);expect(JSON.stringify(n)).toBe(JSON.stringify(o))}
function draft():ProgrammeState{return {unit:'lb',routines:[],workouts:[],dayPlan:{},unknown:{retained:1}}}
const shape=fc.record({start:fc.integer({min:1,max:8}),weeks:fc.integer({min:1,max:4}),days:fc.integer({min:1,max:4}),sets:fc.integer({min:1,max:8}),reps:fc.integer({min:1,max:15}),load:fc.integer({min:0,max:200}),rir:fc.integer({min:0,max:10}),unit:fc.constantFrom<'kg'|'lb'>('kg','lb'),second:fc.boolean()})
function definition(p:{start:number;weeks:number;days:number;sets:number;reps:number;load:number;rir:number;unit:'kg'|'lb';second:boolean}):ProgrammeDefinition{return {id:'synthetic',name:'Synthetic block',short:'SYN',unit:p.unit,unknown:{keep:true},weeks:Array.from({length:p.weeks},(_,w)=>({index:p.start+w,mode:w===p.weeks-1?'deload':'train',rir:p.rir,days:Array.from({length:p.days},(_,d)=>({key:`d${d+1}`,ordinal:d+1,sessions:Array.from({length:p.second?2:1},(_,s)=>({sessionTemplateId:`d${d+1}s${s+1}`,routineSnapshot:{name:'Synthetic',prog:'double',ex:[{id:'0025',sets:p.sets,reps:p.reps,weight:p.load,target:{rir:p.rir},unknown:'keep'}]}}))}))}))}}

it('activate, shift, pin, skip, deload and rollover match legacy drafts and key order',()=>{
 fc.assert(fc.property(shape,p=>{
  const d=definition(p),n=draft(),o=draft()
  equal(()=>engine.activate(n,d,{cycleId:'c',today:TODAY,now:10}),()=>oldEngine.activate(o,d,{cycleId:'c',today:TODAY,now:10}))
  equal(()=>n,()=>o)
  equal(()=>engine.shiftNotToday(n,'c',TODAY),()=>oldEngine.shiftNotToday(o,'c',TODAY))
  const id=n.programmes!.cycles[0]!.occurrences[0]!.instanceId
  equal(()=>engine.pin(n,'c',id,'2026-10-15',TODAY),()=>oldEngine.pin(o,'c',id,'2026-10-15',TODAY))
  equal(()=>engine.insertDeload(n,'c',{key:'synthetic'}),()=>oldEngine.insertDeload(o,'c',{key:'synthetic'}))
  equal(()=>engine.skip(n,'c',id,{today:TODAY,now:20,reason:'synthetic'}),()=>oldEngine.skip(o,'c',id,{today:TODAY,now:20,reason:'synthetic'}))
  for(const occ of n.programmes!.cycles[0]!.occurrences.slice(1)){
   equal(()=>engine.skip(n,'c',occ.instanceId,{today:TODAY,now:30}),()=>oldEngine.skip(o,'c',occ.instanceId,{today:TODAY,now:30}))
   equal(()=>n,()=>o)
  }
  expect(n.programmes!.cycles[0]!.status).toBe('finished');expect(n.queue).toBeNull()
 }),runs)
},60000)

it('lifecycle switch/archive, paused resume and repeated stages match legacy atomically',()=>{
 fc.assert(fc.property(shape,p=>{
  const d=definition(p),n=draft(),o=draft(),opts={cycleId:'c',today:TODAY,now:10}
  equal(()=>lifecycle.startProgramme(n,d,opts),()=>oldLifecycle.startProgramme(o,d,opts))
  equal(()=>engine.pause(n,'c',TODAY),()=>oldEngine.pause(o,'c',TODAY))
  equal(()=>lifecycle.resumeProgramme(n,'c',{today:'2026-10-13',now:20}),()=>oldLifecycle.resumeProgramme(o,'c',{today:'2026-10-13',now:20}))
  equal(()=>today.shiftPreview(n,'c','2026-10-13'),()=>oldToday.shiftPreview(o,'c','2026-10-13'))
  equal(()=>today.repeatProgrammeWeek(n,'c','2026-10-19'),()=>oldToday.repeatProgrammeWeek(o,'c','2026-10-19'))
  equal(()=>n,()=>o)
  const next=n.programmes!.cycles[1]!.id
  equal(()=>lifecycle.switchProgramme(n,next,{...d,id:'replacement'},{cycleId:'replacement',today:'2026-10-20'}),()=>oldLifecycle.switchProgramme(o,next,{...d,id:'replacement'},{cycleId:'replacement',today:'2026-10-20'}))
  equal(()=>lifecycle.endProgramme(n,'replacement',{today:'2026-10-20'}),()=>oldLifecycle.endProgramme(o,'replacement',{today:'2026-10-20'}))
  equal(()=>n,()=>o)
 }),runs)
},60000)

const source=fc.record({count:fc.integer({min:1,max:30}),reps:fc.integer({min:1,max:20}),weight:fc.integer({min:0,max:300}),rpe:fc.integer({min:1,max:10}),private:fc.boolean(),percentage:fc.boolean(),unknown:fc.boolean()})
it('import, refresh and agent display retain prescriptions, errors, privacy and byte order',()=>{
 fc.assert(fc.property(source,p=>{
  const raw={id:'synthetic',name:'Synthetic import',unit:'lb',source:{private:p.private},weeks:[{n:1,days:[{n:1,exercises:[{id:p.unknown?'unknown-synthetic':'0025',name:'Synthetic',sets:[{count:p.count,reps:p.reps,weight:p.weight,rpe:p.rpe,...(p.percentage?{pct:65}:{})}]}]}]}]}
  equal(()=>importer.importProgramme(raw),()=>oldImporter.importProgramme(raw))
  equal(()=>refreshProgrammeDefinitions(draft(),[{raw,filename:'synthetic.json'}]),()=>oldRefresh(draft(),[{raw,filename:'synthetic.json'}]))
  const n=draft(),o=draft(),a=importer.importProgramme(raw),b=oldImporter.importProgramme(raw)
  equal(()=>importer.saveImportedProgramme(n,a),()=>oldImporter.saveImportedProgramme(o,b))
  equal(()=>n,()=>o)
  if(!p.unknown){n.effort='rpe';o.effort='rpe';equal(()=>agent.getProgramme(n,{programmeId:'synthetic'}),()=>oldAgent.getProgramme(o,{programmeId:'synthetic'}))}
 }),runs)
},60000)

it('malformed imports and stale or in-session lifecycle changes fail exactly as legacy',()=>{
 const bad:unknown[]=[null,{},42,'null','[]',{id:'synthetic',weeks:[]},{id:'synthetic',name:'Synthetic',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',sets:[{count:101,reps:5}]}]}]}]}]
 for(const raw of bad)equal(()=>importer.importProgramme(raw),()=>oldImporter.importProgramme(raw))
 const d=definition({start:1,weeks:2,days:2,sets:3,reps:8,load:100,rir:2,unit:'lb',second:false})
 const n=draft(),o=draft();n.active={id:'live'};o.active={id:'live'}
 equal(()=>lifecycle.startProgramme(n,d,{today:TODAY}),()=>oldLifecycle.startProgramme(o,d,{today:TODAY}));equal(()=>n,()=>o)
 n.active=null;o.active=null
 equal(()=>lifecycle.endProgramme(n,'missing',{today:TODAY}),()=>oldLifecycle.endProgramme(o,'missing',{today:TODAY}));equal(()=>n,()=>o)
})
