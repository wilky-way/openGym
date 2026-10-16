import { describe, expect, it } from 'vitest'
import { evaluate, preview, type EngineInput } from '../src/progression-engine'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'
import { createExerciseIndex } from '../src/exercises'

function fixture() {
  const d=syntheticProgramme(), a=syntheticSlot(d)
  a.weight=100; a.pyramid=[5,5]; a.progression.rules=['lp'];a.progression.parameters={continuityKey:'a-bench'}
  d.progressionRules=[{id:'lp',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}},
    {id:'reset',kind:'stall',after:2,action:{kind:'reset',pct:0.9},appliesTo:'load'}]
  a.progression.onStall='reset'
  const day=structuredClone(d.weeks[0].days[0]);day.key='d3'
  d.weeks[0].days.push(day)
  const cycle:any={id:'c1',programmeId:d.id,seriesId:'series',status:'active',weekIndex:1,week1StartDate:'2026-01-05',snapshot:d,
    occurrences:['d1','d3'].map((dayKey,i)=>({instanceId:`c1-${dayKey}`,weekIndex:1,dayKey,sessionTemplateId:'main',ordinal:i+1,routineId:`r${i}`,status:'done'}))}
  const x:EngineInput={definition:d,cycle,historyCycles:[cycle],logs:[],weeks:[1],asOf:'2026-01-09',profile:{unit:'lb',effortScale:'rir'}}
  return {d,a,x,cycle}
}
function log(id:string,day:string,date:string,weight:number,reps=[5,5],extra={}) {
  return {id:`${id}-${day}-${date}`,d:date,start:1,unit:'lb',entries:[{id:'0025',occurrenceId:`${id}-${day}`,target:{slotId:'bench',sets:2,reps:5},sets:reps.map(r=>({w:weight,r,done:true}))}],...extra}
}
const load=(x:EngineInput,index?:ReturnType<typeof createExerciseIndex>)=>{
  const out=evaluate(x,{},index);expect(out.error).toBeUndefined();return out.weeks[0]!.slots[0]!.sets[0]!.load
}
describe('opt-in community load continuity',()=>{
  it('replays repeated A in the same week; preview uses completed current-week logs',()=>{
    const {x}=fixture();x.logs=[log('c1','d1','2026-01-05',100),log('c1','d3','2026-01-09',105)]
    expect(load(x)).toBe(110)
    expect(preview(x).weeks[0]!.slots[1]!.sets[0]!.load).toBe(110)
  })
  it('retains isolation without opt-in and rejects exercise swaps and incompatible rules',()=>{
    const {d,a,x}=fixture();x.logs=[log('c1','d3','2026-01-09',105)]
    delete a.progression.parameters;expect(load(x)).toBe(100)
    a.progression.parameters={continuityKey:'a-bench'}
    d.weeks[0].days[1].sessions[0].routineSnapshot.ex[0].id='0032';expect(load(x)).toBe(100)
  })
  it('uses only explicit repeat ancestry; restarts and repeated cycles retain earned load',()=>{
    const {d,x,cycle}=fixture();cycle.status='archived';cycle.repeatedAs='c2'
    const next={...structuredClone(cycle),id:'c2',status:'active',week1StartDate:'2026-01-12',occurrences:cycle.occurrences.map((o:any)=>({...o,instanceId:o.instanceId.replace('c1','c2')}))};delete next.repeatedAs
    x.cycle=next;x.historyCycles=[cycle,next,{...cycle,id:'unrelated',repeatedAs:undefined}];x.asOf='2026-01-12'
    x.logs=[log('c1','d1','2026-01-05',100),log('c1','d3','2026-01-09',105)]
    const before=structuredClone(x);expect(load(x)).toBe(110);expect(x).toEqual(before)
    delete cycle.repeatedAs;expect(load(x)).toBe(100)
    cycle.restartedAs='c2';expect(load(x)).toBe(110)
    cycle.seriesId='other';expect(load(x)).toBe(100)
    cycle.seriesId='series';cycle.snapshot={...d,id:'other'};expect(load(x)).toBe(100)
  })
  it('missed targets reset after two failures; skipped and absent sessions are neutral',()=>{
    const {x,cycle}=fixture();x.logs=[log('c1','d1','2026-01-05',100,[4,5]),log('c1','d3','2026-01-08',100,[5,4])]
    expect(load(x)).toBe(90)
    cycle.occurrences[1].status='skipped';expect(load(x)).toBe(100)
    cycle.occurrences[1].status='pending';x.logs.pop();expect(load(x)).toBe(100)
  })
  it('double endpoints retain working load then reset reps at the high endpoint',()=>{
    const {d,a,x}=fixture();d.progressionRules[0]={id:'lp',kind:'double',increment:5,unit:'lb',repsLow:5,repsHigh:8,condition:'all-sets',afterIncrease:'reset-to-low',rounding:{increment:5,mode:'nearest',usePlates:false}}
    a.progression.parameters.repProgression='step'
    d.weeks[0].days[1].sessions[0].routineSnapshot.ex[0].progression.parameters.repProgression='step'
    x.logs=[log('c1','d1','2026-01-05',100,[5,5])]
    expect(evaluate(x).weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([6,6])
    x.logs=[log('c1','d1','2026-01-05',100,[8,7])];expect(load(x)).toBe(100)
    x.logs=[log('c1','d1','2026-01-05',100,[8,8])];expect(load(x)).toBe(105)
    expect(evaluate(x).weeks[0]!.slots[0]!.sets.map(s=>s.reps)).toEqual([5,5])
  })
  it('preserves custom assisted direction across repeated source slots',()=>{
    const {d,x}=fixture();for(const day of d.weeks[0].days) day.sessions[0].routineSnapshot.ex[0].id='assist'
    x.logs=[log('c1','d3','2026-01-08',100)];(x.logs[0] as any).entries[0].id='assist'
    const index=createExerciseIndex([{id:'assist',n:'Synthetic assisted pull-up',eq:'machine',assisted:true}])
    expect(load(x,index)).toBe(95)
  })
})
