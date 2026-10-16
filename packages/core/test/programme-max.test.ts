import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { activate, skip } from '../src/programme'
import { setTrainingMax, effectiveProgrammeMax, programmeMaxBasis } from '../src/programme-max'
import { evaluate, preview } from '../src/progression-engine/index'
import { buildSessionEntries } from '../src/session-start'
import { mergeStates } from '../src/sync-merge'
import { convertStateUnit } from '../src/units'
import { convertWeightPrecise } from '../src/progression-engine/units'
import { finishProgrammeBlock } from '../src/programme-rollover'
import { syntheticProgramme } from './fixtures/synthetic-programme'
import { customAdaptiveState, maxState } from './fixtures/synthetic-max'
const options={lift:'bench',value:240,unit:'lb' as const,today:'2026-10-15',now:1000,reason:'Technique check'}
const engine=(S:any,asOf='2026-10-15',week=1)=>({definition:S.programmes.cycles[0].snapshot,cycle:S.programmes.cycles[0],logs:S.workouts,weeks:[week],asOf,now:asOf,profile:{unit:S.unit,effortScale:'rir' as const}})
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
it.each([0.5,0.9])('a manual absolute max cancels a pending TM deload restore at factor %s',loadFactor=>{
 const S=maxState(),c=S.programmes.cycles[0],d=c.snapshot
 d.weeks=[1,2,3,4].map(index=>({...structuredClone(d.weeks[0]),index}));d.lengthWeeks=4
 d.progressionRules[0].weeks=Object.fromEntries([1,2,3,4].map(w=>[String(w),[{pct:.5,reps:5},{pct:.5,reps:5}]]))
 d.progressionRules.push({id:'stall',kind:'stall',after:2,action:{kind:'deload',setsFactor:1,loadFactor,weeks:1},appliesTo:'tm'})
 for(const w of d.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].progression.onStall='stall'
 S.workouts=[0,1].map(i=>({id:'failed-'+i,d:i?'2026-10-19':'2026-10-12',start:10+i,entries:[{id:'0025',occurrenceId:c.occurrences.find((o:any)=>o.weekIndex===i+1).instanceId,target:{slotId:'bench'},sets:[{done:true,w:100,r:2},{done:true,w:100,r:2}]}]}))
 const baseline=evaluate(engine(S,'2026-11-30'))
 expect(baseline.tm.bench?.map(p=>p.value)).toEqual([200,200*loadFactor,200])
 setTrainingMax(S,'c',{lift:'bench',value:190,unit:'lb',today:'2026-10-20',now:1000})
 const history=structuredClone(c.maxAdjustments),out=evaluate(engine(S,'2026-11-30'))
 expect(out.tm.bench?.map(p=>p.value)).toEqual([200,200*loadFactor,190])
 expect(out.tm.bench?.at(-1)?.why.inputs.cancelledRestores).toBe(1)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-28','lb')).toBe(190)
 expect(c.tmSeed).toEqual({bench:200});expect(c.maxAdjustments).toEqual(history)
})
describe('dated reference max adjustments',()=>{
  it.each([true,false])('changes the next materialization (%s typed), preserves seed/logs/current active',typed=>{
    const S=maxState(typed),c=S.programmes.cycles[0]
    S.active={id:'running',routineIds:[S.routines[0].id],entries:buildSessionEntries(S,S.routines[0])}
    S.workouts=[{id:'old',d:'2026-10-13',entries:[{w:100}],extension:{keep:true}}]
    const active=structuredClone(S.active),logs=structuredClone(S.workouts),routine=structuredClone(S.routines[0]),seed=structuredClone(c.tmSeed)
    const event=setTrainingMax(S,'c',options)
    expect(event).toMatchObject({previous:200,value:240,unit:'lb',basis:'tm',effectiveOn:'2026-10-15',recordedAt:1000})
    expect(c.tmSeed).toEqual(seed);expect(S.workouts).toEqual(logs);expect(S.active).toEqual(active);expect(S.routines[0]).toEqual(routine)
    expect(buildSessionEntries(S,S.routines[1])[0]!.sets.map((s:any)=>s.w)).toEqual([120,120])
    expect(evaluate(engine(S)).weeks[0]?.slots[0]?.sets.map(s=>s.load)).toEqual(typed ? [120,120] : undefined)
    if (typed) expect(preview(engine(S)).weeks[0]!.slots[0]!.sets.map(s=>s.load)).toEqual([120,120])
    expect(JSON.parse(JSON.stringify(S)).programmes.cycles[0].maxAdjustments).toEqual([event])
  })
  it('does not replay a manual event before its effective date',()=>{
    const S=maxState();setTrainingMax(S,'c',options)
    expect(evaluate(engine(S,'2026-10-14')).weeks[0]!.slots[0]!.sets[0]!.load).toBe(100)
    expect(evaluate(engine(S,'2026-10-15')).weeks[0]!.slots[0]!.sets[0]!.load).toBe(120)
    expect(evaluate(engine(S,'2026-10-15',2)).weeks[0]!.slots[0]!.sets[0]!.load).toBe(120)
  })
  it('stores canonical definition units without intermediate rounding and survives profile conversion',()=>{
    const S=maxState();const event=setTrainingMax(S,'c',{...options,value:100,unit:'kg'})
    expect(event.value).toBeCloseTo(220.46226218,8)
    const kg:any=convertStateUnit(S,'kg')
    expect(kg.programmes.cycles[0].maxAdjustments).toEqual([event]);expect(kg.programmes.cycles[0].tmSeed).toEqual({bench:200})
    expect(effectiveProgrammeMax(kg,kg.programmes.cycles[0],'bench',options.today,'kg')).toBeCloseTo(100,8)
    setTrainingMax(kg,'c',{...options,value:105,unit:'kg',now:1001})
    expect(kg.programmes.cycles[0].maxAdjustments[1].previous).toBeCloseTo(event.value,8)
  })
  it.each([0,-1,NaN,Infinity,-Infinity,'240',null,undefined])('refuses invalid value %s without mutating',value=>{
    const S=maxState(),before=structuredClone(S)
    expect(()=>setTrainingMax(S,'c',{...options,value} as any)).toThrow();expect(S).toEqual(before)
  })
  it.each([{lift:'unknown'},{unit:'stones'},{today:'2026-02-30'},{reason:'x'.repeat(1001)}])('refuses bad options %j',bad=>{
    const S=maxState(),before=structuredClone(S);expect(()=>setTrainingMax(S,'c',{...options,...bad} as any)).toThrow();expect(S).toEqual(before)
  })
  it('preserves concurrent appends, unknown event data and deterministic replay in either merge order',()=>{
    const base=maxState(),a=structuredClone(base),b=structuredClone(base)
    const ea:any=setTrainingMax(a,'c',options),eb=setTrainingMax(b,'c',{...options,value:260})
    ea.extension={future:'kept'}
    for(const merged of [mergeStates(a,b),mergeStates(b,a)]) {
      const c=(merged as any).programmes.cycles[0]
      expect(c.maxAdjustments).toHaveLength(2);expect(c.maxAdjustments.find((e:any)=>e.id===ea.id).extension).toEqual({future:'kept'})
      expect(evaluate(engine(merged)).tm).toEqual(evaluate(engine(mergeStates(b,a))).tm)
      expect((mergeStates(merged,a) as any).programmes.cycles[0].maxAdjustments).toEqual(c.maxAdjustments)
    }
  })
  it('keeps same-day edits ordered and refuses a backdated append',()=>{
    const S=maxState();setTrainingMax(S,'c',options);setTrainingMax(S,'c',{...options,value:260})
    expect(S.programmes.cycles[0].maxAdjustments.map((e:any)=>e.recordedAt)).toEqual([1000,1001])
    expect(effectiveProgrammeMax(S,S.programmes.cycles[0],'bench',options.today,'lb')).toBe(260)
    const before=structuredClone(S);expect(()=>setTrainingMax(S,'c',{...options,today:'2026-10-14'})).toThrow();expect(S).toEqual(before)
  })
  it('only derives bases from explicit evidence',()=>{
    const d=maxState().programmes.cycles[0].snapshot
    expect(programmeMaxBasis(d)).toBe('tm');delete d.maxBasis
    for(const ref of ['lb','as-authored']) {for(const w of d.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].tm.reference=ref;expect(programmeMaxBasis(d)).toBeUndefined()}
    for(const w of d.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].tm.reference='e1rm'
    expect(programmeMaxBasis(d)).toBe('e1rm')
  })
  it('reviewed repeat values are absolute and bypass a saved bump exactly once',()=>{
    const S=maxState(false),c=S.programmes.cycles[0];c.snapshot.repeat={bump:{bench:5}}
    for(const o of c.occurrences)skip(S,c.id,o.instanceId,{today:'2026-10-15'})
    const seed=structuredClone(c.tmSeed),history=structuredClone(c.maxAdjustments)
    const next:any=finishProgrammeBlock(S,c.id,'repeat',{today:'2026-10-16',repeatMax:{unit:'kg',values:{bench:100}}})
    expect(next.tm.bench).toBeCloseTo(convertWeightPrecise(100,'kg','lb'),8)
    expect(next.tmSeed.bench).toBeCloseTo(convertWeightPrecise(100,'kg','lb'),8)
    expect(S.programmes.cycles[0].tmSeed).toEqual(seed);expect(S.programmes.cycles[0].maxAdjustments).toEqual(history)
    expect(()=>finishProgrammeBlock(S,c.id,'repeat',{today:'2026-10-16'})).toThrow()
  })
})

