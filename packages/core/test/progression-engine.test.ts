import { describe, expect, it } from 'vitest'
import { authoredSlots, buildTmTimeline, buildWhy, chooseLoad, convertWeightPrecise, evaluate, exposureSuccess, replayExposures, roundLoad, tmAt } from '../src/progression-engine/index'
import type { EngineInput, EngineExtensions } from '../src/progression-engine/types'
import type { ProgressionRule, Rounding } from '../../contract/domain/progression'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'
import { convertWeight } from '@opengym/core/units'
import { validateProgression } from '../src/progression-validate'
import { createExerciseIndex } from '../src/exercises'

const rounding: Rounding={increment:5,mode:'nearest',usePlates:false}
const linear=(): ProgressionRule=>({id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding})
const double=(): ProgressionRule=>({id:'double',kind:'double',increment:5,unit:'lb',repsLow:8,repsHigh:12,condition:'all-sets',afterIncrease:'reset-to-low',rounding})
function programme(rule: ProgressionRule, weeks=5, unit: 'lb'|'kg'='lb') {
  const d=syntheticProgramme(), original=d.weeks[0]
  d.unit=unit;d.lengthWeeks=weeks
  d.progressionRules=[rule];d.tmSeeds={bench:{value:100,unit}}
  d.weeks=Array.from({length:weeks},(_,i)=>({...structuredClone(original),index:i+1}))
  for (const w of d.weeks) {
    const s=w.days[0].sessions[0].routineSnapshot.ex[0]
    s.sets=3;s.reps=5;s.weight=135;s.tm={key:'bench',percentages:[0.65,0.75,0.85],reference:'tm'};s.progression.rules=[rule.id]
  }
  return d
}
function input(d: unknown, week=1): EngineInput {
  return {definition:d,cycle:{id:'cycle',week1StartDate:'2026-01-05',weekIndex:week,tmSeed:{bench:100},occurrences:Array.from({length:5},(_,i)=>({instanceId:`o${i+1}`,weekIndex:i+1,dayKey:'d1',ordinal:1,routineId:`r${i+1}`,sessionTemplateId:'main',status:'pending'}))},logs:[],profile:{unit:'lb',effortScale:'rir'},weeks:[week]}
}
function log(n: number, load: number, reps: number[], date?: string) {
  return {id:`log${n}`,d:date ?? `2026-01-${String(5+(n-1)*7).padStart(2,'0')}`,start:n,unit:'lb',entries:[{id:'0025',occurrenceId:`o${n}`,target:{slotId:'bench',sets:3,reps:5},sets:reps.map(r=>({done:true,w:load,r}))}]}
}
const loads=(x: EngineInput)=>evaluate(x).weeks[0]?.slots[0]?.sets.map(s=>s.load)
const assertClean=(x: EngineInput)=>expect(evaluate(x).warnings).toEqual([])

