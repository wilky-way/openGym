import { it, expect } from 'vitest'
import fc from 'fast-check'
import { programmeModelSchema, programmeSchemaIssues } from '../src/programme-model-schema'
import { programmeConformance } from '../src/programme-conformance'
import { improveProgrammeDefinition } from '../src/programme-quality'
import { validateProgrammeDefinition } from '../src/programme-validate'
// @ts-expect-error Frozen JS oracle has no declarations; imports are differential-test-only.
import { programmeModelSchema as oldSchema, programmeSchemaIssues as oldSchemaIssues } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-model-schema.js'
// @ts-expect-error Frozen JS oracle has no declarations; imports are differential-test-only.
import { programmeConformance as oldConformance } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-conformance.js'
// @ts-expect-error Frozen JS oracle has no declarations; imports are differential-test-only.
import { improveProgrammeDefinition as oldImprove } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-quality.js'
// @ts-expect-error Frozen JS oracle has no declarations; imports are differential-test-only.
import { validateProgrammeDefinition as oldValidate, importProgramme } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-import.js'
import { syntheticProgramme, syntheticSlot, syntheticSource, conformanceCases } from './fixtures/synthetic-programme'

// Legacy oracle imports are confined to this differential file; dynamic fixture mutations are test-only.
const options = {seed:130013,numRuns:Number(process.env.PARITY_RUNS ?? 1000)}
const outcome = (fn: () => unknown) => {
  try {return {value:fn()}} catch(error) {return {error:(error as Error).message,name:(error as Error).name}}
}
function equal(fn: () => unknown, old: () => unknown) {
  const next=outcome(fn), previous=outcome(old)
  expect(next).toEqual(previous)
  expect(JSON.stringify(next)).toBe(JSON.stringify(previous))
}
function check(d: unknown) {
  const before=JSON.stringify(d)
  equal(()=>programmeSchemaIssues(d),()=>oldSchemaIssues(d))
  equal(()=>validateProgrammeDefinition(d),()=>oldValidate(d))
  equal(()=>programmeConformance(d),()=>oldConformance(d))
  expect(JSON.stringify(d)).toBe(before)
}
it('preserves the complete schema including effort-scale fields byte for byte',()=>{
  // P1 authoring is additive; project the legacy schema surface only.
  const legacySurface=structuredClone(programmeModelSchema) as any
  delete legacySurface.$defs.slot.properties.nativePrescription; // W41 closed additive source goals.
  delete legacySurface.properties.maxBasis; // W29 explicit max basis is additive.
  delete legacySurface.properties.progressionRules;delete legacySurface.properties.tmSeeds
  delete legacySurface.$defs.progression.properties.rules;delete legacySurface.$defs.progression.properties.onStall
  for(const name of Object.keys(legacySurface.$defs))if(!Object.hasOwn(oldSchema.$defs,name))delete legacySurface.$defs[name]
  expect(legacySurface).toEqual(oldSchema)
  expect(JSON.stringify(legacySurface)).toBe(JSON.stringify(oldSchema))
})
it('matches all four conformance levels and every synthetic issue code, with ordered locations and fixes',()=>{
  const levels=new Set<string>()
  const ready=syntheticProgramme();check(ready);levels.add(programmeConformance(ready).level)
  for(const [code,change] of conformanceCases) {
    const d=syntheticProgramme();change(d,syntheticSlot(d));check(d)
    const c=programmeConformance(d);levels.add(c.level)
    expect(c.issues.some(i=>i.code===code),code).toBe(true)
  }
  expect([...levels].sort()).toEqual(['Complete','Invalid','Ready','Valid'])
})
const mutations: ((d: any,e: any) => void)[] = [
  ...conformanceCases.map(([,f])=>f),
  (d,e)=>{e.target={rir:0}}, (d,e)=>{d.weeks[0].rir=2;delete e.target},
  (d,e)=>{e.pyramid=[5,'max'];e.tm={key:'0025',percentages:[65,80]};delete e.target},
  (d,e)=>{delete e.reps;e.mode='time';e.sec=60;e.role='gpp'},
  (d,e)=>{e.repsMin=6}, (d,e)=>{e.setRepsMin=[6,2]},
  (d,e)=>{e.weight=-1},(d,e)=>{e.weight='100'},(d,e)=>{e.sets='2'},
  (d,e)=>{e.generatedRules=[{rpe:[8,7]}]},(d,e)=>{e.generatedRules=[{rir:[0,0]}]},
  (d,e)=>{e.generatedRules=[{unknown:true}]},(d,e)=>{e.importNeedsPrescription=true},
  d=>{d.weeks.push(structuredClone(d.weeks[0]))},
  d=>{d.weeks[0].days.push(structuredClone(d.weeks[0].days[0]))},
  d=>{d.rulesSupported=false;d.needsReview=[' ','']},
  d=>{d.libraryRules={instructions:{pdf:'synthetic.pdf'}}},
  d=>{d.weeks[0].days[0].sessions[0].routineSnapshot.note='unprescribed source slots'},
  (d,e)=>{e.parsed=false},(d,e)=>{e.setTargets=[null,{rpe:9}]},
  d=>{d.weeks[0].mode='deload';delete d.endPlan},
]
const definition=fc.tuple(fc.array(fc.integer({min:0,max:mutations.length-1}),{maxLength:5}),fc.jsonValue({maxDepth:3})).map(([changes,extension])=>{
  const d=syntheticProgramme();d.extension=extension
  for(const index of changes)mutations[index]!(d,syntheticSlot(d) ?? {})
  return d
})
it('matches schema, validator and conformance on seeded synthetic definitions with extensions',()=>{
  fc.assert(fc.property(definition,d=>check(d)),options)
})
it('matches invalid JSON shapes and exception precedence without rebuilding inputs',()=>{
  fc.assert(fc.property(fc.jsonValue({maxDepth:4}),value=>check(value)),options)
})
it('preserves validation identity, unknown fields and numeric strings',()=>{
  const d=syntheticProgramme();syntheticSlot(d).reps='5';syntheticSlot(d).weight='100';d.extension={z:1,a:[true,null]}
  expect(validateProgrammeDefinition(d)).toBe(d);check(d)
})
it('matches repair results and changed paths, with explicit decisions, on seeded synthetic definitions',()=>{
  fc.assert(fc.property(definition,fc.boolean(),(d,supply)=>{
    const decisions=supply?{source:{private:false},goal:'Authored synthetic goal',slots:{'/weeks/0/days/0/sessions/0/slots/0':{target:{rir:1}}}}:{}
    const before=JSON.stringify(d)
    equal(()=>improveProgrammeDefinition(d,{decisions}),()=>oldImprove(d,{decisions}))
    expect(JSON.stringify(d)).toBe(before)
  }),options)
})
it('matches source repairs for effort ranges, duplicate identity, edited reps and mixed percentage chunks',()=>{
  const rowCases=[
    [{count:2,reps:5,rpe:8}], [{count:2,reps:5,rpe:[7,8]}],
    [{count:1,reps:3,pct:75,rpe:7},{count:2,reps:8,rpe:8}],
    [{count:12,reps:5,rpe:8}], [{count:2,reps:5,rir:0}],
  ]
  for(const rows of rowCases)for(const identity of ['original','duplicate','stale','edited','positional']) {
    const raw=syntheticSource(rows), d=importProgramme(raw).definition
    for(const e of d.weeks[0].days[0].sessions[0].routineSnapshot.ex) {delete e.role;delete e.setTargets;delete e.progression}
    if(identity==='duplicate')raw.weeks[0].days[0].exercises.push(structuredClone(raw.weeks[0].days[0].exercises[0]))
    if(identity==='stale')syntheticSlot(d).slotId='stale'
    if(identity==='edited')syntheticSlot(d).pyramid=[6,6]
    if(identity==='positional') {
      delete raw.weeks[0].days[0].exercises[0].slot
      const p=importProgramme(raw).definition;Object.assign(d,p);delete syntheticSlot(d).role;delete syntheticSlot(d).setTargets
    }
    const before=JSON.stringify(d), rawBefore=JSON.stringify(raw)
    check(d)
    equal(()=>improveProgrammeDefinition(d,{sourceRaw:raw}),()=>oldImprove(d,{sourceRaw:raw}))
    expect(JSON.stringify(d)).toBe(before);expect(JSON.stringify(raw)).toBe(rawBefore)
  }
})
it('matches custom catalogue resolution and equipment derivation',()=>{
  const d=syntheticProgramme();syntheticSlot(d).id='synthetic-custom';delete d.equipment
  const catalogue=[{id:'synthetic-custom',eq:'synthetic-machine'}]
  equal(()=>programmeConformance(d,{catalogue}),()=>oldConformance(d,{catalogue}))
  equal(()=>improveProgrammeDefinition(d,{catalogue}),()=>oldImprove(d,{catalogue}))
})

