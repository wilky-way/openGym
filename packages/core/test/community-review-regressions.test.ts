import { expect, it } from 'vitest'
import type { OpenGymProgrammeDefinition } from '../../contract/domain/programme-model.generated'
import type { ProgrammeDefinition } from '../src/programme-engine-types'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'
import { preview, authoredSlots, type EngineInput } from '../src/progression-engine'
import { importProgramme } from '../src/programme-import'
import { planCommunityRepair, applyCommunityRepair } from '../src/community-conversion'
import { activate } from '../src/programme'
import { finishProgrammeBlock } from '../src/programme-rollover'
import { buildSessionEntries } from '../src/session-start'

function previewFixture() {
  const definition=syntheticProgramme(), opted=syntheticSlot(definition)
  opted.weight=100;opted.progression.rules=['lp']
  definition.progressionRules=[{id:'lp',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}]
  const ordinary=structuredClone(opted);ordinary.slotId='ordinary'
  definition.weeks[0].days[0].sessions[0].routineSnapshot.ex.push(ordinary)
  const cycle:any={id:'c',programmeId:definition.id,weekIndex:1,week1StartDate:'2026-01-05',occurrences:[{instanceId:'o',weekIndex:1,dayKey:'d1',sessionTemplateId:'main',ordinal:1,routineId:'r',status:'done'}]}
  const input:EngineInput={definition,cycle,historyCycles:[cycle],weeks:[1],asOf:'2026-01-09',profile:{unit:'lb',effortScale:'rir'},logs:[{id:'w',d:'2026-01-05',unit:'lb',start:1,entries:['bench','ordinary'].map(slotId=>({id:'0025',occurrenceId:'o',target:{slotId,sets:2,reps:5},sets:[{w:100,r:5,done:true},{w:100,r:5,done:true}]}))}]}
  return {definition,opted,ordinary,input}
}
it('F1: an unrelated opt-in slot never widens ordinary historical preview history',()=>{
  const {opted,input}=previewFixture()
  const loads=()=>preview(input).weeks[0]!.slots.map(s=>s.sets[0]!.load)
  expect(loads()).toEqual([100,100])
  opted.progression.parameters={continuityKey:'bench'}
  const before=structuredClone(input)
  expect(loads()).toEqual([105,100]);expect(input).toEqual(before)
  input.asOf='2026-01-04';expect(loads()).toEqual([100,100])
})
it('F1: a key on an incompatible rule never grants live history or contaminates the TM timeline',()=>{
  const {opted,input}=previewFixture()
  opted.progression.parameters={continuityKey:'not-compatible'}
  opted.progression.onStall='tm-reset';opted.tm={key:'bench',percentages:[1,1],reference:'tm'}
  ;(input.definition as any).tmSeeds={bench:{value:100,unit:'lb'}}
  ;(input.definition as any).progressionRules.push({id:'tm-reset',kind:'stall',after:2,action:{kind:'reset',pct:0.9},appliesTo:'tm'})
  let timelineExposures=-1
  const out=preview(input,{timeline:(_input,_slots,exposures,tm)=>{timelineExposures=exposures.length;return tm}})
  expect(out.error).toBeUndefined();expect(out.weeks[0]!.slots.map(s=>s.sets[0]!.load)).toEqual([100,100]);expect(timelineExposures).toBe(0)
})
it('F1: ordinary current-week load errors remain outside its preview context and prescription date extensions survive',()=>{
  const {opted,input}=previewFixture();opted.progression.parameters={continuityKey:'bench'}
  ;(input.logs[0] as any).entries[1].sets[0].w=Infinity
  const withDate={...input,prescriptionAsOf:'2026-01-09'}
  let date:unknown
  const out=preview(withDate,{timeline:(x,_slots,_exposures,tm)=>{date=(x as typeof withDate).prescriptionAsOf;return tm}})
  expect(out.error).toBeUndefined();expect(out.weeks[0]!.slots.map(s=>s.sets[0]!.load)).toEqual([105,100]);expect(date).toBe('2026-01-09')
})