it('rematerializes an already-applied percentage config from history without mutating the routine',()=>{
 const S=maxState(),r=S.routines[1]
 Object.assign(r.ex[0],{tm:null,enginePrescription:true,pyramidWeight:[100,100],weight:100})
 setTrainingMax(S,'c',options);const before=structuredClone(r)
 expect(buildSessionEntries(S,r)[0]!.sets.map(s=>s.w)).toEqual([120,120]);expect(r).toEqual(before)
})
it('manual absolute overrides follow old automatic bumps and allow later automatic bumps exactly once',()=>{
 const S=maxState(),c=S.programmes.cycles[0],d=c.snapshot
 d.progressionRules.push({id:'bump',kind:'amrap-tm',lift:'bench',source:{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:1},at:'end-of-week',bands:[{minRepsOver:0,tmDelta:5}],unit:'lb'})
 for(const w of d.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].progression.rules.push('bump')
 for(const rows of Object.values(d.progressionRules[0].weeks) as any[])rows[1]={pct:.5,reps:'amrap',repsMin:5}
 d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].pyramid[1]='max'
 S.workouts=[{id:'log',d:'2026-10-12',start:2,entries:[{id:'0025',occurrenceId:c.occurrences[0].instanceId,target:{slotId:'bench'},sets:[{done:true,w:100,r:5},{done:true,w:100,r:6}]}]}]
 setTrainingMax(S,'c',options)
 const result=evaluate(engine(S,'2026-10-20',2))
 expect(result.error).toBeUndefined()
 expect(result.weeks[0]!.slots[0]!.sets[0]!.load).toBe(125) // 240 manual + 5 at next-week boundary, nearest 5.
 expect(evaluate(engine(S,'2026-10-20',2))).toEqual(result)
 expect(c.tmSeed).toEqual({bench:200})
})
it('legacy percentage materialization resolves concurrent same-lift events in replay order',()=>{
 const S=maxState(false),a=structuredClone(S),b=structuredClone(S)
 setTrainingMax(a,'c',options);setTrainingMax(b,'c',{...options,value:260,now:1001})
 for(const m of [mergeStates(a,b),mergeStates(b,a)] as any[])expect(buildSessionEntries(m,m.routines[1])[0]!.sets.map(s=>s.w)).toEqual([130,130])
})
it('fails closed on malformed imported adjustment history without throwing from evaluate',()=>{
 for(const history of [[null],[{id:'bad',lift:'bench',unit:'lb',value:Infinity,effectiveOn:'2026-10-15',recordedAt:1}],{}]) {
  const S=maxState();S.programmes.cycles[0].maxAdjustments=history
  expect(evaluate(engine(S)).error?.code).toBe('INVALID_LOAD')
 }
})
it('rejects finite input whose conversion overflows or underflows before appending',()=>{
 for(const [value,unit] of [[Number.MAX_VALUE,'kg'],[Number.MIN_VALUE,'lb']] as const) {
  const S=maxState();if(unit==='lb')S.programmes.cycles[0].snapshot.unit='kg'
  const before=structuredClone(S)
  expect(()=>setTrainingMax(S,'c',{...options,value,unit})).toThrow();expect(S).toEqual(before)
 }
})