it('preserves structural rejection order and all native validation bounds',()=>{
  const invalid: [string,(d: any,e: any)=>void][] = [
    ['definition',d=>{d.unit='stone'}], ['day',d=>{d.days={}}],
    ['week indexes',d=>{d.weeks[0].index=0}], ['day',d=>{d.weeks[0].days[0].key=''}],
    ['session',d=>{d.weeks[0].days[0].sessions[0].routineSnapshot.ex={}}],
    ['prescription',(d,e)=>{e.sets=101}], ['prescription',(d,e)=>{e.pyramid=[]}],
    ['prescription',(d,e)=>{e.pyramid=[1.5]}], ['prescription',(d,e)=>{e.reps='1.5'}],
    ['prescription',(d,e)=>{e.mode='time';e.sec=0}],
    ['set targets',(d,e)=>{e.setTargets=[{rpe:8}]}],
    ['target',(d,e)=>{e.target={rpe:11}}],
    ['rep range',(d,e)=>{e.repsMin=6}], ['rep range',(d,e)=>{e.setRepsMin=[1]}],
    ['rep range',(d,e)=>{e.setRepsMin=[1,6]}],
    ['prescription',(d,e)=>{e.weight=Infinity}],['prescription',(d,e)=>{e.weight='heavy'}],
    ['prescription',(d,e)=>{e.pyramid=[5,5];e.pyramidWeight=[100]}],
    ['prescription',(d,e)=>{e.pyramid=[5,5];e.pyramidWeight=[100,-1]}],
    ['percentage',(d,e)=>{e.pyramid=[5,5];e.tm={percentages:[65]}}],
    ['percentage',(d,e)=>{e.pyramid=[5,5];e.tm={percentages:[65,-1]}}],
    ['metadata',d=>{d.name='x'.repeat(10001)}],
    ['metadata',d=>{d.source={ref:42}}],['metadata',d=>{d.needsReview=[42]}],
    ['metadata',d=>{d.libraryRules={instructions:{nested:['x'.repeat(10001)]}}}],
    ['metadata',d=>{let value:any={};for(let i=0;i<22;i++)value={nested:value};d.extension=value}],
    ['generated rules',(d,e)=>{e.generatedRules=[{rpe:[8,7]}]}],
    ['generated rules',(d,e)=>{e.generatedRules=[{rpe:[0,8]}]}],
    ['generated rules',(d,e)=>{e.generatedRules=[{count:[0]}]}],
    ['generated rules',(d,e)=>{e.generatedRules=[{until_rpe:11}]}],
    ['generated rules',(d,e)=>{e.generatedRules=[{unexpected:true}]}],
    ['64 explicit weeks',d=>{d.weeks=Array.from({length:65},()=>structuredClone(d.weeks[0]))}],
    ['day',d=>{d.weeks[0].days=Array.from({length:15},()=>structuredClone(d.weeks[0].days[0]))}],
    ['session',d=>{d.weeks[0].days[0].sessions=Array.from({length:9},()=>structuredClone(d.weeks[0].days[0].sessions[0]))}],
    ['session',d=>{d.weeks[0].days[0].sessions[0].routineSnapshot.ex=Array.from({length:101},()=>structuredClone(syntheticSlot(d)))}],
    ['size limit',d=>{
      const e=syntheticSlot(d);e.sets=100
      d.weeks[0].days[0].sessions[0].routineSnapshot.ex=Array.from({length:100},()=>structuredClone(e))
      d.weeks.push({...structuredClone(d.weeks[0]),index:2})
    }],
  ]
  for(const [message,change] of invalid) {
    const d=syntheticProgramme();change(d,syntheticSlot(d));check(d)
    expect(()=>validateProgrammeDefinition(d),message).toThrow(message)
  }
})
it('preserves inherited R2-C5 archival clock bounds bypass and retained authored notes',()=>{
  const d=syntheticProgramme();d._ts='x'.repeat(10001);d.notes=['Authored synthetic note'];d._f={nested:'x'.repeat(10001)};d._u='x'.repeat(10001)
  expect(validateProgrammeDefinition(d)).toBe(d);check(d)
})
it('covers the synthetic public percentage library specimen and its authored variants',()=>{
  const raw:any={schema:'opengym-library/1',id:'public-sample',name:'Public percentage sample',unit:'lb',length_weeks:1,source:{name:'Public'},rules:{},weeks:[{n:'1',days:[{n:1,name:'Upper',exercises:[{id:'0025',slot:'1',name:'Bench Press',parsed:true,sets:[{count:1,reps:5,pct:65},{count:1,reps:3,pct:75},{count:1,reps:1,pct:85,amrap:true}]}]}]}]}
  for(const kind of ['original','deload','multi-session','absolute-range']) {
    const r=structuredClone(raw)
    if(kind==='deload')r.weeks[0].block_type='deload'
    if(kind==='multi-session') {
      r.weeks[0].days[0].kind='lift'
      r.weeks[0].days.push({...structuredClone(r.weeks[0].days[0]),kind:'gpp',name:'Timed GPP',exercises:[{id:'0025',name:'Bench',sets:[],minutes:5}]})
    }
    if(kind==='absolute-range')r.weeks[0].days[0].exercises[0].sets=[{count:[1,2],reps:[5,8],pct:[65,70]},{count:2,reps:'max',weight:100}]
    const d=importProgramme(r).definition;check(d)
    equal(()=>improveProgrammeDefinition(d,{sourceRaw:r}),()=>oldImprove(d,{sourceRaw:r}))
  }
})

