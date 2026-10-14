import { describe, expect, it } from 'vitest'
import { evaluate, authoredSlots, replayExposures, replayLoad, buildTmTimeline } from '../src/progression-engine'
import type { EngineInput, EngineExtensions } from '../src/progression-engine'
import { createExerciseIndex } from '../src/exercises'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'

const index=createExerciseIndex([{id:'custom-assist',n:'Synthetic assisted pull-up',eq:'leverage machine',assisted:true}])
const grid={increment:5,mode:'nearest' as const,usePlates:false}
function fixture() {
  const d=syntheticProgramme(),slot=syntheticSlot(d)
  slot.id='custom-assist';slot.sets=3;slot.reps=5;slot.weight=100;slot.progression.rules=['linear']
  d.progressionRules=[{id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{...grid}}]
  const x: EngineInput={definition:d,logs:[],weeks:[1],profile:{unit:'lb',effortScale:'rir'},cycle:{id:'c',weekIndex:1,week1StartDate:'2026-01-05',occurrences:[{instanceId:'o',weekIndex:1,dayKey:'d1',ordinal:1,routineId:'r',sessionTemplateId:'main',status:'pending'}]}}
  return {d,slot,x}
}
function log(x: EngineInput, weight=100, reps=5, date='2026-01-05') {
  x.logs.push({id:`w${x.logs.length}`,d:date,start:1,unit:'lb',entries:[{id:'custom-assist',occurrenceId:'o',target:{slotId:'bench',sets:3,reps:5},sets:Array.from({length:3},()=>({done:true,w:weight,r:reps}))}]})
}
const result=(x: EngineInput,ext: EngineExtensions={})=>evaluate(x,ext,index)
const sets=(x: EngineInput,ext: EngineExtensions={})=>result(x,ext).weeks[0]!.slots[0]!.sets
const multiply=(factor: number): NonNullable<EngineExtensions['stall']>=>(_ctx,rows)=>rows.map(s=>({...s,load:s.load===null?null:s.load*factor}))
function stallFixture(action: Record<string,unknown>) {
  const f=fixture();f.slot.progression.onStall='stall'
  f.d.progressionRules.push({id:'stall',kind:'stall',after:2,action,appliesTo:'load'})
  log(f.x,100,4);log(f.x,100,4,'2026-01-06')
  return f
}
function deloadFixture() {
  const f=fixture();f.slot.progression.rules.push('deload')
  f.d.progressionRules.push({id:'deload',kind:'scheduled-deload',weeks:[1],setsFactor:1,loadFactor:0.6,progressionDuring:'off'})
  return f
}
function amrapFixture() {
  const f=fixture();f.slot.reps='max';f.slot.repsMin=5;f.slot.tm={key:'assist',percentages:[1],reference:'tm'}
  f.x.cycle!.tmSeed={assist:100}
  f.d.progressionRules.push({id:'amrap',kind:'amrap-tm',lift:'assist',source:{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:0},bands:[{minRepsOver:1,tmDelta:5}],unit:'lb',at:'end-of-week'})
  return f
}