// HAND-COMPUTED GOLDENS: these literals are arithmetic worked before the engine,
// not values captured from evaluate(). percentage-wave set percentages are 65/75/85,
// 70/80/90, 75/85/95; nearest ties round UP. No external paid content.
const waves: ProgressionRule={id:'waves',kind:'percentage',ref:{lift:'bench',basis:'tm'},rounding,weeks:{
  '1':[{pct:0.65,reps:5},{pct:0.75,reps:5},{pct:0.85,reps:'amrap',repsMin:5}],
  '2':[{pct:0.7,reps:3},{pct:0.8,reps:3},{pct:0.9,reps:'amrap',repsMin:3}],
  '3':[{pct:0.75,reps:5},{pct:0.85,reps:3},{pct:0.95,reps:'amrap',repsMin:1}],
}}
const goldenWaves = [
  // lb grid=5: 315*.85=267.75 ->270; 315*.75=236.25 ->235.
  {unit:'lb' as const,tm:100,increment:5,expected:[[65,75,85],[70,80,90],[75,85,95]]},
  {unit:'lb' as const,tm:200,increment:5,expected:[[130,150,170],[140,160,180],[150,170,190]]},
  {unit:'lb' as const,tm:315,increment:5,expected:[[205,235,270],[220,250,285],[235,270,300]]},
  // kg grid=2.5: 142.5*.75=106.875 ->107.5; *.85=121.125 ->120.
  {unit:'kg' as const,tm:50,increment:2.5,expected:[[32.5,37.5,42.5],[35,40,45],[37.5,42.5,47.5]]},
  {unit:'kg' as const,tm:100,increment:2.5,expected:[[65,75,85],[70,80,90],[75,85,95]]},
  {unit:'kg' as const,tm:142.5,increment:2.5,expected:[[92.5,107.5,120],[100,115,127.5],[107.5,120,135]]},
]
describe('hand-computed progression goldens',()=>{
  for (const table of goldenWaves) it(`percentage-wave at TM ${table.tm} ${table.unit}`,()=>{
    const rule=structuredClone(waves);rule.rounding.increment=table.increment
    const x=input(programme(rule,3,table.unit));x.cycle!.tmSeed={bench:table.tm};x.profile.unit=table.unit;x.weeks=[1,2,3]
    const result=evaluate(x)
    expect(result.warnings).toEqual([])
    expect(result.weeks.map(w=>w.slots[0]!.sets.map(s=>s.load))).toEqual(table.expected)
    expect(result.weeks.map(w=>w.slots[0]!.sets.map(s=>s.reps))).toEqual([[5,5,'amrap'],[3,3,'amrap'],[5,3,'amrap']])
    expect(result.weeks.map(w=>w.slots[0]!.sets[2]!.repsMin)).toEqual([5,3,1])
    expect(result.weeks[0]!.slots[0]!.sets[0]!.why[0]).toMatchObject({kind:'percentage',inputs:{pct:0.65,reference:table.tm,basis:'tm'}})
  })
  it('tiered-strength-style 3x5 linear: 135 ->140 ->hold140 ->145 ->150',()=>{
    const x=input(programme(linear()),5)
    // Independent table: miss 3rd set at 140; repeat, then add 5 on success.
    const rows=[{load:135,reps:[5,5,5],next:140},{load:140,reps:[5,5,4],next:140},{load:140,reps:[5,5,5],next:145},{load:145,reps:[5,5,5],next:150}]
    expect(loads({...x,logs:[]})).toEqual([135,135,135])
    for (const [i,row] of rows.entries()) {
      x.logs.push(log(i+1,row.load,row.reps));x.weeks=[i+2];x.cycle!.weekIndex=i+2
      expect(loads(x)).toEqual([row.next,row.next,row.next]);assertClean(x)
    }
  })
  it('double progression across a stall: 50 ->55 ->hold55 ->hold55 ->60, reset reps to 8',()=>{
    const d=programme(double());for (const w of d.weeks) {const s=w.days[0].sessions[0].routineSnapshot.ex[0];s.weight=50;s.sets=2;s.reps=8}
    const x=input(d,5)
    const rows=[{load:50,reps:[12,12],next:55},{load:55,reps:[11,10],next:55},{load:55,reps:[12,11],next:55},{load:55,reps:[12,12],next:60}]
    for (const [i,row] of rows.entries()) {
      const w=log(i+1,row.load,row.reps);w.entries[0]!.target.sets=2;w.entries[0]!.target.reps=8
      x.logs.push(w);x.weeks=[i+2];x.cycle!.weekIndex=i+2
      expect(loads(x)).toEqual([row.next,row.next]);expect(evaluate(x).weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([8,8]);assertClean(x)
    }
  })
})

describe('replay and success semantics',()=>{
  it('sorts by date, start and workout key; combines only surviving occurrence entries',()=>{
    const x=input(programme(linear()),5), one=log(1,100,[5,5,5]), two=log(2,200,[5,5,5])
    one.d=two.d='2026-01-05';one.start=two.start=2;one.id='z';two.id='a'
    x.logs=[one,two];const slots=authoredSlots(x.definition as never)
    expect(replayExposures(x,slots).map(e=>e.workoutKey)).toEqual(['a','z'])
    x.logs=[{...one,programmeInstance:{cycleId:'cycle',instanceId:'o2'}}]
    expect(replayExposures(x,slots).map(e=>e.occurrenceId)).toEqual(['o1'])
  })
  it('resolves instance and legacy fallbacks exactly, ignores other cycles and modern unrelated IDs',()=>{
    const x=input(programme(linear()),2), w=log(1,135,[5,5,5]);delete (w.entries[0] as Record<string,unknown>).occurrenceId
    const slots=authoredSlots(x.definition as never)
    x.logs=[{...w,programmeInstance:{cycleId:'cycle',instanceId:'o1'}}]
    expect(replayExposures(x,slots)).toHaveLength(1)
    x.logs=[{...w,programmeInstance:{cycleId:'other',instanceId:'o1'}}];expect(replayExposures(x,slots)).toEqual([])
    Object.assign(x.cycle!,{since:100,startsOn:'2026-01-05'})
    x.cycle!.occurrences[0]!.routineName='Main'
    x.logs=[{...w,start:101,routineIds:['r1']}];expect(replayExposures(x,slots)).toHaveLength(1)
    x.logs=[{...w,start:1,name:'Main',routineIds:['r1']}];expect(replayExposures(x,slots)).toHaveLength(1)
    Object.assign(x.cycle!,{strict:true});expect(replayExposures(x,slots)).toEqual([])
    x.logs=[log(1,135,[5,5,5])];(x.logs[0] as typeof w).entries[0]!.occurrenceId='outside';expect(replayExposures(x,slots)).toEqual([])
  })
  it('excludes skipped and future logs, leaves shifted valid occurrences in replay',()=>{
    const x=input(programme(linear()),2)
    x.logs=[log(1,135,[5,5,5],'2026-01-14')];x.asOf='2026-01-13';expect(loads(x)).toEqual([135,135,135])
    x.asOf='2026-01-15';expect(loads(x)).toEqual([140,140,140])
    x.cycle!.occurrences[0]!.status='skipped';expect(loads(x)).toEqual([135,135,135])
    x.cycle!.occurrences[0]!.status='pending';delete x.asOf;x.now='2026-01-13';expect(loads(x)).toEqual([135,135,135])
  })
  it('ignores warmups, undone rows and absent entries; missing prescribed work fails',()=>{
    const x=input(programme(linear()),2), w=log(1,135,[5,5,5])
    w.entries[0]!.sets.unshift({done:true,w:999,r:99,...{warmup:true}})
    x.logs=[w];expect(loads(x)).toEqual([140,140,140])
    w.entries[0]!.sets[2]!.done=false;expect(loads(x)).toEqual([135,135,135])
    w.entries=[];expect(replayExposures(x,authoredSlots(x.definition as never))).toEqual([])
  })
  it('linear last-set success uses prescribed last position, never last completed set',()=>{
    const r=linear();if(r.kind!=='linear')throw Error();r.success='last-set-reps'
    const x=input(programme(r),2), w=log(1,135,[1,1,5]);x.logs=[w]
    expect(loads(x)).toEqual([140,140,140])
    w.entries[0]!.sets[2]!.done=false;w.entries[0]!.sets[1]!.r=5;expect(loads(x)).toEqual([135,135,135])
  })
  it('session cadence requires consecutive successes and resets after failure',()=>{
    const r=linear();if(r.kind!=='linear')throw Error();r.every={sessions:2}
    const x=input(programme(r),5)
    x.logs=[log(1,135,[5,5,5]),log(2,135,[5,4,5]),log(3,135,[5,5,5])];expect(loads(x)).toEqual([135,135,135])
    x.logs.push(log(4,135,[5,5,5]));expect(loads(x)).toEqual([140,140,140])
  })
  it('week cadence counts a successful calendar week once, including shifted dates',()=>{
    const r=linear();if(r.kind!=='linear')throw Error();r.every={weeks:2}
    const x=input(programme(r),5)
    x.logs=[log(1,135,[5,5,5],'2026-01-05'),log(2,135,[5,5,5],'2026-01-07')];expect(loads(x)).toEqual([135,135,135])
    x.logs.push(log(3,135,[5,5,5],'2026-01-15'));expect(loads(x)).toEqual([140,140,140])
    x.logs.push(log(4,135,[5,5,5],'2026-01-16'));expect(loads(x)).toEqual([140,140,140])
  })
  it('double first-set and total-reps conditions retain their distinct thresholds',()=>{
    const d=double();if(d.kind!=='double')throw Error();d.condition='first-set'
    const x=input(programme(d),2);x.logs=[log(1,135,[12,1,1])];expect(loads(x)).toEqual([140,140,140])
    d.condition='total-reps';d.totalThreshold=30;x.definition=programme(d);expect(loads(x)).toEqual([135,135,135])
    x.logs=[log(1,135,[15,10,5])];expect(loads(x)).toEqual([140,140,140])
  })
  it('percentage success checks all required working sets and AMRAP minimum',()=>{
    const x=input(programme(waves),2);x.logs=[log(1,135,[5,5,5])]
    const slots=authoredSlots(x.definition as never), e=replayExposures(x,slots)[0]!
    expect(exposureSuccess(waves,e,slots[0]!)).toBe(true)
    e.sets[2]!.r=4;expect(exposureSuccess(waves,e,slots[0]!)).toBe(false)
    e.sets.pop();expect(exposureSuccess(waves,e,slots[0]!)).toBe(false)
  })
  it('retains actual manual loads rather than returning to the authored seed',()=>{
    const x=input(programme(linear()),2);x.logs=[log(1,150,[5,5,5])];expect(loads(x)).toEqual([155,155,155])
  })
})

describe('immutable TM timeline and authored targets',()=>{
  it('ignores cache changes and applies immutable seed precedence',()=>{
    const x=input(programme(waves));x.cycle!.tm={bench:1000};const before=JSON.stringify(evaluate(x));x.cycle!.tm={bench:7}
    expect(JSON.stringify(evaluate(x))).toBe(before);expect(evaluate(x).tm.bench![0]!.value).toBe(100)
    delete x.cycle!.tmSeed;(x.definition as ReturnType<typeof programme>).tmSeeds.bench={value:200,unit:'lb'}
    expect(evaluate(x).tm.bench![0]!.value).toBe(200);expect(loads(x)).toEqual([130,150,170])
  })
  it('missing seeds produce tm.missing and never use the cache',()=>{
    const x=input(programme(waves));delete x.cycle!.tmSeed;delete (x.definition as ReturnType<typeof programme>).tmSeeds;x.cycle!.tm={bench:200}
    expect(loads(x)).toEqual([null,null,null]);expect(evaluate(x).warnings[0]!.code).toBe('tm.missing')
  })
  it('unfrozen e1RM seeds stay unavailable and later logs cannot rewrite history',()=>{
    const x=input(programme(waves),2);delete x.cycle!.tmSeed;(x.definition as ReturnType<typeof programme>).tmSeeds={bench:{fromE1rm:{pct:0.9}}}
    x.logs=[log(1,100,[5,5,5])]
    const before=evaluate(x);expect(before.tm).toEqual({});expect(before.warnings.some(w=>w.code==='tm.seed-unfrozen')).toBe(true)
    x.logs.push(log(2,200,[5,5,5]));expect(evaluate(x)).toEqual(before)
    x.cycle!.tmSeed={bench:105.03};expect(loads(x)).toEqual([75,85,95]);expect(evaluate(x).warnings).toEqual([])
  })
  it('tmAt changes take effect only on their date',()=>{
    const x=input(programme(waves)), t=buildTmTimeline(x,authoredSlots(x.definition as never),[])
    t.bench!.push({value:110,at:'2026-01-12',why:buildWhy('bump','amrap-tm',{tmDelta:10,repsOver:5})})
    expect(tmAt(t,'bench','2026-01-11')).toBe(100);expect(tmAt(t,'bench','2026-01-12')).toBe(110);expect(tmAt(t,'missing')).toBeNull()
  })
  it('explicit 1rm basis uses timeline reference with a Why label',()=>{
    const r=structuredClone(waves);r.ref.basis='1rm';const x=input(programme(r));x.cycle!.tmSeed={bench:200}
    expect(loads(x)).toEqual([130,150,170]);expect(evaluate(x).weeks[0]!.slots[0]!.sets[0]!.why[0]!.inputs.basis).toBe('1rm')
  })
  it('no load seed stays athlete-picks until a logged working load arrives',()=>{
    const d=programme(linear());for(const w of d.weeks)delete w.days[0].sessions[0].routineSnapshot.ex[0].weight
    const x=input(d,2);expect(loads(x)).toEqual([null,null,null]);expect(evaluate(x).weeks[0]!.slots[0]!.sets[0]!.why[0]!.inputs.reason).toBe('no-seed')
    x.logs=[log(1,155,[5,5,5])];expect(loads(x)).toEqual([160,160,160])
  })
  it('slots without rules stay untouched with their original authored text',()=>{
    const d=syntheticProgramme();syntheticSlot(d).weight=200;syntheticSlot(d).reps='8-12'
    const x=input(d),before=JSON.stringify(d)
    expect(evaluate(x).weeks[0]!.slots).toEqual([]);expect(JSON.stringify(d)).toBe(before)
    delete syntheticSlot(d).reps;expect(evaluate(x).weeks[0]!.slots).toEqual([])
  })
  it('an omitted percentage week stays target-only',()=>{
    const r=structuredClone(waves);delete r.weeks['2'];const x=input(programme(r),2)
    expect(loads(x)).toEqual([null,null,null]);assertClean(x)
  })
})
describe('precise rounding and finite inventories',()=>{
  it.each([['nearest',102.5,105],['down',102.5,100],['up',102.5,105],['nearest',102.49,100]] as const)('%s %s -> %s',(mode,value,expected)=>{
    expect(roundLoad(value,'lb',{...rounding,mode},{unit:'lb'},{id:'0025'})).toMatchObject({load:expected,inputs:{roundedFrom:value,inventory:false}})
  })
  it('precise conversion matches units rounding on 1000 seeded values',()=>{
    let seed=991
    for(let i=0;i<1000;i++) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=seed/10000000
      expect(convertWeight(value,'kg','lb')).toBe(Math.round(convertWeightPrecise(value,'kg','lb')*2)/2)
      expect(convertWeight(value,'lb','kg')).toBe(Math.round(convertWeightPrecise(value,'lb','kg')*4)/4)
    }
    const out=roundLoad(46.5,'kg',{increment:2.5,mode:'nearest',usePlates:false},{unit:'lb'},{id:'0025'})
    expect(out.load).toBeCloseTo(convertWeightPrecise(47.5,'kg','lb'),9);expect(out.inputs.convertedFrom).toBe('46.5 kg')
  })
  it('pair loading uses sparse plate inventories with half-up and directional capacity',()=>{
    const p={unit:'lb' as const,plates:{lb:{'45':1,'5':1}},barWeights:{'0025':45}}
    expect(roundLoad(140,'lb',{...rounding,usePlates:true,mode:'down'},p,{id:'0025'}).load).toBe(135)
    expect(roundLoad(140,'lb',{...rounding,usePlates:true,mode:'up'},p,{id:'0025'}).load).toBe(145)
    expect(roundLoad(140,'lb',{...rounding,usePlates:true},p,{id:'0025'}).load).toBe(145)
    expect(roundLoad(200,'lb',{...rounding,usePlates:true,mode:'up'},p,{id:'0025'}).load).toBeNull()
    expect(roundLoad(200,'lb',{...rounding,usePlates:true,mode:'down'},p,{id:'0025'}).load).toBe(145)
  })
  it('single loading counts both plates and supports a non-greedy stack',()=>{
    const p={unit:'lb' as const,plates:{lb:{'45':1,'5':1}},loadKind:{'0025':'single'},barWeights:{'0025':0}}
    expect(roundLoad(95,'lb',{...rounding,usePlates:true},p,{id:'0025'}).load).toBe(95)
    expect(roundLoad(101,'lb',{...rounding,usePlates:true,mode:'down'},p,{id:'0025'}).load).toBe(100)
    const kg={unit:'kg' as const,plates:{kg:{'5':1,'3':2}},loadKind:{'0025':'single'},barWeights:{'0025':0}}
    expect(roundLoad(6,'kg',{...rounding,usePlates:true},kg,{id:'0025'}).load).toBe(6)
  })
  it('dumbbell inventory honours each/total meaning and custom exercise index',()=>{
    const index=createExerciseIndex([{id:'synthetic-db',name:'Synthetic press',eq:'dumbbell',muscles:['chest']}])
    const p={unit:'lb' as const,dumbbells:{lb:{weights:[20,30,40]}}}
    expect(roundLoad(25,'lb',{...rounding,usePlates:true},p,{id:'synthetic-db',dbLoad:'each'},index)).toMatchObject({load:30,inputs:{inventory:true}})
    expect(roundLoad(50,'lb',{...rounding,usePlates:true},p,{id:'synthetic-db',dbLoad:'total'},index).load).toBe(60)
    expect(roundLoad(15,'lb',{...rounding,usePlates:true,mode:'down'},p,{id:'synthetic-db'},index).load).toBeNull()
  })
  it('absent unit inventory falls back; explicit zero counts allow the bare bar only',()=>{
    const absent={unit:'lb' as const,plates:{kg:{'20':4}}}
    expect(roundLoad(102,'lb',{...rounding,usePlates:true},absent,{id:'0025'})).toMatchObject({load:100,inputs:{inventory:false}})
    const zero={unit:'lb' as const,plates:{lb:{'45':0}},barWeights:{'0025':45}}
    expect(roundLoad(100,'lb',{...rounding,usePlates:true},zero,{id:'0025'})).toMatchObject({load:45,inputs:{inventory:true}})
    expect(chooseLoad([20,30],35,'up')).toBeNull();expect(chooseLoad([20,30],15,'down')).toBeNull();expect(chooseLoad([20,30],25,'nearest')).toBe(30)
  })
})
function shuffled(value: unknown, rng: ()=>number): unknown {
  if(Array.isArray(value))return value.map(x=>shuffled(x,rng))
  if(value && typeof value==='object') {
    const entries=Object.entries(value)
    for(let i=entries.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[entries[i],entries[j]]=[entries[j]!,entries[i]!]}
    return Object.fromEntries(entries.map(([k,v])=>[k,shuffled(v,rng)]))
  }
  return value
}
function deepFreeze(value: unknown): void {
  if(value && typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))deepFreeze(v)}
}
describe('determinism, totality and extension pipeline',()=>{
  it('identical JSON across 1000 recursively shuffled-key inputs',()=>{
    const x=input(programme(linear()),3);x.logs=[log(2,140,[5,5,5]),log(1,135,[5,5,5])];x.weeks=[3,2,1]
    const expected=JSON.stringify(evaluate(x));let seed=7331
    const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
    for(let i=0;i<1000;i++)expect(JSON.stringify(evaluate(shuffled(x,rng) as EngineInput))).toBe(expected)
  })
  it('frozen input never mutates and repeated calls never store counters',()=>{
    const x=input(programme(waves));deepFreeze(x);const before=JSON.stringify(x)
    expect(()=>evaluate(x)).not.toThrow();expect(JSON.stringify(x)).toBe(before)
  })
  it('invalid rules fail closed, including null definitions',()=>{
    const d=programme(linear());d.progressionRules[0].increment='5';const out=evaluate(input(d))
    expect(out.error?.code).toBe('INVALID_DEFINITION');expect(out.weeks).toEqual([]);expect(out.warnings.some(w=>w.code==='definition.invalid')).toBe(true);expect(evaluate(input(null)).weeks).toEqual([])
  })
  it('deduplicates and sorts weeks and reports an absent week',()=>{
    const x=input(programme(waves));x.weeks=[3,1,1,99];expect(evaluate(x).weeks.map(w=>w.index)).toEqual([1,3]);expect(evaluate(x).warnings[0]!.code).toBe('week.missing')
  })
  it('Why uses fixed templates and canonical scalar inputs',()=>{
    const why=buildWhy('linear','linear',{period:'sessions',bumps:2,increment:5,every:1})
    expect(why.text).toBe('Add 5 after every 1 successful sessions; 2 increases earned.');expect(Object.keys(why.inputs)).toEqual(['bumps','every','increment','period'])
    expect(buildWhy('linear','linear',{inventory:true,roundedFrom:103,rounding:'up'}).text).toBe('Round 103 using owned inventory (up).')
  })
  it('timeline -> set count -> load -> stall -> deload -> single final rounding',()=>{
    const r: ProgressionRule={id:'rpe',kind:'rpe-load',lift:'bench',weeks:{'*':[{reps:5,rpe:8},{reps:5,rpe:8},{reps:5,rpe:8}]},rounding,e1rm:{window:{sessions:3},pick:'best',formula:'epley',useLoggedEffort:true},whenNoData:{kind:'athlete-picks'}}
    const d=programme(r),s=syntheticSlot(d);d.progressionRules.push({id:'deload',kind:'scheduled-deload',weeks:[1],setsFactor:0.5,loadFactor:0.6,progressionDuring:'off'},{id:'stall',kind:'stall',after:2,action:{kind:'repeat'},appliesTo:'load'})
    s.progression.rules.push('deload');s.progression.onStall='stall';const events: string[]=[]
    const ext: EngineExtensions={timeline:(_i,_s,_e,t)=>{events.push('timeline');return t},setCount:()=>{events.push('count');return{count:2,why:[]}},
      load:c=>{events.push('load');return[{reps:5,load:103,unit:'lb',why:[buildWhy(c.rule.id,c.rule.kind,{e1rm:130})]}]},
      stall:(_c,sets)=>{events.push('stall');return sets.map(s=>({...s,load:s.load!*0.9}))},deload:(_c,sets)=>{events.push('deload');return sets.map(s=>({...s,load:s.load!*0.6}))}}
    const out=evaluate(input(d),ext);expect(out.warnings).toEqual([]);expect(events).toEqual(['timeline','count','load','stall','deload'])
    expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.load)).toEqual([55,55]);expect(out.weeks[0]!.slots[0]!.sets[0]!.why.at(-1)!.inputs.roundedFrom).toBeCloseTo(55.62,10)
  })
  it('extension kinds without handlers are explicit unsupported warnings',()=>{
    const d=programme(linear());d.progressionRules.push({id:'stall',kind:'stall',after:2,action:{kind:'repeat'},appliesTo:'load'});syntheticSlot(d).progression.onStall='stall'
    expect(evaluate(input(d),{stall:undefined}).warnings[0]!.code).toBe('rule.unsupported')
  })
})

