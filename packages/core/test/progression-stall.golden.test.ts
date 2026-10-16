import { describe, expect, it } from 'vitest'
import { evaluate, p3Extensions, type EngineInput } from '../src/progression-engine'
import { syntheticProgramme } from './fixtures/synthetic-programme'

const stallExtensions = p3Extensions
// P3-MUST-ENABLE: its registry extra gate must run scripts/assert-stall-golden-enabled.ts.
describe('P3-MUST-ENABLE real TM stall-rule hand-computed golden',()=>{
  it('two failed exposures reset immutable TM200 by .9 to180 for the next week',()=>{
    const d=syntheticProgramme(),week=d.weeks[0]
    d.lengthWeeks=3;d.tmSeeds={bench:{value:200,unit:'lb'}}
    d.weeks=[1,2,3].map(index=>({...structuredClone(week),index}))
    d.progressionRules=[{id:'wave',kind:'percentage',ref:{lift:'bench',basis:'tm'},weeks:Object.fromEntries([1,2,3].map(w=>[w,[{pct:0.65,reps:5},{pct:0.75,reps:5},{pct:0.85,reps:5}]])),rounding:{increment:5,mode:'nearest',usePlates:false}},
      {id:'stall',kind:'stall',after:2,action:{kind:'reset',pct:0.9},appliesTo:'tm'}]
    for(const w of d.weeks){const s=w.days[0].sessions[0].routineSnapshot.ex[0];s.sets=3;s.reps=5;s.tm={key:'bench',percentages:[0.65,0.75,0.85],reference:'tm'};s.progression.rules=['wave'];s.progression.onStall='stall'}
    const x: EngineInput={definition:d,cycle:{id:'cycle',tmSeed:{bench:200},week1StartDate:'2026-01-05',weekIndex:1,occurrences:[1,2,3].map(w=>({instanceId:`o${w}`,weekIndex:w,dayKey:'d1',ordinal:1,routineId:`r${w}`,sessionTemplateId:'main',status:'pending'}))},profile:{unit:'lb',effortScale:'rir'},logs:[],weeks:[1]}
    // Hand arithmetic: seed 200*.65/.75/.85 ->130/150/170. After TWO
    // failures 200*.9=180; 180*.65/.75/.85=117/135/153 ->115/135/155.
    const expected=[[130,150,170],[130,150,170],[115,135,155]]
    for(let i=0;i<3;i++) {
      x.weeks=[i+1];x.cycle!.weekIndex=i+1
      const out=evaluate(x,stallExtensions)
      expect(out.warnings).toEqual([]);expect(out.weeks[0]!.slots[0]!.sets.map(s=>s.load)).toEqual(expected[i])
      if(i<2)x.logs.push({id:`w${i}`,d:i===0?'2026-01-05':'2026-01-12',start:i,entries:[{id:'0025',occurrenceId:`o${i+1}`,target:{slotId:'bench',sets:3,reps:5},sets:[{w:130,r:5,done:true},{w:150,r:5,done:true},{w:170,r:4,done:true}]}]})
    }
    expect(evaluate(x,stallExtensions).tm.bench!.at(-1)!.value).toBe(180)
  })
})
