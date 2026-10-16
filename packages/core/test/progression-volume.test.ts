import { describe, expect, it } from 'vitest'
import { evaluate, preview, rampSlots, authoredSlots, distributeSets, progressionExposures, replayExposures, buildWhy } from '../src/progression-engine'
import { validateProgression } from '../src/progression-validate'
import { createExerciseIndex, EXIDX } from '../src/exercises'
import { meaningFactor } from '../src/dumbbells'
import { volumeProgramme, volumeInput, volumeLog, volumeIndex, roundRobinGolden, proportionalGolden } from './fixtures/synthetic-volume'
import type { VolumeRampRule } from '../../contract/domain/progression'

const counts=(out: ReturnType<typeof evaluate>)=>out.weeks.map(w=>w.slots.map(s=>s.sets.length))
const ramp=(d: ReturnType<typeof volumeProgramme>): VolumeRampRule=>d.progressionRules[0]
const slots=(d: ReturnType<typeof volumeProgramme>,week=1)=>d.weeks[week-1].days[0].sessions[0].routineSnapshot.ex
const run=(x=volumeInput())=>evaluate(x,{},volumeIndex)
const projected=(x=volumeInput())=>preview(x,{},volumeIndex)

describe('P4 hand-computed RP-style volume goldens',()=>{
  it('MEV 6 ->9 ->12 ->15 ->MRV16 over five weeks, round-robin then explicit deload',()=>{
    const x=volumeInput(), out=run(x)
    expect(out.error).toBeUndefined();expect(out.warnings).toEqual([])
    expect(counts(out)).toEqual(roundRobinGolden)
    expect(out.weeks.map(w=>w.slots[0]!.sets[0]!.load)).toEqual([100,100,100,100,100,60])
    expect(out.weeks[5]!.slots[0]!.sets[0]!.target).toEqual({rir:4})
    expect(out.weeks[4]!.slots[0]!.why[0]!.inputs).toMatchObject({sets:16,startSets:6,addPerWeek:3,maxSets:16,increases:4,holds:0,slotSets:8,distribute:'round-robin-by-slot-order'})
  })
  it('proportional 1:2 authored ratio, largest remainder at capped 16 ->5:11',()=>{
    const x=volumeInput(volumeProgramme('proportional')),out=run(x)
    expect(out.error).toBeUndefined();expect(out.warnings).toEqual([])
    expect(counts(out)).toEqual(proportionalGolden)
  })
  it('custom secondary chest credit selects B, zero chest credit excludes legs',()=>{
    const d=volumeProgramme()
    expect(rampSlots(d,ramp(d),2,volumeIndex).map(a=>a.slot.id)).toEqual(['synthetic-chest-a','synthetic-chest-b'])
    const changed=createExerciseIndex([{id:'synthetic-chest-a',bp:'upper legs',muscleWeights:{quadriceps:1}},{id:'synthetic-chest-b',bp:'upper legs',muscleWeights:{chest:0}}])
    expect(rampSlots(d,ramp(d),2,changed)).toEqual([])
    expect(counts(evaluate(volumeInput(d,[2]),{},changed))).toEqual([[2,4,3]])
  })
  it('count scope only includes slots that explicitly attach the ramp',()=>{
    const d=volumeProgramme();slots(d,2)[1].progression.rules=['linear','deload']
    expect(counts(run(volumeInput(d,[2])))).toEqual([[9,4,3]])
  })
  it('proportional remainder ties and round robin use authored order, not slot IDs',()=>{
    const d=volumeProgramme(),s=authoredSlots(d).slice(0,3)
    s.forEach(a=>{a.slot.sets=1})
    expect(distributeSets(s,5,'proportional')).toEqual([2,2,1])
    expect(distributeSets(s,5,'round-robin-by-slot-order')).toEqual([2,2,1])
    expect(distributeSets([],5,'proportional')).toEqual([])
  })
  it('zero budget and budgets below slot count preserve the exact cap with loads attached',()=>{
    const d=volumeProgramme();Object.assign(ramp(d),{startSets:0,addPerWeek:1,maxSets:1})
    const out=run(volumeInput(d,[1,2,3]))
    expect(counts(out)).toEqual([[0,0,3],[1,0,3],[1,0,3]])
    expect(out.weeks[0]!.slots[0]!.why[0]!.inputs.sets).toBe(0)
  })
  it('slot-only scope addresses exact week even when the same slot identity repeats',()=>{
    const d=volumeProgramme();ramp(d).scope={slots:[{week:1,day:'d1',session:'main',slot:'a'},{week:3,day:'d1',session:'main',slot:'b'}]}
    expect(counts(run(volumeInput(d,[1,2,3])))).toEqual([[6,4,3],[2,4,3],[2,12,3]])
  })
  it('sparse ramp weeks advance by authored ramp ordinal and remain authored in gaps',()=>{
    const d=volumeProgramme();ramp(d).weeks=[1,3,5]
    expect(counts(run(volumeInput(d,[1,2,3,4,5])))).toEqual([[3,3,3],[2,4,3],[5,4,3],[2,4,3],[6,6,3]])
  })
  it('missing explicit ramp/deload fields fail closed; no engine default repairs them',()=>{
    for (const kind of ['ramp','deload']) for (const field of kind==='ramp'?['startSets','addPerWeek','maxSets','weeks','distribute','holdIfMissedReps']:['setsFactor','loadFactor','weeks','progressionDuring']) {
      const d=volumeProgramme();delete d.progressionRules.find((r: {id:string})=>r.id===kind)[field]
      const out=run(volumeInput(d))
      expect(out.error).toBeDefined();expect(out.weeks).toEqual([])
    }
  })
  it('target-only pyramids repeat the last valid row when the ramp adds sets',()=>{
    const d=volumeProgramme()
    for (let week=1;week<=6;week++) for (const s of slots(d,week).slice(0,2)) {
      s.progression.rules=['ramp','deload'];s.pyramid=Array.from({length:s.sets},(_,i)=>i===s.sets-1?10:8);delete s.reps
    }
    const out=run(volumeInput(d,[2]))
    expect(out.error).toBeUndefined();expect(counts(out)).toEqual([[5,4,3]])
    expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([8,10,10,10,10])
    expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.load)).toEqual([null,null,null,null,null])
  })
  it('rejects two volume ramps for one muscle even on disjoint weeks',()=>{
    const d=volumeProgramme();d.progressionRules.push({...structuredClone(ramp(d)),id:'second',weeks:[2]})
    expect(validateProgression(d,volumeIndex).issues.map(i=>i.code)).toContain('rule.two-volume-ramps')
    expect(run(volumeInput(d)).error?.code).toBe('INVALID_RULES')
  })
})