import {createExerciseIndex} from '../src/exercises'
it('forwards the custom equipment index while lazily rebuilding adjusted percentage rows',()=>{
 const S=maxState(),c=S.programmes.cycles[0],custom={id:'synthetic-custom-max',n:'Synthetic custom bell',eq:'dumbbell',custom:true}
 S.customEx=[custom];S.dumbbells={lb:{weights:[40,90,125]}}
 for(const w of c.snapshot.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].id=custom.id
 for(const r of S.routines)r.ex[0].id=custom.id
 c.snapshot.progressionRules[0].rounding.usePlates=true
 const index=createExerciseIndex(S.customEx);setTrainingMax(S,'c',options,index)
 expect(buildSessionEntries(S,S.routines[1],index)[0]!.sets.map(s=>s.w)).toEqual([125,125])
 expect(buildSessionEntries(S,S.routines[1])[0]!.sets.map(s=>s.w)).toEqual([120,120])
})
it('forwards the custom assisted index into effective max replay and the saved previous value',()=>{
 const S=customAdaptiveState(),c=S.programmes.cycles[0],index=createExerciseIndex(S.customEx)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-20','lb',index)).toBe(200)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-20','lb')).toBe(205)
 const event=setTrainingMax(S,'c',{...options,today:'2026-10-20'},index)
 expect(event.previous).toBe(200)
})