// R2-C4 is frozen in the oracle; stricter NEW progression-rule authoring belongs to P1.
it.each([
  ['constant set expression','custom(): if (completedReps[1+98] >= 5) { weights += 1lb }'],
  ['four-part stage selector','custom(): weights[1:1:99:1] += 1lb'],
  ['unknown stage assignment','custom(): setVariationIndex = 99'],
])('preserves inherited R2-C4 Ready conformance for %s',(name,summary)=>{
  const raw=syntheticSource(),metadata=syntheticProgramme()
  for(const field of ['goal','level','equipment','licence','daysPerWeek','lengthWeeks','source','endPlan'])raw[field]=metadata[field]
  raw.weeks[0].days[0].exercises[0].rules=[{kind:'progress',summary}]
  const d=importProgramme(raw).definition;check(d)
  expect(programmeConformance(d)).toEqual({level:'Ready',issues:[]})
  equal(()=>improveProgrammeDefinition(d,{sourceRaw:raw}),()=>oldImprove(d,{sourceRaw:raw}))
})

it('directly recovers source-N by its retained source position and exact exercise note',()=>{
  const d=syntheticProgramme(),e=syntheticSlot(d)
  d.weeks[0].sourceWeek='1'
  d.weeks[0].days[0].sessions[0].sessionTemplateId='d1:lift'
  e.slotId='day:1:slot:source-2:part:1'
  e.note='Source exercise: Synthetic second lift\nRetained source prescription'
  delete e.role;delete e.target;delete e.progression
  const raw=syntheticSource([{count:2,reps:5,rpe:4}])
  const first=raw.weeks[0].days[0].exercises[0];delete first.slot;first.name='Synthetic first lift'
  const second=structuredClone(first);second.name='Synthetic second lift';second.sets[0].rpe=8
  raw.weeks[0].days[0].exercises.push(second)
  const before=JSON.stringify(d),rawBefore=JSON.stringify(raw)
  const fixed=improveProgrammeDefinition(d,{sourceRaw:raw})
  equal(()=>fixed,()=>oldImprove(d,{sourceRaw:raw}))
  expect(syntheticSlot(fixed.definition)).toMatchObject({role:'main',setTargets:[{rpe:8},{rpe:8}]})
  expect(fixed.changes).toContain('/weeks/1/days/d1/sessions/1/slots/day:1:slot:source-2:part:1/setTargets/0')
  expect(JSON.stringify(d)).toBe(before);expect(JSON.stringify(raw)).toBe(rawBefore)
  e.note='Source exercise: Synthetic first lift\nWrong retained identity'
  equal(()=>improveProgrammeDefinition(d,{sourceRaw:raw}),()=>oldImprove(d,{sourceRaw:raw}))
  expect(syntheticSlot(improveProgrammeDefinition(d,{sourceRaw:raw}).definition).setTargets).toBeUndefined()
})
it('oracle exception: duplicate explicit source-1 candidates never recover effort through positional fallback',()=>{
  const d=syntheticProgramme(),e=syntheticSlot(d)
  d.weeks[0].sourceWeek='1'
  d.weeks[0].days[0].sessions[0].sessionTemplateId='d1:lift'
  e.slotId='day:1:slot:source-1:part:1'
  e.note='Source exercise: Synthetic duplicate lift\nRetained source prescription'
  delete e.role;delete e.target;delete e.progression
  const raw=syntheticSource([{count:2,reps:5,rpe:8}])
  const first=raw.weeks[0].days[0].exercises[0];first.slot='source-1';first.name='Synthetic duplicate lift'
  const second=structuredClone(first);second.sets[0].rpe=4
  raw.weeks[0].days[0].exercises.push(second)
  const fixed=improveProgrammeDefinition(d,{sourceRaw:raw})
  expect(syntheticSlot(oldImprove(d,{sourceRaw:raw}).definition).setTargets).toEqual([{rpe:8},{rpe:8}])
  expect(syntheticSlot(fixed.definition).setTargets).toBeUndefined()
  expect(fixed.changes.some(path=>path.includes('/setTargets/'))).toBe(false)
  expect(programmeConformance(fixed.definition).issues.find(issue=>issue.code==='slot.effort')).toMatchObject({sets:[1,2]})
  delete e.note
  equal(()=>improveProgrammeDefinition(d,{sourceRaw:raw}),()=>oldImprove(d,{sourceRaw:raw}))
  expect(syntheticSlot(improveProgrammeDefinition(d,{sourceRaw:raw}).definition).setTargets).toBeUndefined()
})