describe('historical targets and explanation coverage',()=>{
  it('percentage load preserves authored effort in the selected profile scale',()=>{
    const x=input(programme(waves));expect(evaluate(x).weeks[0]!.slots[0]!.sets[0]!.target).toEqual({pct:0.65,rir:2})
    x.profile.effortScale='rpe';expect(evaluate(x).weeks[0]!.slots[0]!.sets[0]!.target).toEqual({pct:0.65,rpe:8})
  })
  it('old targetless logs use their own week prescription, not the future goal',()=>{
    const d=programme(linear());d.weeks[1].days[0].sessions[0].routineSnapshot.ex[0].reps=10
    const x=input(d,2),w=log(1,135,[5,5,5]);delete (w.entries[0] as Record<string,unknown>).target;x.logs=[w]
    expect(loads(x)).toEqual([140,140,140]);expect(evaluate(x).weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([10,10,10])
  })
  it('every Why input is an allowed scalar rather than undefined or a nested value',()=>{
    const x=input(programme(linear()),2);x.logs=[log(1,135,[5,5,5])]
    for(const s of evaluate(x).weeks[0]!.slots[0]!.sets) for(const why of s.why) for(const v of Object.values(why.inputs))expect(v===null || ['number','string','boolean'].includes(typeof v)).toBe(true)
  })
  it('rule validation produces a typed INVALID_RULES and zero prescriptions',()=>{
    const d=programme(linear());d.progressionRules.push({...double(),id:'other'});syntheticSlot(d).progression.rules.push('other')
    const out=evaluate(input(d));expect(out.error?.code).toBe('INVALID_RULES');expect(out.weeks).toEqual([])
    expect((out.error && 'issues' in out.error ? out.error.issues : []).some(i=>'code' in i && i.code==='rule.two-load-rules')).toBe(true)
  })
})

describe('Opus-requested hand-computed rounding additions',()=>{
  it('exact ties round upward: lb TM150 at65% and kg TM125 at75%',()=>{
    const lb=input(programme(waves));lb.cycle!.tmSeed={bench:150}
    expect(loads(lb)).toEqual([100,115,130]) // 97.5,112.5,127.5 ->100,115,130 (5 lb grid).
    const r=structuredClone(waves);r.rounding.increment=2.5
    const kg=input(programme(r,3,'kg'));kg.profile.unit='kg';kg.cycle!.tmSeed={bench:125}
    expect(loads(kg)).toEqual([82.5,95,107.5]) //81.25,93.75,106.25 ->82.5,95,107.5.
  })
  it('limited inventory wave table: 45lb bar plus one pair45 and one pair5',()=>{
    const r=structuredClone(waves);r.rounding.usePlates=true
    const x=input(programme(r,3));x.weeks=[1,2,3];x.cycle!.tmSeed={bench:150}
    Object.assign(x.profile,{plates:{lb:{'45':1,'5':1}},barWeights:{'0025':45}})
    // Buildable totals ONLY [45,55,135,145]. Raw [97.5,112.5,127.5],
    // [105,120,135], [112.5,127.5,142.5]. Choose nearest, ties upward.
    const expected=[[135,135,135],[135,135,135],[135,135,145]]
    const out=evaluate(x);expect(out.weeks.map(w=>w.slots[0]!.sets.map(s=>s.load))).toEqual(expected)
    expect(out.weeks[0]!.slots[0]!.sets[0]!.why.at(-1)!.inputs).toMatchObject({roundedFrom:97.5,inventory:true})
  })
})
describe('rep representation errors and numeric normalization',()=>{
  it('unsupported rep text gives a slot error while another slot still evaluates',()=>{
    const d=programme(linear()),s=syntheticSlot(d);s.reps='choose your reps'
    const good={...structuredClone(s),slotId:'valid',reps:5};d.weeks[0].days[0].sessions[0].routineSnapshot.ex.push(good)
    const out=evaluate(input(d));expect(out.error).toBeUndefined();expect(out.slotErrors).toEqual([{code:'UNSUPPORTED_REPS',slot:{week:1,day:'d1',session:'main',slot:'bench'}}])
    expect(out.weeks[0]!.slots.map(s=>s.ref.slot)).toEqual(['valid']);expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([5,5,5])
  })
  it('numeric strings normalize; double accepts an authored min-max range',()=>{
    const d=programme(linear());syntheticSlot(d).reps='5';const out=evaluate(input(d))
    expect(out.slotErrors).toBeUndefined();expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([5,5,5])
    const range=programme(double());syntheticSlot(range).reps='8-12'
    expect(evaluate(input(range)).weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([8,8,8])
  })
  it('timed or omitted reps on attached slots are never invented',()=>{
    const d=programme(linear());delete syntheticSlot(d).reps;syntheticSlot(d).sec=30
    expect(evaluate(input(d)).slotErrors?.[0]?.code).toBe('UNSUPPORTED_REPS');expect(evaluate(input(d)).weeks[0]!.slots).toEqual([])
  })
  it('legacy combined workouts associate entry rid with its own occurrence',()=>{
    const d=programme(linear());for(const w of d.weeks){const day=structuredClone(w.days[0]);day.key='d2';w.days.push(day)}
    const x=input(d,2);x.cycle!.since=0;x.cycle!.occurrences.push({...x.cycle!.occurrences[0]!,instanceId:'second',routineId:'r-second',dayKey:'d2'})
    const a=log(1,135,[5,5,5]).entries[0]!;delete (a as Record<string,unknown>).occurrenceId
    const b=structuredClone(a);b.sets.forEach(s=>{s.w=200;s.r=1})
    x.logs=[{id:'combined',d:'2026-01-05',start:1,routineIds:['r1','r-second'],entries:[{...a,rid:'r1'},{...b,rid:'r-second'}]}]
    expect(replayExposures(x,authoredSlots(d)).map(e=>[e.ref.day,e.sets[0]!.w,e.sets[0]!.r])).toEqual([['d1',135,5],['d2',200,1]])
  })
  it('unhandled TM rules emit unsupported diagnostics, never silently disappear',()=>{
    const d=programme(waves);d.progressionRules.push({id:'bump',kind:'amrap-tm',lift:'bench',source:{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:2},bands:[{minRepsOver:0,tmDelta:5}],unit:'lb',at:'end-of-week'})
    expect(evaluate(input(d),{timeline:undefined}).warnings.some(w=>w.code==='rule.unsupported')).toBe(true)
  })
})

describe('composition failures never produce guessed loads',()=>{
  function rejected(d: ReturnType<typeof programme>, code: string) {
    const out=evaluate(input(d))
    expect(out.error?.code).toBe('INVALID_RULES');expect(out.weeks).toEqual([])
    expect((out.error && 'issues' in out.error ? out.error.issues : []).some(i=>'code' in i && i.code===code)).toBe(true)
  }
  it('two volume ramps on one muscle scope are invalid',()=>{
    const d=programme(linear()),r={id:'ramp',kind:'volume-ramp',scope:{muscles:['chest']},startSets:3,addPerWeek:1,maxSets:6,weeks:[1],distribute:'round-robin-by-slot-order',holdIfMissedReps:false}
    d.progressionRules.push(r,{...structuredClone(r),id:'ramp-two'});syntheticSlot(d).progression.rules.push('ramp','ramp-two')
    rejected(d,'rule.two-volume-ramps')
  })
  it('more than one AMRAP bump per lift is invalid',()=>{
    const d=programme(waves),bump={id:'bump',kind:'amrap-tm',lift:'bench',source:{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:2},bands:[{minRepsOver:0,tmDelta:5}],unit:'lb',at:'end-of-week'}
    d.progressionRules.push(bump,{...structuredClone(bump),id:'bump-two'})
    rejected(d,'rule.multiple-amrap-bumps')
  })
  it('AMRAP bumps cannot use a fixed-rep source',()=>{
    const d=programme(waves);d.progressionRules.push({id:'bump',kind:'amrap-tm',lift:'bench',source:{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:0},bands:[{minRepsOver:0,tmDelta:5}],unit:'lb',at:'end-of-week'})
    rejected(d,'rule.amrap-source-not-amrap')
  })
  it('TM stall requires an explicit slot TM key',()=>{
    const d=programme(linear());delete syntheticSlot(d).tm
    d.progressionRules.push({id:'stall',kind:'stall',after:2,action:{kind:'reset',pct:0.9},appliesTo:'tm'});syntheticSlot(d).progression.onStall='stall'
    rejected(d,'rule.tm-stall-without-key')
  })
  it('authoring-time reps issue and engine slot error agree on the exact fixture',()=>{
    const d=programme(linear());syntheticSlot(d).reps='8-12'
    const issue=validateProgression(d).issues.find(i=>i.code==='rule.reps-unsupported')
    const out=evaluate(input(d));expect(issue?.ref).toEqual(out.slotErrors?.[0]?.slot)
    expect(out.slotErrors?.[0]?.code).toBe('UNSUPPORTED_REPS');expect(out.error).toBeUndefined();expect(out.weeks[0]!.slots).toEqual([])
  })
})