const cacheOnlyMaxState = () => {
 const S=maxState(false),c=S.programmes.cycles[0]
 delete c.snapshot.tmSeeds;delete c.tmSeed
 return S
}
it.each(['2026-10-15','2026-10-20'])('cache-only maxes retain their baseline until the exact effective date %s',effectiveOn=>{
 const S=cacheOnlyMaxState(),c=S.programmes.cycles[0],snapshot=structuredClone(c.snapshot)
 const event=setTrainingMax(S,'c',{...options,today:effectiveOn})
 expect(event.previous).toBe(200);expect(c.tm.bench).toBe(240)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-14','lb')).toBe(200)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-15','lb')).toBe(effectiveOn==='2026-10-15' ? 240 : 200)
 expect(effectiveProgrammeMax(S,c,'bench',effectiveOn,'lb')).toBe(240)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-21','lb')).toBe(240)
 expect(c.snapshot).toEqual(snapshot);expect(c.tmSeed).toBeUndefined();expect(c.maxAdjustments).toEqual([event])
 // The existing legacy materializer must keep the same calendar boundary.
 expect(buildSessionEntries(S,S.routines[0])[0]!.sets.map(s=>s.w)).toEqual(effectiveOn==='2026-10-15' ? [120,120] : [100,100])
 vi.setSystemTime(new Date(effectiveOn+'T12:00:00Z'))
 expect(buildSessionEntries(S,S.routines[0])[0]!.sets.map(s=>s.w)).toEqual([120,120])
})
it.each([['lb','kg'],['kg','lb']] as const)('cache-only baselines use event units, with definition %s and profile %s', (definitionUnit,profileUnit)=>{
 const S=cacheOnlyMaxState(),c=S.programmes.cycles[0]
 S.unit=profileUnit;c.snapshot.unit=definitionUnit;c.tmUnit=profileUnit;c.tm.bench=100
 const event=setTrainingMax(S,'c',{...options,value:120,unit:definitionUnit,today:'2026-10-20'})
 const prior=convertWeightPrecise(100,profileUnit,definitionUnit),history=structuredClone(c.maxAdjustments)
 expect(event.previous).toBeCloseTo(prior,10);expect(event.unit).toBe(definitionUnit)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-15',profileUnit)).toBeCloseTo(100,10)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-15',definitionUnit)).toBeCloseTo(prior,10)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-20',definitionUnit)).toBe(120)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-20',profileUnit)).toBeCloseTo(convertWeightPrecise(120,definitionUnit,profileUnit),10)
 expect(c.maxAdjustments).toEqual(history);expect(c.tmSeed).toBeUndefined()
})
it.each([null,undefined,NaN])('cache-only unknown prior %s never borrows a later event or the latest cache',previous=>{
 const S=cacheOnlyMaxState(),c=S.programmes.cycles[0];c.tm={}
 const first=setTrainingMax(S,'c',{...options,today:'2026-10-20'})
 expect(first.previous).toBeNull()
 const second=setTrainingMax(S,'c',{...options,value:260,today:'2026-10-25',now:1001})
 expect(second.previous).toBe(240)
 first.previous=previous as any;c.maxAdjustments.reverse()
 const history=structuredClone(c.maxAdjustments)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-15','lb')).toBeNull()
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-20','lb')).toBe(240)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-25','lb')).toBe(260)
 expect(c.maxAdjustments).toEqual(history)
})
it('cache-only baseline resolution follows chronological and same-day recording order without rewriting history',()=>{
 const S=cacheOnlyMaxState(),c=S.programmes.cycles[0]
 const first=setTrainingMax(S,'c',{...options,today:'2026-10-20'}),second=setTrainingMax(S,'c',{...options,today:'2026-10-20',value:260,now:1001})
 first.id='z-first';second.id='a-second';c.maxAdjustments=[second,first]
 const history=structuredClone(c.maxAdjustments)
 expect(second.previous).toBe(240)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-15','lb')).toBe(200)
 expect(effectiveProgrammeMax(S,c,'bench','2026-10-20','lb')).toBe(260)
 expect(c.maxAdjustments).toEqual(history)
})