function amrapSource(sets: any[]) {
  return {id:'synthetic-amrap-review',name:'Synthetic AMRAP Review',unit:'lb',length_weeks:1,rules:{frequency:1},source:{kind:'own',ref:'synthetic',private:false},weeks:[{n:1,days:[{n:1,kind:'lift',exercises:[{id:'0025',slot:'bench',name:'Synthetic Bench',sets,rules:[{kind:'progress',script:'lp(5lb, 1, 0, 10%, 2, 0)'}]}]}]}]}
}
it.each([
  {rows:[{count:2,reps:5,amrap:true,kind:'amrap',weight:100,rpe:8}],mins:[5,5],reps:[7,8]},
  {rows:[{count:1,reps:6,weight:100,rpe:8},{count:1,reps:5,amrap:true,kind:'amrap',weight:100,rpe:8}],mins:[null,5],reps:[6,8]},
  {rows:[{count:1,reps:3,amrap:true,weight:100,rpe:8},{count:1,reps:7,amrap:true,weight:100,rpe:8}],mins:[3,7],reps:[4,8]},
])('F2: source AMRAP minima survive repair, actual rows and two successful repeat cycles: $mins',({rows,mins,reps})=>{
  const source=amrapSource(rows), definition=importProgramme(source).definition! as any
  definition.extension={keep:'definition'};authoredSlots(definition)[0]!.slot.extension={keep:'slot'}
  const original=structuredClone({source,definition}), initial=planCommunityRepair(definition,source)
  const options={athleteLoads:{[initial.slots[0]!.continuityKey!]:100}},plan=planCommunityRepair(definition,source,options)
  expect(plan.status).toBe('reviewable');expect(plan.issues).toEqual([])
  const repaired=applyCommunityRepair(definition,source,plan,options),a=authoredSlots(repaired)[0]!
  expect(a.slot.setRepsMin).toEqual(mins);expect(a.slot.extension).toEqual({keep:'slot'});expect({source,definition}).toEqual(original)
  const state:any={unit:'lb',routines:[],workouts:[]}
  let cycle=activate(state,repaired as any,{today:'2026-01-05',cycleId:'amrap-cycle'})
  for (const [lap,date] of ['2026-01-05','2026-01-12','2026-01-19'].entries()) {
    const occurrence=cycle.occurrences[0]!,routine=state.routines.find((r:any)=>r.id===occurrence.routineId),entry=buildSessionEntries(state,routine)[0]!
    expect(entry.sets.map(s=>s.w)).toEqual([100+lap*5,100+lap*5]);expect(entry.target.setRepsMin).toEqual(mins)
    if(lap===2) break
    state.workouts.push({id:`w${lap}`,d:date,unit:'lb',entries:[{id:a.slot.id,occurrenceId:occurrence.instanceId,target:entry.target,sets:reps.map(r=>({w:100+lap*5,r,done:true}))}]})
    occurrence.status='done';cycle.status='finished'
    cycle=finishProgrammeBlock(state,cycle.id,'repeat',{today:lap===0?'2026-01-12':'2026-01-19'}) as typeof cycle
  }
})
it.each([
  {rows:[{count:2,reps:'max',amrap:true,rpe:8}]},
  {rows:[{count:2,reps:5,amrap:true,reps_min:0,rpe:8}]},
  {rows:[{count:2,reps:5,amrap:true,reps_min:Infinity,rpe:8}]},
])('F2: an unprovable numeric AMRAP success floor blocks guarded repair %j',({rows})=>{
  const source=amrapSource([{count:2,reps:5,amrap:true,rpe:8}]),definition=importProgramme(source).definition! as any
  source.weeks[0]!.days[0]!.exercises[0]!.sets=rows
  // The unsafe imported representation has no useful floor; source binding must prove it.
  expect(definition).toBeTruthy()
  const plan=planCommunityRepair(definition,source)
  expect(plan.status).toBe('blocked');expect(plan.slots[0]!.status).toBe('unsupported')
  expect(()=>applyCommunityRepair(definition,source,plan)).toThrow('blocked')
})
it('F2: source AMRAP minima override display reps, and actual misses still hold then reset',()=>{
  const source=amrapSource([{count:2,reps:8,reps_min:5,amrap:true,rpe:8}]),definition=importProgramme(source).definition! as unknown as OpenGymProgrammeDefinition
  const initial=planCommunityRepair(definition,source),options={athleteLoads:{[initial.slots[0]!.continuityKey!]:100}}
  const repaired=applyCommunityRepair(definition,source,planCommunityRepair(definition,source,options),options)
  const state:any={unit:'lb',routines:[],workouts:[]}
  let cycle=activate(state,repaired as unknown as ProgrammeDefinition,{today:'2026-01-05',cycleId:'amrap-misses'})
  for (const [lap,date] of ['2026-01-05','2026-01-12','2026-01-19'].entries()) {
    const occurrence=cycle.occurrences[0]!,routine=state.routines.find((r:any)=>r.id===occurrence.routineId),entry=buildSessionEntries(state,routine)[0]!
    expect(entry.target.setRepsMin).toEqual([5,5]);expect(entry.sets.map(s=>s.w)).toEqual(lap===2 ? [90,90] : [100,100])
    if(lap===2) break
    state.workouts.push({id:`miss-${lap}`,d:date,unit:'lb',entries:[{id:'0025',occurrenceId:occurrence.instanceId,target:entry.target,sets:[{w:100,r:4,done:true},{w:100,r:8,done:true}]}]})
    occurrence.status='done';cycle.status='finished'
    cycle=finishProgrammeBlock(state,cycle.id,'repeat',{today:lap===0?'2026-01-12':'2026-01-19'}) as typeof cycle
  }
})
it('F2: mismatched mixed rows and double rules cannot certify lossy AMRAP conversion',()=>{
  const source=amrapSource([{count:1,reps:6,rpe:8},{count:1,reps:5,amrap:true,rpe:8}]),definition=importProgramme(source).definition! as unknown as OpenGymProgrammeDefinition
  authoredSlots(definition)[0]!.slot.pyramid![0]=7
  expect(planCommunityRepair(definition,source).status).toBe('blocked')
  const doubleSource=amrapSource([{count:2,reps:5,amrap:true,rpe:8}])
  doubleSource.weeks[0]!.days[0]!.exercises[0]!.rules[0]!.script='dp(5lb, 5, 8)'
  const doubleDefinition=importProgramme(doubleSource).definition! as unknown as OpenGymProgrammeDefinition,plan=planCommunityRepair(doubleDefinition,doubleSource)
  expect(plan.status).toBe('blocked');expect(plan.slots[0]!.reason).toContain('AMRAP')
  expect(()=>applyCommunityRepair(doubleDefinition,doubleSource,plan)).toThrow('blocked')
})