describe('P4 hold-if-missed replay',()=>{
  it('a missed rep floor in week1 holds week2; another miss holds again cumulatively',()=>{
    const x=volumeInput(undefined,[2,3,4,5]);x.logs=[volumeLog(1,[8,8,7]),volumeLog(2,[8,7,8])]
    expect(counts(run(x))).toEqual([[3,3,3],[3,3,3],[5,4,3],[6,6,3]])
    expect(run(x).weeks[1]!.slots[0]!.why[0]!.inputs.holds).toBe(2)
  })
  it('only last prior ramp weeks count; future-week misses cannot hold earlier prescriptions',()=>{
    const x=volumeInput(undefined,[2]);x.logs=[volumeLog(3,[1,1,1])]
    expect(counts(run(x))).toEqual([[5,4,3]])
  })
  it('disabled hold, absent slots and unrelated workouts cannot suppress growth',()=>{
    const d=volumeProgramme();ramp(d).holdIfMissedReps=false
    const x=volumeInput(d,[2]);x.logs=[volumeLog(1,[1])]
    expect(counts(run(x))).toEqual([[5,4,3]])
    ramp(d).holdIfMissedReps=true
    x.logs=[volumeLog(1,[1],'leg'),volumeLog(1,[1],'a',{entries:[{occurrenceId:'another-cycle',id:'synthetic-chest-a',sets:[{done:true,r:1}]}]})]
    expect(counts(run(x))).toEqual([[5,4,3]])
    x.logs=[];expect(counts(run(x))).toEqual([[5,4,3]])
  })
  it('logged target count/floors win, with targetless fallback to that exact week',()=>{
    const d=volumeProgramme();slots(d,2)[0].reps=12
    const x=volumeInput(d,[2]),w=volumeLog(1,[8,8,8]);x.logs=[w]
    expect(counts(run(x))).toEqual([[5,4,3]])
    delete (w.entries[0] as Record<string,unknown>).target
    expect(counts(run(x))).toEqual([[5,4,3]]) // week1 authored count2 and reps8, not future reps12.
    Object.assign(w.entries[0]!,{target:{slotId:'a',sets:4,reps:8}})
    expect(counts(run(x))).toEqual([[3,3,3]]) // only3 done rows for4 prescribed.
  })
  it.each([
    {target:{rowReps:[8,8,8]},name:'rowReps without scalar sets'},
    {target:{rowReps:[8,8,8],sets:2},name:'rowReps over stale scalar sets'},
    {target:{pyramid:[8,8,8]},name:'pyramid without scalar sets'},
    {target:{pyramid:[8,8,8],sets:2},name:'pyramid over stale scalar sets'},
    {target:{rowReps:[],pyramid:[8,8,8],sets:2},name:'empty rowReps falls back to pyramid'},
  ])('three logged prescribed rows with two done hold the six-set budget: $name',({target})=>{
    const x=volumeInput(undefined,[2]),w=volumeLog(1,[8,8]);x.logs=[w]
    // Authored A=2, but logged A=3: two done rows miss the third. Hold6 ->3:3,
    // rather than increase6+3=9 ->5:4; the unrelated leg slot stays at3.
    Object.assign(w.entries[0]!,{target:{slotId:'a',reps:8,...target}})
    const held=run(x)
    expect(held.error).toBeUndefined();expect(counts(held)).toEqual([[3,3,3]])
    expect(held.weeks[0]!.slots[0]!.why[0]!.inputs).toMatchObject({sets:6,holds:1,increases:0})
    // Completing the third prescribed row earns exactly one +3 increase.
    w.entries[0]!.sets.push({done:true,w:100,r:8})
    const grown=run(x)
    expect(counts(grown)).toEqual([[5,4,3]])
    expect(grown.weeks[0]!.slots[0]!.why[0]!.inputs).toMatchObject({sets:9,holds:0,increases:1})
  })
  it('empty rowReps falls back to historical pyramid rep floors as well as count',()=>{
    const x=volumeInput(undefined,[2]),w=volumeLog(1,[8,8,8]);x.logs=[w]
    Object.assign(w.entries[0]!.target,{rowReps:[],pyramid:[12,12,12],sets:2,reps:8})
    // Three done rows still miss historical12-rep floors: hold6 ->3:3.
    expect(counts(run(x))).toEqual([[3,3,3]])
    w.entries[0]!.sets.forEach(s=>{s.r=12})
    expect(counts(run(x))).toEqual([[5,4,3]])
  })
  it('logged minima take precedence even without logged reps, including row minima',()=>{
    const x=volumeInput(undefined,[2]),w=volumeLog(1,[8,8,8]);x.logs=[w]
    Object.assign(w.entries[0]!,{target:{slotId:'a',sets:3,repsMin:12}})
    expect(counts(run(x))).toEqual([[3,3,3]])
    Object.assign(w.entries[0]!,{target:{slotId:'a',sets:3,reps:12,repsMin:8}})
    expect(counts(run(x))).toEqual([[5,4,3]])
    Object.assign(w.entries[0]!,{target:{slotId:'a',sets:3,repsMin:8,rowRepsMin:[8,9,8]}})
    expect(counts(run(x))).toEqual([[3,3,3]])
  })
  it('validated numeric-string AMRAP minima are parsed for targetless replay',()=>{
    const d=volumeProgramme();slots(d,1)[0].reps='amrap';slots(d,1)[0].repsMin='8'
    const x=volumeInput(d,[2]),w=volumeLog(1,[8,8,8]);x.logs=[w]
    Object.assign(w.entries[0]!,{target:{slotId:'a',sets:3}})
    expect(validateProgression(d,volumeIndex).ok).toBe(true)
    expect(counts(run(x))).toEqual([[5,4,3]])
    slots(d,1)[0].repsMin='9';expect(counts(run(x))).toEqual([[3,3,3]])
  })
  it('warmups and undone work cannot satisfy a floor; AMRAP minima and ranges are literal',()=>{
    const x=volumeInput(undefined,[2]),w=volumeLog(1,[8,8,8]);x.logs=[w]
    Object.assign(w.entries[0]!.sets[1]!,{done:false})
    expect(counts(run(x))).toEqual([[3,3,3]])
    Object.assign(w.entries[0]!.sets[1]!,{done:true,warmup:true})
    expect(counts(run(x))).toEqual([[3,3,3]])
    Object.assign(w.entries[0]!,{target:{slotId:'a',sets:3,reps:'amrap',repsMin:8}})
    delete (w.entries[0]!.sets[1] as Record<string,unknown>).warmup
    expect(counts(run(x))).toEqual([[5,4,3]])
    Object.assign(w.entries[0]!,{target:{slotId:'a',sets:3,reps:'8-12'}})
    expect(counts(run(x))).toEqual([[5,4,3]])
    w.entries[0]!.sets[2]!.r=7;expect(counts(run(x))).toEqual([[3,3,3]])
  })
  it('skipped, active and after-asOf logs do not hold',()=>{
    const x=volumeInput(undefined,[2]);x.logs=[volumeLog(1,[1], 'a',{active:true})]
    expect(counts(run(x))).toEqual([[5,4,3]])
    x.logs=[volumeLog(1,[1])];x.cycle!.occurrences[0]!.status='skipped'
    expect(counts(run(x))).toEqual([[5,4,3]])
    x.cycle!.occurrences[0]!.status='pending';x.asOf='2026-01-04'
    expect(counts(run(x))).toEqual([[5,4,3]])
  })
})

