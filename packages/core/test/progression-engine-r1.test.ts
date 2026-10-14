import { describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'
import { readFileSync } from 'node:fs'
import { evaluate, authoredSlots, replayExposures, roundLoad } from '../src/progression-engine/index'
import type { EngineInput, EngineExtensions } from '../src/progression-engine/types'
import { createExerciseIndex } from '../src/exercises'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'
const grid={increment:5,mode:'nearest' as const,usePlates:false}
function fixture() {
  const d=syntheticProgramme(),slot=syntheticSlot(d)
  slot.sets=3;slot.reps=5;slot.weight=100;slot.progression.rules=['linear']
  d.progressionRules=[{id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{...grid}}]
  const x: EngineInput={definition:d,logs:[],weeks:[1],profile:{unit:'lb',effortScale:'rir'},cycle:{id:'c',weekIndex:1,week1StartDate:'2026-01-05',occurrences:[{instanceId:'o',weekIndex:1,dayKey:'d1',ordinal:1,routineId:'r',sessionTemplateId:'main',status:'pending'}]}}
  return {d,slot,x}
}
function logged(x: EngineInput, reps: number[], weight=100, target: Record<string,unknown>={sets:3,reps:5}) {
  x.logs=[{id:'w',d:'2026-01-05',start:1,unit:'lb',entries:[{id:'0025',occurrenceId:'o',target:{slotId:'bench',...target},sets:reps.map(r=>({done:true,w:weight,r}))}]}]
}
const prescribed=(x: EngineInput, extensions: EngineExtensions={}, index?: ReturnType<typeof createExerciseIndex>)=>evaluate(x,extensions,index).weeks[0]!.slots[0]!.sets
// HAND-COMPUTED before implementation; comments show the arithmetic behind literals.
describe('hand-computed load goldens',()=>{
  it('pyramid [8,6,4] overrides sets:1 in prescription and replay',()=>{
    const {slot,x}=fixture();slot.sets=1;slot.pyramid=[8,6,4]
    expect(prescribed(x).map(s=>s.reps)).toEqual([8,6,4])
    logged(x,[8,6,3],100,{sets:1,reps:5,pyramid:[8,6,4]})
    // Final set misses4: hold100. Complete [8,6,4] earns100+5=105.
    expect(prescribed(x).map(s=>s.load)).toEqual([100,100,100])
    logged(x,[8,6,4],100,{sets:1,reps:5,rowReps:[8,6,4]})
    expect(prescribed(x).map(s=>s.load)).toEqual([105,105,105])
  })
  it('empty historical rowReps does not hide the pyramid count or final floor',()=>{
    const {slot,x}=fixture();slot.sets=1;slot.pyramid=[8,6,4]
    logged(x,[8,6,3],100,{sets:1,reps:5,rowReps:[],pyramid:[8,6,4]})
    // Empty cache is absent; last3<4 holds100, not105.
    expect(prescribed(x).map(s=>s.load)).toEqual([100,100,100])
  })
  it('set-count extensions receive3 pyramid rows and repeat the final row on a ramp',()=>{
    const {d,slot,x}=fixture();slot.sets=1;slot.pyramid=[8,6,4]
    slot.progression.rules.push('ramp');d.progressionRules.push({id:'ramp',kind:'volume-ramp',scope:{slots:[{week:1,day:'d1',session:'main',slot:'bench'}]},startSets:3,addPerWeek:1,maxSets:4,weeks:[1],distribute:'round-robin-by-slot-order',holdIfMissedReps:false})
    const sets=prescribed(x,{setCount:(_ctx,count)=>{expect(count).toBe(3);return {count:4,why:[]}}})
    expect(sets.map(s=>s.reps)).toEqual([8,6,4,4]);expect(sets.map(s=>s.load)).toEqual([100,100,100,100])
  })
  it.each(['all-sets-all-reps','last-set-reps'])('AMRAP %s uses historical per-set min, scalar, then authored floor',success=>{
    const {d,slot,x}=fixture();d.progressionRules[0].success=success;slot.reps='max';slot.repsMin=1;slot.setRepsMin=[2,2,2]
    // 3<5: hold100; scalar1/current authored2 would wrongly award105.
    logged(x,[3,3,3],100,{sets:3,reps:'max',repsMin:1,setRepsMin:[5,5,5]})
    expect(prescribed(x).map(s=>s.load)).toEqual([100,100,100])
    logged(x,[5,5,5],100,{sets:3,reps:'max',repsMin:1,setRepsMin:[5,5,5]})
    expect(prescribed(x).map(s=>s.load)).toEqual([105,105,105])
    logged(x,[3,3,3],100,{sets:3,reps:'max',repsMin:4});expect(prescribed(x)[0]!.load).toBe(100)
    logged(x,[2,2,2],100,{sets:3,reps:'max'});expect(prescribed(x)[0]!.load).toBe(105)
  })
  it.each(['all-sets-all-reps','last-set-reps'])('AMRAP numeric-string floors preserve precedence: %s',success=>{
    const {d,slot,x}=fixture();d.progressionRules[0].success=success;slot.reps='max';slot.repsMin='1';slot.setRepsMin=['2','2','2']
    logged(x,[3,3,3],100,{sets:3,reps:'max',repsMin:1,setRepsMin:['5','5','5']})
    expect(prescribed(x).map(s=>s.load)).toEqual([100,100,100]);expect(prescribed(x).map(s=>s.repsMin)).toEqual([2,2,2])
    logged(x,[3,3,3],100,{sets:3,reps:'max',repsMin:'4'});expect(prescribed(x)[0]!.load).toBe(100)
    logged(x,[1,1,1],100,{sets:3,reps:'max'});expect(prescribed(x)[0]!.load).toBe(100)
    delete slot.setRepsMin;slot.repsMin='5';expect(prescribed(x).map(s=>s.repsMin)).toEqual([5,5,5])
  })
  it.each([
    {from:'total',to:'each',w:100,next:55}, // 100/2+5=55 each
    {from:'each',to:'total',w:50,next:105}, // 50*2+5=105 total
    {from:'as',to:'each',w:100,next:105}, // as entered stays100; +5
    {from:'total',to:'as',w:100,next:105},
  ])('bell replay $from -> $to',({from,to,w,next})=>{
    const {slot,x}=fixture();slot.id='bell';slot.weight=50;slot.dbLoad=to
    const index=createExerciseIndex([{id:'bell',name:'Synthetic press',eq:'dumbbell'}])
    logged(x,[5,5,5],w,{sets:3,reps:5,dbLoad:from});(x.logs[0] as any).entries[0].id='bell'
    expect(prescribed(x,{},index).map(s=>s.load)).toEqual([next,next,next])
  })
  it('caller index preserves one-arm custom meaning and profile fallback',()=>{
    const {slot,x}=fixture();slot.id='one-bell';slot.weight=50;(x.profile as any).dbLoad={'one-bell':{mode:'each'}}
    const index=createExerciseIndex([{id:'one-bell',n:'Synthetic single arm press',eq:'dumbbell'}])
    logged(x,[5,5,5],50,{sets:3,reps:5,dbLoad:'total'});(x.logs[0] as any).entries[0].id='one-bell'
    // One bell: total50=each50; +5=55. Dropping index halves it and gives30.
    expect(prescribed(x,{},index)[0]!.load).toBe(55)
  })
  it('normalizes kg total to lb each at full precision before progression',()=>{
    const {d,slot,x}=fixture();slot.id='bell';slot.dbLoad='each';d.progressionRules[0].rounding.increment=0.1
    const index=createExerciseIndex([{id:'bell',n:'Synthetic press',eq:'dumbbell'}])
    logged(x,[5,5,5],90.5,{sets:3,reps:5,dbLoad:'total'});(x.logs[0] as any).entries[0].id='bell';(x.logs[0] as any).unit='kg'
    // 90.5/2=45.25kg; *2.2046226218=99.75917363645lb; +5=104.75917363645 ->104.8.
    expect(prescribed(x,{},index)[0]!.load).toBe(104.8)
  })
  it('numeric authored strings normalize to a100 seed',()=>{
    const {slot,x}=fixture();for (const weight of ['100',' 100 ','1e2']) {slot.weight=weight;expect(prescribed(x).map(s=>s.load)).toEqual([100,100,100])}
  })
  it('duplicate occurrence ids: every2 holds100 after one successful workout',()=>{
    const {d,x}=fixture();d.progressionRules[0].every={sessions:2};x.cycle!.occurrences.push(structuredClone(x.cycle!.occurrences[0]!));logged(x,[5,5,5])
    expect(replayExposures(x,authoredSlots(d))).toHaveLength(1);expect(prescribed(x).map(s=>s.load)).toEqual([100,100,100])
  })
  it('duplicate workout identities cannot manufacture a second success',()=>{
    const {d,x}=fixture();d.progressionRules[0].every={sessions:2};logged(x,[5,5,5]);x.logs.push(structuredClone(x.logs[0]))
    expect(replayExposures(x,authoredSlots(d))).toHaveLength(1);expect(prescribed(x)[0]!.load).toBe(100)
    // The same exercise/occurrence in a genuinely different workout remains another exposure.
    ;(x.logs[1] as any).id='different-workout'
    expect(replayExposures(x,authoredSlots(d))).toHaveLength(2);expect(prescribed(x)[0]!.load).toBe(105)
    for (const w of x.logs as any[]) {delete w.id;w.key='shared-workout-key'}
    expect(replayExposures(x,authoredSlots(d))).toHaveLength(1);expect(prescribed(x)[0]!.load).toBe(100)
  })
  it('inventory warning:97.5 ->135, delta37.5 >max(9.75,10)',()=>{
    const {d,slot,x}=fixture();slot.weight=97.5;d.progressionRules[0].rounding.usePlates=true;x.profile.plates={lb:{45:1,5:1}}
    const result=evaluate(x),why=result.weeks[0]!.slots[0]!.sets[0]!.why.at(-1)!
    expect(why.inputs).toMatchObject({roundedFrom:97.5,roundedTo:135,roundingTolerance:10,inventoryWarning:true})
    expect(why.text).toContain('Warning:');expect(result.warnings.some(w=>w.code==='rounding.large-adjustment')).toBe(true);expect(prescribed(x)[0]!.load).toBe(135)
    const p={unit:'lb' as const,plates:{lb:{45:1,5:1}}}
    expect(roundLoad(125,'lb',{...grid,usePlates:true},p,{id:'0025'}).inputs.inventoryWarning).toBeUndefined() // delta10 <=12.5
    expect(roundLoad(70,'lb',{...grid,usePlates:true},p,{id:'0025'}).inputs.inventoryWarning).toBe(true) // 70->55, down15>10
    expect(roundLoad(65,'lb',{...grid,usePlates:true},p,{id:'0025'}).inputs.inventoryWarning).toBeUndefined() // delta10 equals10
  })
})
describe('custom-index output regressions',()=>{
  it('validation sees two muscle ramps affecting the same custom slot',()=>{
    const {d,slot,x}=fixture();slot.id='compound'
    const index=createExerciseIndex([{id:'compound',name:'Synthetic compound',eq:'barbell',primaries:['chest','triceps']}])
    for (const muscle of ['chest','triceps']) {slot.progression.rules.push(muscle);d.progressionRules.push({id:muscle,kind:'volume-ramp',scope:{muscles:[muscle]},startSets:3,addPerWeek:1,maxSets:4,weeks:[1],distribute:'round-robin-by-slot-order',holdIfMissedReps:false})}
    expect(evaluate(x,{},index)).toMatchObject({weeks:[],error:{code:'INVALID_RULES',issues:expect.arrayContaining([expect.objectContaining({code:'rule.two-volume-ramps'})])}})
    expect(evaluate(x).error).toBeUndefined()
  })
  it('evaluate forwards index to rounding for a custom bar',()=>{
    const {d,slot,x}=fixture();slot.id='bar';slot.weight=97.5;d.progressionRules[0].rounding.usePlates=true;x.profile.plates={lb:{45:1,5:1}}
    const index=createExerciseIndex([{id:'bar',name:'Synthetic bar',eq:'barbell'}])
    expect(prescribed(x,{},index)[0]!.load).toBe(135);expect(prescribed(x)[0]!.load).toBe(100)
  })
  it('forwards the caller index on the inert dbLoadFor edge (helper only reads stored choices)',()=>{
    const ast=parse(readFileSync(new URL('../src/progression-engine/rules.ts',import.meta.url),'utf8'),{sourceType:'module',plugins:['typescript']})
    const calls: any[]=[]
    function visit(node: any): void {
      if (!node || typeof node !== 'object') return
      if (node.type==='CallExpression' && node.callee?.name==='dbLoadFor') calls.push(node)
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value==='object') visit(value)
    }
    visit(ast);expect(calls).toHaveLength(1)
    expect(calls[0].arguments.at(-1)).toMatchObject({type:'MemberExpression',object:{name:'context'},property:{name:'index'}})
  })
  it('roundLoad forwards index to custom bar base weight:45+2*5=55',()=>{
    const index=createExerciseIndex([{id:'bar',name:'Synthetic bar',eq:'barbell'}])
    expect(roundLoad(55,'lb',{...grid,usePlates:true},{unit:'lb',plates:{lb:{5:1}}},{id:'bar'},index).load).toBe(55)
  })
})
describe('non-finite loads fail visibly',()=>{
  it.each([Infinity,-Infinity,NaN,1e308])('logged kg load %s cannot become an lb prescription',weight=>{
    const {x}=fixture();logged(x,[5,5,5],weight);(x.logs[0] as any).unit='kg'
    expect(evaluate(x)).toMatchObject({weeks:[],tm:{},error:{code:'INVALID_LOAD'},warnings:[{code:'load.invalid'}]})
  })
  it('rounding overflow and extension output fail closed',()=>{
    const {d,slot,x}=fixture();slot.weight=1e308;d.progressionRules[0].rounding.increment=1e-308;expect(evaluate(x).error?.code).toBe('INVALID_LOAD')
    const clean=fixture();clean.d.progressionRules.push({id:'deload',kind:'scheduled-deload',weeks:[1],setsFactor:1,loadFactor:1,progressionDuring:'off'});clean.slot.progression.rules.push('deload')
    expect(evaluate(clean.x,{deload:(_ctx,sets)=>sets.map(s=>({...s,load:Infinity}))})).toMatchObject({weeks:[],error:{code:'INVALID_LOAD'}})
  })
  it.each([Infinity,-Infinity,NaN])('non-finite extension count %s fails before allocating rows',count=>{
    const {d,slot,x}=fixture();slot.progression.rules.push('ramp');d.progressionRules.push({id:'ramp',kind:'volume-ramp',scope:{slots:[{week:1,day:'d1',session:'main',slot:'bench'}]},startSets:3,addPerWeek:1,maxSets:4,weeks:[1],distribute:'round-robin-by-slot-order',holdIfMissedReps:false})
    expect(evaluate(x,{setCount:()=>({count,why:[]})})).toMatchObject({weeks:[],error:{code:'INVALID_LOAD'},warnings:[{code:'load.invalid'}]})
  })
  it('non-finite plate counts fail instead of entering an unbounded inventory loop',()=>{
    const {d,x}=fixture();d.progressionRules[0].rounding.usePlates=true;x.profile.plates={lb:{5:Infinity}}
    expect(evaluate(x)).toMatchObject({weeks:[],error:{code:'INVALID_LOAD'}})
  })
  it('non-finite frozen TM and percentage multiplication overflow return a typed error',()=>{
    const {d,slot,x}=fixture();slot.sets=1;slot.progression.rules=['pct'];slot.tm={key:'bench',percentages:[1],reference:'tm'}
    d.progressionRules=[{id:'pct',kind:'percentage',ref:{lift:'bench',basis:'tm'},weeks:{1:[{pct:1.5,reps:5}]},rounding:grid}]
    for (const seed of [Infinity,NaN,1.7e308]) {x.cycle!.tmSeed={bench:seed};expect(evaluate(x)).toMatchObject({weeks:[],tm:{},error:{code:'INVALID_LOAD'}})}
  })
})
