import { describe, expect, it } from 'vitest'
import { importProgramme } from '../src/programme-import'
import { applyCommunityRepair, communityHash, communityScriptFromSummary, convertCommunityScript, planCommunityRepair, type CommunitySource } from '../src/community-conversion'
import { authoredSlots, evaluate, preview } from '../src/progression-engine'
import { activate } from '../src/programme'
import { finishProgrammeBlock } from '../src/programme-rollover'
import { createExerciseIndex } from '../src/exercises'
import { buildSessionEntries } from '../src/session-start'

function fixture(script='lp(5lb, 1, 0, 10%, 2, 0)', frequency=3) {
  const source:CommunitySource={id:'synthetic-community',name:'Synthetic A/B',unit:'lb',length_weeks:1,extension:{retained:true},
    source:{kind:'own',ref:'Synthetic source only',private:true,extra:'keep'},rules:{frequency,goal:'Strength'},weeks:[{n:1,days:[1,2].map(n=>({n,kind:'lift',exercises:[{
      id:n===1?'0025':'0032',name:`Synthetic ${n}`,slot:'lift',role:'main',sets:[{count:2,reps:5,weight:999,rpe:8}],rules:[{kind:'progress',script}],
    }]}))}]}
  const definition=importProgramme(source).definition! as any
  definition.extension={keep:[1,2,3]};definition.needsReview=['Independent review required'];definition.source.private=true
  for(const a of authoredSlots(definition)) a.slot.extension={preserved:'slot'}
  return {source,definition}
}
describe('community script whitelist',()=>{
  it.each(['lp(5lb)','lp(5lb, 2)','lp(5lb, 1, 0, 10%, 3, 0)','dp(2.5kg, 8, 12)'])('maps ordinary built-ins: %s',script=>{
    const c=convertCommunityScript(script,'lb','test');expect(c.status).toBe('supported');expect(c.rules[0]!.kind).toBe(script.startsWith('lp')?'linear':'double')
  })
  it.each(['custom() { weights += 5lb }','sum(50, 5lb)','lp(5%)','dp(5%, 8, 12)','lp(5lb, 2, 1)','lp(5lb, 1, 0, 10lb, 3)','lp(5lb, 1, 0, 60%, 3)','dp(5lb, 12, 8)','lp(0lb)','lp(5lb); malicious()'])('rejects unsupported semantics: %s',script=>{
    expect(convertCommunityScript(script,'lb','test').status).toBe('unsupported')
  })
  it('never executes update scripts and converts increments precisely',()=>{
    expect(convertCommunityScript('lp(5lb)','lb','test',undefined,'weights += 1').status).toBe('unsupported')
    const result=convertCommunityScript('dp(2.5kg, 8, 12)','lb','test')
    expect((result.rules[0] as any).increment).toBeCloseTo(5.5115565546,8)
  })
  it('recognizes exact converter summaries, never custom prose',()=>{
    expect(communityScriptFromSummary('linear: add 5lb after 1 successful session(s); subtract 10% after 3 failed session(s)')).toBe('lp(5lb, 1, 0, 10%, 3, 0)')
    expect(communityScriptFromSummary('double progression: reps 8-12; at the top add 5lb and reset reps to 8')).toBe('dp(5lb, 8, 12)')
    expect(communityScriptFromSummary('custom: increase weight')).toBeUndefined()
  })
})
describe('offline community repair plans',()=>{
  it('produces immutable A/B/A B/A/B, metadata, engine rules and athlete-picked first loads',()=>{
    const {source,definition}=fixture(), before=structuredClone({source,definition})
    const plan=planCommunityRepair(definition,source,{maxBasis:'1rm'})
    expect(plan.issues).toEqual([]);expect(plan.status).toBe('reviewable');expect({source,definition}).toEqual(before)
    const d=plan.definition
    expect([d.lengthWeeks,d.daysPerWeek,d.goal,d.maxBasis,d.end]).toEqual([2,3,'Strength','1rm','repeat'])
    expect(d.weeks.map(w=>w.days.flatMap(day=>day.sessions.map(s=>s.routineSnapshot.name)))).toEqual([['D1','D2','D1'],['D2','D1','D2']])
    expect(d.extension).toEqual(definition.extension);expect(d.source?.private).toBe(true);expect(d.needsReview).toEqual(definition.needsReview);expect(d.rulesSupported).toBe(false)
    expect(d.source?.authoredLengthWeeks).toBe('1')
    for(const a of authoredSlots(d)) {
      expect(a.slot.weight).toBeUndefined();expect(a.slot.pyramidWeight).toBeUndefined();expect(a.slot.prog).toBe('off')
      expect(a.slot.progression?.rules).toHaveLength(1);expect(a.slot.extension).toEqual({preserved:'slot'})
    }
    expect(evaluate({definition:d,logs:[],weeks:[1],profile:{unit:'lb',effortScale:'rir'}}).weeks[0]!.slots.flatMap(s=>s.sets.map(s=>s.load))).toEqual([null,null,null,null,null,null])
    expect(applyCommunityRepair(definition,source,plan,{maxBasis:'1rm'})).toEqual(d)
  })
  it('repeats synthetic cycles with prescribed increments across actual programme activation/rollover',()=>{
    const {source,definition}=fixture('lp(5lb)'), initial=planCommunityRepair(definition,source)
    const options={athleteLoads:Object.fromEntries(initial.slots.map(s=>[s.continuityKey!,100]))}
    const plan=planCommunityRepair(definition,source,options);expect(plan.issues).toEqual([])
    const d=applyCommunityRepair(definition,source,plan,options)
    const state:any={unit:'lb',routines:[],workouts:[],programmes:{definitions:[d],cycles:[]}}
    let c=activate(state,d as any,{today:'2026-01-05',cycleId:'lap1',now:0})
    const seen:number[]=[], dates=['2026-01-05','2026-01-07','2026-01-09','2026-01-12','2026-01-14','2026-01-16']
    for(let lap=0;lap<2;lap++) {
      for(const [i,o] of c.occurrences.entries()) {
        c.weekIndex=o.weekIndex
        const date=lap===0?dates[i]!:dates[i]!.replace('01-','02-')
        const result=evaluate({definition:c.snapshot,cycle:c,historyCycles:state.programmes.cycles,logs:state.workouts,weeks:[o.weekIndex],asOf:date,profile:{unit:'lb',effortScale:'rir'}})
        expect(result.error).toBeUndefined()
        const slot=result.weeks[0]!.slots.find(s=>s.ref.day===o.dayKey)!, load=slot.sets[0]!.load!
        const routine=state.routines.find((r:any)=>r.id===o.routineId)
        const rows=buildSessionEntries(state,routine)[0]!.sets
        expect(rows.map(s=>s.w)).toEqual([load,load])
        seen.push(load)
        state.workouts.push({id:`${lap}-${i}`,d:date,start:i+1,unit:'lb',entries:[{id:slot.exerciseId,occurrenceId:o.instanceId,target:{slotId:slot.ref.slot,sets:2,reps:5},sets:[{w:load,r:5,done:true},{w:load,r:5,done:true}]}]})
        o.status='done';o.date=date
      }
      if(lap===0) {c.status='finished';c=finishProgrammeBlock(state,c.id,'repeat',{today:'2026-02-05'}) as typeof c}
    }
    expect(seen).toEqual([100,100,105,105,110,110,115,115,120,120,125,125])
    expect(c.cadence.perWeek).toBe(3)
  })
  it('one-week repeat keeps load and double progression walks endpoints before load increase',()=>{
    const {source,definition}=fixture('dp(5lb, 5, 8)',2), p=planCommunityRepair(definition,source)
    expect(p.definition.lengthWeeks).toBe(1)
    const d=p.definition, a=authoredSlots(d)[0]!, logs:any[]=[], cycle:any={id:'c',weekIndex:1,week1StartDate:'2026-01-05',occurrences:[]}
    for(const [i,reps] of [5,6,7,8].entries()) {
      const id=`o${i}`, date=`2026-01-${String(5+i).padStart(2,'0')}`
      cycle.occurrences.push({instanceId:id,weekIndex:1,dayKey:a.ref.day,sessionTemplateId:a.ref.session,ordinal:i+1,routineId:`r${i}`,status:'done'})
      logs.push({id,d:date,start:i,unit:'lb',entries:[{id:a.slot.id,occurrenceId:id,target:{slotId:a.ref.slot,sets:2,reps},sets:[{w:100,r:reps,done:true},{w:100,r:reps,done:true}]}]})
      const out=preview({definition:d,cycle,logs,weeks:[1],asOf:'2026-01-10',profile:{unit:'lb',effortScale:'rir'}}).weeks[0]!.slots[0]!.sets[0]!
      expect([out.load,out.reps]).toEqual(i<3?[100,reps+1]:[105,5])
    }
  })
  it('one-week block repeat carries failed-target streaks and resets on the next miss',()=>{
    const {source,definition}=fixture('lp(5lb, 1, 0, 10%, 2, 0)',2)
    const d=planCommunityRepair(definition,source).definition, state:any={unit:'lb',routines:[],workouts:[]}
    const first=activate(state,d as any,{cycleId:'one-week',today:'2026-01-05'})
    for(const [i,o] of first.occurrences.entries()) {
      const a=authoredSlots(d).find(a=>a.ref.day===o.dayKey)!
      state.workouts.push({id:`first${i}`,d:'2026-01-05',start:i,unit:'lb',entries:[{id:a.slot.id,occurrenceId:o.instanceId,target:{slotId:a.ref.slot,sets:2,reps:5},sets:[{w:100,r:4,done:true},{w:100,r:5,done:true}]}]});o.status='done'
    }
    first.status='finished'
    const next=finishProgrammeBlock(state,first.id,'repeat',{today:'2026-01-12'}) as typeof first
    const run=()=>evaluate({definition:next.snapshot,cycle:next,historyCycles:state.programmes.cycles,logs:state.workouts,weeks:[1],asOf:'2026-01-13',profile:{unit:'lb',effortScale:'rir'}})
    expect(run().weeks[0]!.slots[0]!.sets[0]!.load).toBe(100)
    const a=authoredSlots(d)[0]!, o=next.occurrences[0]!
    state.workouts.push({id:'next-miss',d:'2026-01-12',start:1,unit:'lb',entries:[{id:a.slot.id,occurrenceId:o.instanceId,target:{slotId:a.ref.slot,sets:2,reps:5},sets:[{w:100,r:4,done:true},{w:100,r:5,done:true}]}]})
    expect(run().weeks[0]!.slots[0]!.sets[0]!.load).toBe(90)
  })
  it('requires and forwards the caller catalogue index for custom exercise repair',()=>{
    const {source}=fixture('lp(5lb)',2), customEx=[{id:'synthetic-custom',n:'Synthetic custom press',eq:'machine'}]
    for(const day of source.weeks[0]!.days) day.exercises[0]!.id='synthetic-custom'
    const index=createExerciseIndex(customEx),definition=importProgramme(source,{customEx},index).definition! as any
    const plan=planCommunityRepair(definition,source,{},index)
    expect(plan.status).toBe('reviewable')
    expect(applyCommunityRepair(definition,source,plan,{},index)).toEqual(plan.definition)
    expect(planCommunityRepair(definition,source).status).toBe('blocked')
  })
  it('blocks custom logic, mismatched metadata, unresolved source, paid methods and stale/tampered apply',()=>{
    const {source,definition}=fixture('custom() { numberOfSets += 1 }')
    const p=planCommunityRepair(definition,source);expect(p.status).toBe('blocked');expect(p.slots.every(s=>s.status==='unsupported')).toBe(true)
    expect(()=>applyCommunityRepair(definition,source,p)).toThrow('blocked')
    const good=fixture(), plan=planCommunityRepair(good.definition,good.source)
    const changed=structuredClone(good.definition);changed.extension='later'
    expect(()=>applyCommunityRepair(changed,good.source,plan)).toThrow('Stale')
    plan.definition.name='tampered';expect(()=>applyCommunityRepair(good.definition,good.source,plan)).toThrow('differs')
    good.source.rules!.frequency=undefined;expect(planCommunityRepair(good.definition,good.source).issues.some(i=>i.code==='metadata.frequency')).toBe(true)
    good.source.id=['sbs','synthetic'].join('-');expect(planCommunityRepair(good.definition,good.source).issues[0]!.code).toBe('family.deferred')
    expect(communityHash(good.source)).toHaveLength(64)
  })
})
