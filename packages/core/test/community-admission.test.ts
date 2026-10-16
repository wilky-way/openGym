import {expect,it} from 'vitest'
import {importProgramme} from '../src/programme-import'
import {planCommunityRepair,applyCommunityRepair} from '../src/community-conversion'
import {authoredSlots} from '../src/progression-engine'
import {activate} from '../src/programme'
import {finishProgrammeBlock} from '../src/programme-rollover'
import {EXIDX,canonicalExId} from '../src/exercises'
import {buildSessionEntries} from '../src/session-start'
function fixture(){
 const source:any={id:'synthetic-admission',name:'Synthetic',unit:'lb',length_weeks:1,rules:{frequency:1},source:{kind:'own',ref:'Synthetic',private:false},weeks:[{n:1,days:[{n:1,kind:'lift',exercises:[{id:'0025',name:'Synthetic Bench',slot:'bench',sets:[{count:2,reps:5,weight:999,rpe:8}],rules:[{kind:'progress',script:'lp(5lb)'}]}]}]}]}
 const definition=importProgramme(source).definition! as any
 return {source,definition,e:source.weeks[0].days[0].exercises[0],slot:authoredSlots(definition)[0]!.slot}
}
function blocked(f:ReturnType<typeof fixture>,options:any={}){
 const before=structuredClone(f),plan=planCommunityRepair(f.definition,f.source,options)
 expect(plan.status).toBe('blocked');expect(plan.issues.length).toBeGreaterThan(0)
 expect(()=>applyCommunityRepair(f.definition,f.source,plan,options)).toThrow('blocked');expect(f).toEqual(before)
}
it.each([
 {until_rpe:9},{pct:.9},{pct:90},{drop_pct:10},{from:'top_set'},{total_reps:25},{open_count:true},{kind:'backoff'},
 {count:[2,4]},{sets:4},{reps:[5,8]},{rpe:[7,9]},{rir:2},{amrap:'yes'},{kind:'amrap',amrap:false},
 {sec:60},{mode:'time'},{variations:[{reps:9}]},{when:'fatigued'},{unknownPrescription:5},{target:{pct:90}},{target:{rpe:7},rpe:8},
])('fresh source row semantics %j cannot be certified from stale straight rows',change=>{
 const f=fixture();Object.assign(f.e.sets[0],change);blocked(f)
})
it.each([{open:true},{minutes:10},{variations:[1,2]},{progression:{kind:'custom'}},{rest:'90-120s'},{superset:'pair'},{unknownPrescription:5},{target:{pct:90}}])('unsupported exercise semantics %j block repair',change=>{
 const f=fixture();Object.assign(f.e,change);blocked(f)
})
it.each(['id','reps','effort','count','row-order','native-percent'] as const)('rejects wrong native %s even with current source/definition hashes',kind=>{
 const f=fixture()
 if(kind==='id')f.slot.id='0032'
 if(kind==='reps'){f.slot.reps=10;f.slot.pyramid=[10,10]}
 if(kind==='effort')f.slot.setTargets![0]={rpe:7}
 if(kind==='count')f.slot.sets=1
 if(kind==='row-order'){f.e.sets=[{count:1,reps:5,rpe:8},{count:1,reps:8,rpe:7}];f.slot.pyramid=[8,5];f.slot.setTargets=[{rpe:7},{rpe:8}]}
 if(kind==='native-percent')f.slot.target={pct:90}
 blocked(f)
})
it.each(['other-id','same-id-other-slot','fractional','wrong-day','duplicate'] as const)('explicit source position cannot overrule native binding: %s',kind=>{
 const f=fixture(),ref=authoredSlots(f.definition)[0]!.ref
 const binding={ref,sourceWeek:'1',sourceDay:'1',sourcePosition:1}
 if(kind==='other-id'||kind==='same-id-other-slot')f.source.weeks[0].days[0].exercises.unshift({...structuredClone(f.e),id:kind==='other-id'?'0032':'0025',slot:'other',rules:[{kind:'progress',script:'lp(50lb)'}]})
 if(kind==='fractional')binding.sourcePosition=1.5
 if(kind==='wrong-day')binding.sourceDay='2'
 blocked(f,{bindings:kind==='duplicate'?[binding,binding]:[binding]})
})
it.each(['swapped','missing','duplicated'] as const)('source exercise order/coverage is exact: %s',kind=>{
 const f=fixture();f.source.weeks[0].days[0].exercises.push({...structuredClone(f.e),id:'0032',slot:'other',name:'Synthetic Other'})
 f.definition=importProgramme(f.source).definition! as any
 const ex=f.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex
 if(kind==='swapped')ex.reverse()
 if(kind==='missing')ex.pop()
 if(kind==='duplicated')ex[1]=structuredClone(ex[0])
 blocked(f)
})
it.each([{kind:'progress',script:'lp(5lb)',when:'fatigued'},{kind:'progress',script:'lp(5lb)',summary:'linear: add 50lb after 1 successful session(s)'}])('unknown or contradictory progression rule fields cannot grant support %j',rule=>{
 const f=fixture();f.e.rules=[rule];blocked(f)
})
it('valid straight LP remains executable and provenance/extensions stay opaque without personalizing sample loads',()=>{
 const f=fixture();Object.assign(f.e,{notes:'Synthetic note',extension:{keep:'exercise'}});f.e.sets[0].extension={keep:'row'};f.definition.extension={keep:'definition'};f.slot.extension={keep:'slot'}
 const before=structuredClone(f),initial=planCommunityRepair(f.definition,f.source),key=initial.slots[0]!.continuityKey!
 const options={athleteLoads:{[key]:100}},plan=planCommunityRepair(f.definition,f.source,options)
 expect(plan.issues).toEqual([]);expect(plan.status).toBe('reviewable')
 const d=applyCommunityRepair(f.definition,f.source,plan,options),state:any={unit:'lb',routines:[],workouts:[]};activate(state,d as any,{today:'2026-01-05'})
 const entry=buildSessionEntries(state,state.routines[0])[0]!
 expect(entry.sets.map(s=>[s.w,s.r])).toEqual([[100,5],[100,5]]);expect(entry.target.setTargets).toEqual([{rpe:8},{rpe:8}])
 expect(d.extension).toEqual({keep:'definition'});expect(authoredSlots(d)[0]!.slot.extension).toEqual({keep:'slot'});expect(f).toEqual(before)
})
it('contradictory explicit exercise binding cannot lend lp(50lb); exact original binding earns 100→105 on actual Repeat',()=>{
 const good=fixture(),binding={ref:authoredSlots(good.definition)[0]!.ref,sourceWeek:'1',sourceDay:'1',sourcePosition:1}
 const wrong=fixture();wrong.e.id='0032';wrong.e.rules[0].script='lp(50lb)'
 const refused=planCommunityRepair(wrong.definition,wrong.source,{bindings:[binding]})
 expect(refused.slots[0]!.reason).toContain('identity contradicts');expect(refused.status).toBe('blocked')
 expect(()=>applyCommunityRepair(wrong.definition,wrong.source,refused,{bindings:[binding]})).toThrow('blocked')
 // Exact retained RM shape: inserting another known exercise at the explicit position.
 const inserted=fixture();inserted.source.weeks[0].days[0].exercises.unshift({...structuredClone(inserted.e),id:'0032',slot:'other',rules:[{kind:'progress',script:'lp(50lb)'}]});blocked(inserted,{bindings:[binding]})
 const options={bindings:[binding],athleteLoads:{[planCommunityRepair(good.definition,good.source).slots[0]!.continuityKey!]:100}}
 const fixed=applyCommunityRepair(good.definition,good.source,planCommunityRepair(good.definition,good.source,options),options)
 const state:any={unit:'lb',routines:[],workouts:[]},cycle=activate(state,fixed as any,{today:'2026-01-05',cycleId:'binding'})
 const entry=buildSessionEntries(state,state.routines[0])[0]!
 expect(entry.sets.map(s=>s.w)).toEqual([100,100])
 state.workouts.push({id:'w',d:'2026-01-05',unit:'lb',entries:[{id:entry.id,occurrenceId:cycle.occurrences[0]!.instanceId,target:entry.target,sets:entry.sets.map(s=>({...s,done:true}))}]})
 cycle.occurrences[0]!.status='done';cycle.status='finished'
 const next=finishProgrammeBlock(state,cycle.id,'repeat',{today:'2026-01-12'})!
 const routine=state.routines.find((r:any)=>r.id===next.occurrences[0]!.routineId)
 expect(buildSessionEntries(state,routine)[0]!.sets.map(s=>s.w)).toEqual([105,105])
})
it.each(['canonical-alias','exact-name'] as const)('source identity permits independently resolved %s without guessing a native mapping',kind=>{
 const f=fixture()
 if(kind==='canonical-alias'){
  f.e.id='1019';f.e.name='Synthetic alias';f.definition=importProgramme(f.source).definition! as any
  expect(authoredSlots(f.definition)[0]!.slot.id).toBe(canonicalExId('1019'))
 }else{delete f.e.id;f.e.name=EXIDX['0025']!.n}
 expect(planCommunityRepair(f.definition,f.source).status).toBe('reviewable')
})
it.each(['exercise-prose','row-prose','update-conflict'] as const)('opaque metadata cannot conceal executable %s semantics',kind=>{
 const f=fixture()
 if(kind==='exercise-prose')f.e.instructions={until_rpe:9}
 if(kind==='row-prose')f.e.sets[0].instructions={pct:90}
 if(kind==='update-conflict')f.e.rules.push({kind:'update',script:'none',summary:'weights += 50lb'})
 blocked(f)
})
it.each([[{count:1,reps:5,rpe:8},{count:1,reps:8,rpe:8}],[{count:2,reps:6,rpe:8}]])('DP cannot certify source targets that its uniform lower-endpoint Start would discard: %j',(...rows)=>{
 const f=fixture();f.e.sets=rows;f.e.rules[0].script='dp(5lb, 5, 8)';f.definition=importProgramme(f.source).definition! as any
 blocked(f)
})