describe('P4 explicit scheduled deload',()=>{
  it('ceil sets once, factor load once, then round once and convert effort scale',()=>{
    const x=volumeInput(undefined,[6]);x.profile.effortScale='rpe'
    slots(x.definition as ReturnType<typeof volumeProgramme>,6)[0].weight=103
    const out=run(x),s=out.weeks[0]!.slots[0]!.sets[0]!
    expect(counts(out)).toEqual([[1,2,2]])
    expect(s.load).toBe(60);expect(s.target).toEqual({rpe:6})
    expect(s.why.find(w=>w.kind==='scheduled-deload')!.inputs).toMatchObject({setsBefore:2,sets:1,loadBefore:103,load:61.8,setsFactor:0.5,loadFactor:0.6})
    expect(s.why.at(-1)!.inputs.roundedFrom).toBeCloseTo(61.8,10)
  })
  it('deload with target-only prescriptions keeps null load and respects explicit RPE effort',()=>{
    const d=volumeProgramme();d.progressionRules[1].effort={rpe:5}
    slots(d,6).forEach((s: any)=>{s.progression.rules=['deload']})
    const out=run(volumeInput(d,[6]))
    expect(out.weeks[0]!.slots[0]!.sets[0]!.load).toBeNull()
    expect(out.weeks[0]!.slots[0]!.sets[0]!.target).toEqual({rir:5})
  })
  it('default deload reflects the ordinary load delta for custom assisted metadata',()=>{
    const x=volumeInput(undefined,[6])
    const index=createExerciseIndex([{id:'synthetic-chest-a',n:'Synthetic assisted press',eq:'leverage machine',assisted:true}])
    const out=evaluate(x,{},index)
    // P4 returns100*.6=60; P2 reflects the -40 delta to100+40=140.
    expect(out.error).toBeUndefined();expect(counts(out)).toEqual([[1,2,2]])
    expect(out.weeks[0]!.slots[0]!.sets[0]!.load).toBe(140)
    expect(out.weeks[0]!.slots[0]!.sets[0]!.why.some(w=>w.text.includes('more assistance'))).toBe(true)
    expect(run(x).weeks[0]!.slots[0]!.sets[0]!.load).toBe(60)
  })
  it('custom assisted ramp lowers100 to95; the later deload reflects95*.6 to133 then rounds135',()=>{
    const x=volumeInput(undefined,[2,6]);x.logs=[volumeLog(1,[8,8])]
    const index=createExerciseIndex([...Object.values(volumeIndex).filter(e=>e.id?.startsWith('synthetic-')),
      {id:'synthetic-chest-a',n:'Synthetic assisted press',eq:'leverage machine',assisted:true,muscleWeights:{chest:1}}])
    const out=evaluate(x,{},index)
    // Completed authored2 rows earn one ramp: budget6+3=9 ->5:4; linear100-5=95.
    // Deload reduces sets2*.5 ->1; ordinary95*.6=57, reflect95+(95-57)=133 ->135.
    expect(out.error).toBeUndefined();expect(counts(out)).toEqual([[5,4,3],[1,2,2]])
    expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.load)).toEqual([95,95,95,95,95])
    expect(out.weeks[1]!.slots[0]!.sets.map(s=>s.load)).toEqual([135])
    expect(out.weeks[1]!.slots[0]!.sets[0]!.why.at(-1)!.inputs.roundedFrom).toBe(133)
    expect(out.weeks[0]!.slots[0]!.sets[0]!.why.some(w=>w.text.includes('less assistance'))).toBe(true)
  })
  it('leaves weeks outside the authored deload untouched and every count/load has Why',()=>{
    const out=run()
    expect(out.weeks[4]!.slots[0]!.sets[0]!.why.some(w=>w.kind==='scheduled-deload')).toBe(false)
    expect(out.weeks[5]!.slots[0]!.sets[0]!.why.map(w=>w.kind)).toEqual(['linear','scheduled-deload','linear'])
    for (const week of out.weeks) for (const slot of week.slots) for (const set of slot.sets) expect(set.why.length).toBeGreaterThan(0)
  })
  it('progression off suppresses only exact deload exposures, before load and TM replay',()=>{
    const d=volumeProgramme();ramp(d).weeks=[1,2,4,5];d.progressionRules[1].weeks=[3]
    const x=volumeInput(d,[4]);x.logs=[volumeLog(3,[8,8])]
    const raw=replayExposures(x,authoredSlots(d))
    expect(raw).toHaveLength(1);expect(progressionExposures(d,raw)).toEqual([])
    expect(run(x).weeks[0]!.slots[0]!.sets[0]!.load).toBe(100)
    x.logs.push(volumeLog(2,[8,8]));expect(run(x).weeks[0]!.slots[0]!.sets[0]!.load).toBe(105)
  })
})