// Hand tables fixed before the implementation: reflect additive/multiplicative deltas,
// then round once. CUSTOM metadata lives only in this index, never in the authored slot.
describe('custom assisted hand-computed goldens',()=>{
  it('linear success100-5=95, failure holds100; caller index is required',()=>{
    const {x}=fixture();log(x)
    expect(sets(x).map(s=>s.load)).toEqual([95,95,95])
    expect(sets(x)[0]!.why[0]!.text).toContain('less assistance')
    expect(evaluate(x).weeks[0]!.slots[0]!.sets[0]!.load).toBe(105)
    const failed=fixture();log(failed.x,100,4);expect(sets(failed.x)[0]!.load).toBe(100)
  })
  it.each(['sessions','weeks'])('linear %s cadence100-5=95 after two successes',period=>{
    const {d,x}=fixture();d.progressionRules[0].every={[period]:2}
    log(x);expect(sets(x)[0]!.load).toBe(100)
    log(x,100,5,'2026-01-12');expect(sets(x)[0]!.load).toBe(95)
  })
  it('double ceiling100-5=95 and reps reset to8; a missed ceiling holds100',()=>{
    const {d,slot,x}=fixture();slot.reps='8-12'
    d.progressionRules=[{id:'linear',kind:'double',repsLow:8,repsHigh:12,condition:'all-sets',increment:5,unit:'lb',afterIncrease:'reset-to-low',rounding:grid}]
    log(x,100,12);expect(sets(x).map(s=>[s.load,s.reps])).toEqual([[95,8],[95,8],[95,8]])
    expect(sets(x)[0]!.why[0]!.text).toContain('less assistance')
    x.logs=[];log(x,100,11);expect(sets(x)[0]!.load).toBe(100)
  })
  it('stall reset reflects100*0.9=90 to110 assistance',()=>{
    const {x}=stallFixture({kind:'reset',pct:0.9})
    expect(sets(x,{stall:multiply(0.9)}).map(s=>s.load)).toEqual([110,110,110])
    expect(sets(x,{stall:multiply(0.9)})[0]!.why.at(-2)!.text).toContain('more assistance')
    expect(evaluate(x,{stall:multiply(0.9)}).weeks[0]!.slots[0]!.sets[0]!.load).toBe(90)
  })
  it('stall deload reflects100*0.6=60 to140 assistance',()=>{
    const {x}=stallFixture({kind:'deload',setsFactor:1,loadFactor:0.6,weeks:1})
    expect(sets(x,{stall:multiply(0.6)}).map(s=>s.load)).toEqual([140,140,140])
  })
  it('scheduled deload reflects100*0.6=60 to140 assistance',()=>{
    const {x}=deloadFixture()
    expect(sets(x,{deload:multiply(0.6)}).map(s=>s.load)).toEqual([140,140,140])
    expect(evaluate(x,{deload:multiply(0.6)}).weeks[0]!.slots[0]!.sets[0]!.load).toBe(60)
  })
  it('composed reset/deload:100→110→154, only final rounding gives155',()=>{
    const {d,slot,x}=stallFixture({kind:'reset',pct:0.9});slot.progression.rules.push('deload')
    d.progressionRules.push({id:'deload',kind:'scheduled-deload',weeks:[1],setsFactor:1,loadFactor:0.6,progressionDuring:'off'})
    expect(sets(x,{stall:multiply(0.9),deload:multiply(0.6)}).map(s=>s.load)).toEqual([155,155,155])
  })
  it('rounds95.5 down to95 only after reducing100.5 by5',()=>{
    const {x}=fixture();log(x,100.5);expect(sets(x)[0]!.load).toBe(95)
  })
  it('floors assistance3-5 at0 and accepts authored/logged zero assistance',()=>{
    const {d,slot,x}=fixture();log(x,3);expect(sets(x)[0]!.load).toBe(0)
    const authored=authoredSlots(d)[0]!,exposures=replayExposures(x,[authored])
    expect(replayLoad({input:x,definition:d,authored,exposures,allExposures:exposures,tm:buildTmTimeline(x,[authored],exposures),rule:d.progressionRules[0],index,warnings:[]},d.progressionRules[0]).load).toBe(0)
    x.logs=[];slot.weight=0;expect(sets(x)[0]!.load).toBe(0)
    slot.weight=100;log(x,0);expect(sets(x)[0]!.load).toBe(0)
  })
  it('reflects mutating extension deltas from a pre-call load snapshot',()=>{
    const {x}=deloadFixture()
    expect(sets(x,{deload:(_ctx,rows)=>{rows.forEach(s=>{s.load=s.load!*0.6});return rows}})[0]!.load).toBe(140)
  })
  it('does not invent a seed when extensions have null loads',()=>{
    const {slot,x}=deloadFixture();delete slot.weight
    expect(sets(x,{deload:multiply(0.6)}).map(s=>s.load)).toEqual([null,null,null])
  })
})
describe('undefined assisted rules fail closed',()=>{
  it('an assisted AMRAP source without an attached load rule still reports a slot error',()=>{
    const {slot,x}=amrapFixture();slot.progression.rules=[]
    expect(result(x).slotErrors?.[0]?.code).toBe('UNSUPPORTED_ASSISTED')
    expect(result(x).weeks[0]!.slots).toEqual([])
  })
  it('undefined assisted AMRAP never reaches the timeline or changes a shared TM',()=>{
    const {d,x}=amrapFixture();log(x,100,7)
    const before=structuredClone(x)
    let invoked=false
    const out=result(x,{timeline:(input,_slots,_exposures,seed,callerIndex)=>{
      invoked=true;expect(callerIndex).toBe(index)
      const rules=(input.definition as typeof d).progressionRules
      expect(rules.some((r: any)=>r.kind==='amrap-tm')).toBe(false)
      expect(rules.some((r: any)=>r.kind==='linear')).toBe(true)
      return rules.some((r: any)=>r.kind==='amrap-tm') ? {assist:[{...seed.assist![0]!,value:105}]} : seed
    }})
    expect(invoked).toBe(true);expect(out.tm.assist?.[0]?.value).toBe(100)
    expect(x).toEqual(before)
  })
  it('an ordinary AMRAP source does not forbid an assisted exercise in a later week',()=>{
    const {d,slot,x}=amrapFixture();slot.id='0025'
    const next=structuredClone(d.weeks[0]);next.index=2;syntheticSlot({weeks:[next]}).id='custom-assist'
    d.weeks.push(next);d.lengthWeeks=2;x.weeks=[2];x.cycle!.weekIndex=2
    expect(result(x).slotErrors).toBeUndefined()
    expect(result(x).weeks[0]!.slots[0]!.sets[0]!.load).toBe(100)
  })
  it.each(['percentage','rpe-load','amrap-tm'])('%s yields UNSUPPORTED_ASSISTED and no slot prescription',kind=>{
    const {d,slot,x}=fixture();slot.tm={key:'assist',percentages:[1],reference:'tm'};x.cycle!.tmSeed={assist:100}
    if (kind==='percentage') d.progressionRules=[{id:'linear',kind,ref:{lift:'assist',basis:'tm'},weeks:{1:Array.from({length:3},()=>({pct:0.8,reps:5}))},rounding:grid}]
    if (kind==='rpe-load') d.progressionRules=[{id:'linear',kind,lift:'assist',weeks:{1:Array.from({length:3},()=>({reps:5,rpe:8}))},e1rm:{formula:'epley',window:{sessions:3},pick:'best',useLoggedEffort:false},rounding:grid,whenNoData:{kind:'athlete-picks'}}]
    if (kind==='amrap-tm') {
      slot.reps='max';slot.repsMin=5
      d.progressionRules.push({id:'amrap',kind,lift:'assist',source:{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:0},bands:[{minRepsOver:1,tmDelta:5}],unit:'lb',at:'end-of-week'})
    }
    const out=result(x)
    expect(out.error).toBeUndefined();expect(out.weeks[0]!.slots).toEqual([])
    expect(out.slotErrors).toEqual([{code:'UNSUPPORTED_ASSISTED',slot:{week:1,day:'d1',session:'main',slot:'bench'}}])
    expect(out.warnings.some(w=>w.code==='rule.assisted-unsupported')).toBe(true)
    expect(evaluate(x).slotErrors).toBeUndefined()
  })
})
describe('replay date ingestion',()=>{
  it.each(['invalid','2026-02-30','2026-13-01','2026-1-05','2026-01-05T00:00:00Z','2026-00-01','2026-01-00','   '])('excludes nonempty invalid date %s with a warning under session cadence',date=>{
    const {d,x}=fixture();log(x,100,5,date)
    const warnings: ReturnType<typeof evaluate>['warnings']=[]
    expect(replayExposures(x,authoredSlots(d),warnings)).toEqual([])
    expect(warnings).toEqual([expect.objectContaining({code:'log.date-invalid'})])
    expect(sets(x)[0]!.load).toBe(100)
    expect(result(x).warnings.some(w=>w.code==='log.date-invalid')).toBe(true)
  })
  it('rejects non-leap February29 but accepts a real leap day',()=>{
    const {x}=fixture();log(x,100,5,'2026-02-29');expect(sets(x)[0]!.load).toBe(100)
    x.logs=[];log(x,100,5,'2028-02-29');expect(sets(x)[0]!.load).toBe(95)
    expect(result(x).warnings.some(w=>w.code==='log.date-invalid')).toBe(false)
  })
  it('invalid logs never supply actual loads or successful exposures alongside valid logs',()=>{
    const {d,x}=fixture();d.progressionRules[0].every={sessions:2}
    log(x,200,5,'2026-02-30');log(x,100)
    expect(sets(x)[0]!.load).toBe(100)
  })
})