describe('P4 multi-week hypothetical preview',()=>{
  it('appends hypotheses and cuts every week at its start without backward leakage',()=>{
    const x={...volumeInput(undefined,[1,2,3]),hypotheticalLogs:[volumeLog(1,[8,8,8]),volumeLog(2,[8,8,8,8,8])]}
    const out=preview(x,{},volumeIndex)
    expect(out.weeks.map(w=>w.slots[0]!.sets[0]!.load)).toEqual([100,105,105])
    expect(out.warnings).toEqual([])
    expect(counts(out)).toEqual([[3,3,3],[5,4,3],[6,6,3]])
  })
  it('hypothetical failures hold only later weeks; explicit asOf wins over week boundary',()=>{
    const x={...volumeInput(undefined,[1,2,3]),hypotheticalLogs:[volumeLog(1,[8,8,7]),volumeLog(2,[8,8,8])]}
    expect(counts(preview(x,{},volumeIndex))).toEqual([[3,3,3],[3,3,3],[5,4,3]])
    x.asOf='2026-01-04';expect(counts(preview(x,{},volumeIndex))).toEqual([[3,3,3],[5,4,3],[6,6,3]])
  })
  it('week-start logs, including postponed prior occurrences, cannot leak into that week',()=>{
    const x={...volumeInput(undefined,[2,3]),hypotheticalLogs:[volumeLog(1,[1,1,1],'a',{d:'2026-01-12'})]}
    expect(counts(preview(x,{},volumeIndex))).toEqual([[5,4,3],[5,4,3]])
  })
  it('real and hypothetical logs replay deterministically regardless of input ordering',()=>{
    const x={...volumeInput(undefined,[3,1,2,3]),logs:[volumeLog(1,[8,8,8])],hypotheticalLogs:[volumeLog(2,[8,8,8,8,8])]}
    const before=JSON.stringify(x),out=preview(x,{},volumeIndex)
    expect(JSON.stringify(preview(x,{},volumeIndex))).toBe(JSON.stringify(out))
    expect(JSON.stringify(x)).toBe(before)
    expect(JSON.stringify(preview({...x,weeks:[2,3,1],logs:[...x.logs].reverse(),hypotheticalLogs:[...x.hypotheticalLogs].reverse()}, {},volumeIndex))).toBe(JSON.stringify(out))
    expect(projected(volumeInput(undefined,[2])).weeks[0]!.slots[0]!.sets[0]!.load).toBe(100)
  })
  it('supports drafts without a cycle, rejects invalid rules and forwards a custom index',()=>{
    const x=volumeInput(undefined,[2]);delete x.cycle
    expect(counts(preview(x,{},volumeIndex))).toEqual([[5,4,3]])
    const d=volumeProgramme();delete (ramp(d) as Partial<VolumeRampRule>).maxSets
    expect(preview(volumeInput(d),{},volumeIndex).error?.code).toBeDefined()
    expect(preview(volumeInput(d),{},volumeIndex).weeks).toEqual([])
    expect(preview(volumeInput(d,[]),{},volumeIndex).error?.code).toBeDefined()
  })
  it('unknown week indexes outside the date range produce warnings rather than throwing',()=>{
    const out=preview(volumeInput(undefined,[Number.MAX_SAFE_INTEGER]),{},volumeIndex)
    expect(out.weeks).toEqual([])
    expect(out.warnings.some(w=>w.code==='week.missing')).toBe(true)
  })
  it('empty-week preview still forwards custom muscles into composition validation',()=>{
    const d=volumeProgramme()
    d.progressionRules.push({...structuredClone(ramp(d)),id:'second',scope:{slots:[{week:1,day:'d1',session:'main',slot:'a'}]},weeks:[1]})
    slots(d,1)[0].progression.rules.push('second')
    const out=preview(volumeInput(d,[]),{},volumeIndex)
    expect(out.error?.code).toBe('INVALID_RULES')
    expect(out.error && 'issues' in out.error && out.error.issues.some(i=>'code' in i && i.code==='rule.two-volume-ramps')).toBe(true)
  })
})

describe('P4 goldens against corrected P2 shared prescription semantics',()=>{
  it('proportional pyramid count and deload use the actual authored pyramid length',()=>{
    const d=volumeProgramme('proportional')
    for (let week=1;week<=6;week++) slots(d,week)[0].pyramid=[8,8,8,8,8,8] // scalar sets2 is stale.
    const out=run(volumeInput(d,[2,6]))
    expect(out.error).toBeUndefined()
    expect(counts(out)).toEqual([[5,4,3],[3,2,2]]) // budget9 in6:4 ratio ->5:4; deload ceil(6*.5)=3.
  })
  it('dumbbell total40 becomes each20 before +5, then the deload yields15',()=>{
    const d=volumeProgramme(),x=volumeInput(d,[2,6])
    const index=createExerciseIndex([...Object.values(volumeIndex).filter(e=>e.id?.startsWith('synthetic-')),{id:'synthetic-chest-a',n:'Synthetic two-bell press',eq:'dumbbell',bp:'chest',muscleWeights:{chest:1}}])
    Object.assign(x.profile,{dbLoad:{'synthetic-chest-a':{mode:'each',_ts:1}}})
    const w=volumeLog(1,[8,8]);Object.assign(w.entries[0]!.target,{dbLoad:'total'})
    w.entries[0]!.sets.forEach(s=>{s.w=40});x.logs=[w]
    const out=evaluate(x,{},index)
    expect(out.error).toBeUndefined()
    expect(out.weeks.map(week=>week.slots[0]!.sets[0]!.load)).toEqual([25,15])
  })
  it('nonfinite logged loads fail closed before emitting any ramp or deload prescription',()=>{
    const x=volumeInput(undefined,[2,6]),w=volumeLog(1,[8,8]);w.entries[0]!.sets[0]!.w=Infinity;x.logs=[w]
    const out=run(x)
    expect(out.error?.code).toBe('INVALID_LOAD');expect(out.weeks).toEqual([]);expect(out.tm).toEqual({})
  })
  it('linear AMRAP honors per-row minima:8/10 misses8/12, so no load or volume bump',()=>{
    const d=volumeProgramme(),x=volumeInput(d,[2]),a=slots(d,1)[0]
    a.reps='amrap';a.repsMin=5;a.setRepsMin=[8,12]
    const w=volumeLog(1,[8,10]);Object.assign(w.entries[0]!.target,{reps:'amrap',repsMin:5,rowReps:['amrap','amrap'],setRepsMin:[8,12]});x.logs=[w]
    const out=run(x)
    expect(out.error).toBeUndefined();expect(counts(out)).toEqual([[3,3,3]])
    expect(out.weeks[0]!.slots[0]!.sets[0]!.load).toBe(100)
  })
})

describe('P4 TM extension custom-index seam',()=>{
  it('passes the custom single-arm exercise to TM replay: total50 means each50',()=>{
    const d=volumeProgramme(),x=volumeInput(d,[2])
    d.progressionRules=[{id:'pct',kind:'percentage',ref:{lift:'press',basis:'tm'},weeks:{2:[{pct:1,reps:8}]},rounding:{increment:5,mode:'nearest',usePlates:false}}]
    for (let week=1;week<=6;week++) for (const s of slots(d,week)) s.progression.rules=[]
    const a=slots(d,2)[0];a.sets=1;a.progression.rules=['pct'];a.tm={key:'press',percentages:[1],reference:'tm'}
    x.cycle!.tmSeed={press:100}
    const w=volumeLog(1,[8]);w.entries[0]!.sets[0]!.w=50;x.logs=[w]
    const index=createExerciseIndex([{id:'synthetic-chest-a',n:'Synthetic single arm press',eq:'dumbbell'}])
    const out=evaluate(x,{
      timeline:(_input,_slots,exposures,seed,callerIndex=EXIDX)=>{
        const e=exposures[0]!
        const load=e.sets[0]!.w!*meaningFactor('total','each',{id:e.exerciseId},callerIndex)
        return {...seed,press:[{at:e.date,value:load,why:buildWhy('authored','authored',{load})}]}
      },
    },index)
    // Real custom metadata: one bell, factor1 ->TM50 ->100%50.
    // Dropping the forwarded index uses catalogue fallback: factor1/2 ->TM25 ->25.
    expect(out.error).toBeUndefined()
    expect(out.tm.press).toEqual([{at:'2026-01-05',value:50,why:buildWhy('authored','authored',{load:50})}])
    expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.load)).toEqual([50])
  })
})
