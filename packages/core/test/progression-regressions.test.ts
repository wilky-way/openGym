import {it,expect,vi} from 'vitest'
import {createExerciseIndex} from '../src/exercises'
import {validateProgression} from '../src/progression-validate'
import * as progression from '../src/progression-validate'
import {programmeConformance} from '../src/programme-conformance'
import * as validator from '../src/programme-validate'
import {programmeSchemaIssues} from '../src/programme-model-schema'
import {progressionProgramme,syntheticRules} from './fixtures/synthetic-progression'
import {syntheticSlot} from './fixtures/synthetic-programme'
const codes=(d: unknown)=>validateProgression(d).issues.map(i=>i.code)
const malformed: [string,(d: any)=>void][]=[
 ['uncoercible kind',d=>{d.progressionRules[0].kind={toString:null}}],
 ['BigInt rule ref',d=>{syntheticSlot(d).progression.rules=[1n]}],
 ['cyclic rule ref',d=>{const refs: unknown[]=[];refs.push(refs);syntheticSlot(d).progression.rules=refs}],
 ['deleted AMRAP band',d=>{d.progressionRules=[syntheticRules()[4]];delete d.progressionRules[0].bands[0];syntheticSlot(d).progression.rules=[]}],
 ['cyclic AMRAP source',d=>{d.progressionRules=[syntheticRules()[4]];const ref=d.progressionRules[0].source.slot;ref.day=ref;syntheticSlot(d).progression.rules=[]}],
 ['uncoercible muscle snapshot',d=>{d.progressionRules=[{...syntheticRules()[7],scope:{muscles:['chest']}}];syntheticSlot(d).progression.rules=['ramp'];syntheticSlot(d).id='unresolved-snapshot';syntheticSlot(d).muscleWeights={chest:{toString:null}}}],
]
it.each(malformed)('returns issues instead of throwing for %s',(_name,change)=>{
 const d=progressionProgramme();change(d)
 const result=validateProgression(d);expect(result.ok).toBe(false);expect(result.issues.length).toBeGreaterThan(0)
 expect(validateProgression(d)).toEqual(result)
 expect(programmeConformance(d).level).not.toBe('Ready')
})
it('catches validator failures and returns conformance issues',()=>{
 const spy=vi.spyOn(validator,'validateProgrammeDefinition').mockImplementation(()=>{throw new Error('Synthetic validation failure')})
 try {expect(programmeConformance(progressionProgramme())).toMatchObject({level:'Invalid',issues:[expect.objectContaining({code:'structure.invalid'})]})}
 finally {spy.mockRestore()}
})
it('requires own fields on closed rules and nested rounding objects',()=>{
 for(const mutate of [(d: any)=>{d.progressionRules[0].rounding=Object.create({increment:Infinity,mode:'nearest',usePlates:false})},(d: any)=>{d.progressionRules[0]=Object.create(d.progressionRules[0])}]) {
  const d=progressionProgramme();mutate(d)
  expect(codes(d)).toContain('rule.range');expect(programmeSchemaIssues(d).length).toBeGreaterThan(0)
  expect(programmeConformance(d).level).not.toBe('Ready')
 }
})
it.each(['percentage','rpe-load'])('rejects sparse %s prescriptions, including inherited array rows',kind=>{
 for(const inherit of [false,true]) {
  const d=progressionProgramme(),rule=syntheticRules().find(r=>r.kind===kind)!
  d.progressionRules=[rule];syntheticSlot(d).progression.rules=[rule.id]
  const rows=Array(2)
  if(inherit)Object.setPrototypeOf(rows,Object.assign(Object.create(Array.prototype),{0:{pct:0.6,reps:5},1:{pct:0.8,reps:5}}))
  d.progressionRules[0].weeks={'1':rows}
  expect(codes(d)).toContain('rule.range');expect(programmeConformance(d).level).not.toBe('Ready')
 }
})
it('rejects sparse authored per-set prescriptions',()=>{
 const d=progressionProgramme();syntheticSlot(d).setRepsMin=Array(2)
 expect(programmeSchemaIssues(d).length).toBeGreaterThan(0);expect(programmeConformance(d).level).toBe('Invalid')
})
it('matches muscle scopes to the authored week rather than a repeated slot identity',()=>{
 const d=progressionProgramme();d.weeks.push({...structuredClone(d.weeks[0]),index:2});d.lengthWeeks=2
 const custom=[{id:'custom-chest',n:'Synthetic chest',muscleWeights:{chest:1}},{id:'custom-back',n:'Synthetic back',muscleWeights:{lats:1}}]
 const first=syntheticSlot(d),second=d.weeks[1].days[0].sessions[0].routineSnapshot.ex[0]
 first.id=custom[0]!.id;second.id=custom[1]!.id
 d.progressionRules=[{...syntheticRules()[6],weeks:[2]},{...syntheticRules()[7],scope:{muscles:['chest']},weeks:[1,2]}]
 first.progression.rules=second.progression.rules=['deload','ramp']
 expect(validateProgression(d,createExerciseIndex(custom))).toEqual({ok:true,issues:[]})
 expect(programmeConformance(d,{catalogue:custom}).level).toBe('Ready')
 second.id=custom[0]!.id
 expect(validateProgression(d,createExerciseIndex(custom)).issues.map(i=>i.code)).toContain('rule.deload-overlap')
})
it('rejects multiple ramps on a shared muscle even across disjoint weeks',()=>{
 const d=progressionProgramme();d.weeks.push({...structuredClone(d.weeks[0]),index:2})
 d.progressionRules=[{...syntheticRules()[7],scope:{muscles:['chest']}},{...syntheticRules()[7],id:'ramp-two',scope:{muscles:['chest','lats']},weeks:[2]}]
 expect(codes(d)).toContain('rule.two-volume-ramps')
 d.progressionRules[1].scope={muscles:['lats']};expect(codes(d)).not.toContain('rule.two-volume-ramps')
})
it('recognizes authored and effective rule-driven AMRAP sets and rejects a fixed override',()=>{
 const d=progressionProgramme();d.progressionRules.push(syntheticRules()[4]);expect(validateProgression(d).ok).toBe(true)
 d.progressionRules[0].weeks[1][1].reps=5;expect(codes(d)).toContain('rule.amrap-source-not-amrap')
 syntheticSlot(d).pyramid=[5,'max'];expect(codes(d)).toContain('rule.amrap-source-not-amrap')
 syntheticSlot(d).progression.rules=[];expect(validateProgression(d).ok).toBe(true)
 delete syntheticSlot(d).pyramid;syntheticSlot(d).reps='max';expect(validateProgression(d).ok).toBe(true)
})
it('requires an attached slot TM key for TM stalls even when tmSeeds declares a lift',()=>{
 const d=progressionProgramme();d.progressionRules=[syntheticRules()[3],{...syntheticRules()[5],appliesTo:'tm'}]
 syntheticSlot(d).progression.rules=['linear'];syntheticSlot(d).progression.onStall='stall'
 expect(codes(d)).toContain('rule.tm-stall-without-key')
 syntheticSlot(d).pyramid=[5,5];syntheticSlot(d).tm={key:'bench',percentages:[65,80]}
 expect(validateProgression(d)).toEqual({ok:true,issues:[]});expect(programmeConformance(d).level).toBe('Ready')
})
it('forwards the explicit index through conformance single-slot localization',()=>{
 const d=progressionProgramme();d.progressionRules=[];syntheticSlot(d).progression.rules=[]
 syntheticSlot(d).id='1019';d.weeks.push(structuredClone(d.weeks[0]))
 const custom=[{id:'1019',n:'Synthetic custom lift',custom:true}],index={'1019':custom[0]!}
 const result=programmeConformance(d,{catalogue:custom},index)
 expect(result.level).toBe('Invalid')
 expect(result.issues.filter(i=>i.code==='structure.invalid').map(i=>i.fix).join(' ')).not.toContain('Resolve unknown exercises')
})
it('uses an explicit caller index rather than rebuilding a custom catalogue index for progression',()=>{
 const d=progressionProgramme();syntheticSlot(d).id='custom-scope'
 d.progressionRules=[syntheticRules()[6],{...syntheticRules()[7],scope:{muscles:['chest']}}]
 syntheticSlot(d).progression.rules=['deload','ramp']
 const catalogue=[{id:'custom-scope',n:'Synthetic back lift',custom:true,muscleWeights:{lats:1}}]
 const index=createExerciseIndex([{...catalogue[0]!,muscleWeights:{chest:1}}])
 expect(programmeConformance(d,{catalogue}).level).toBe('Ready')
 expect(programmeConformance(d,{catalogue},index).issues.map(i=>i.code)).toContain('rule.deload-overlap')
})
it('catches a failure from progression validation as a conformance issue',()=>{
 const spy=vi.spyOn(progression,'validateProgression').mockImplementation(()=>{throw new Error('Synthetic progression failure')})
 try {expect(programmeConformance(progressionProgramme())).toMatchObject({level:'Invalid',issues:[expect.objectContaining({code:'structure.invalid'})]})}
 finally {spy.mockRestore()}
})

it('rejects unsupported reps only on engine-driven slots, with numeric strings and double ranges supported',()=>{
 const d=progressionProgramme();d.progressionRules=[syntheticRules()[3]];syntheticSlot(d).progression.rules=['linear']
 for(const reps of ['unsupported','5-8',null,{},true]) {
  syntheticSlot(d).reps=reps;expect(codes(d)).toContain('rule.reps-unsupported')
 }
 for(const reps of [5,'5','max','amrap']) {
  syntheticSlot(d).reps=reps;expect(codes(d)).not.toContain('rule.reps-unsupported')
 }
 syntheticSlot(d).pyramid=[5,'unsupported'];expect(codes(d)).toContain('rule.reps-unsupported')
 syntheticSlot(d).pyramid=['5','max'];expect(codes(d)).not.toContain('rule.reps-unsupported')
 delete syntheticSlot(d).pyramid;syntheticSlot(d).reps='5-8';d.progressionRules=[syntheticRules()[2]];syntheticSlot(d).progression.rules=['double']
 expect(validateProgression(d)).toEqual({ok:true,issues:[]})
 expect(programmeConformance(d).level).toBe('Ready')
 for(const reps of ['0-8','8-5','5-101']) {syntheticSlot(d).reps=reps;expect(codes(d)).toContain('rule.reps-unsupported')}
 syntheticSlot(d).reps='unsupported';syntheticSlot(d).progression.rules=[];expect(codes(d)).not.toContain('rule.reps-unsupported')
})
it('permits engine-consumed AMRAP notation and double ranges while preserving instruction-only rejection',()=>{
 for(const reps of ['amrap','5-8']) {
  const d=progressionProgramme();syntheticSlot(d).reps=reps
  d.progressionRules=[syntheticRules()[reps==='amrap'?3:2]];syntheticSlot(d).progression.rules=[d.progressionRules[0].id]
  expect(()=>validator.validateProgrammeDefinition(d)).not.toThrow();expect(programmeConformance(d).level).toBe('Ready')
  syntheticSlot(d).progression.rules=[]
  expect(()=>validator.validateProgrammeDefinition(d)).toThrow('Invalid program prescription');expect(programmeConformance(d).level).toBe('Invalid')
 }
 const d=progressionProgramme();syntheticSlot(d).reps='amrap';d.progressionRules=[syntheticRules()[1]];syntheticSlot(d).progression.rules=['rpe']
 expect(()=>validator.validateProgrammeDefinition(d)).toThrow('Invalid program prescription')
})
it('accepts numeric strings in engine-driven pyramid rows without mutating or relaxing legacy slots',()=>{
 const d=progressionProgramme();syntheticSlot(d).pyramid=['5','max']
 d.progressionRules=[syntheticRules()[3]];syntheticSlot(d).progression.rules=['linear']
 const before=JSON.stringify(d)
 expect(validateProgression(d)).toEqual({ok:true,issues:[]});expect(programmeConformance(d).level).toBe('Ready')
 expect(JSON.stringify(d)).toBe(before)
 syntheticSlot(d).progression.rules=[];expect(programmeConformance(d).level).toBe('Invalid')
})
it('bounds engine AMRAP rep floors without tightening legacy authored floors',()=>{
 const d=progressionProgramme();d.progressionRules=[syntheticRules()[3]];syntheticSlot(d).progression.rules=['linear'];syntheticSlot(d).reps='max'
 syntheticSlot(d).repsMin=101;expect(codes(d)).toContain('rule.range');expect(programmeConformance(d).level).not.toBe('Ready')
 syntheticSlot(d).progression.rules=[];expect(programmeConformance(d).level).toBe('Ready')
 delete syntheticSlot(d).repsMin;syntheticSlot(d).pyramid=[5,'max'];syntheticSlot(d).progression.rules=['linear']
 syntheticSlot(d).setRepsMin=[null,101];expect(codes(d)).toContain('rule.range');expect(programmeConformance(d).level).not.toBe('Ready')
 syntheticSlot(d).setRepsMin=[null,'5'];expect(programmeConformance(d).level).toBe('Ready')
})
it('preserves engine context while localizing unrelated global failures',()=>{
 for(const reps of ['amrap','5-8']) {
  const d=progressionProgramme();syntheticSlot(d).reps=reps;d.progressionRules=[syntheticRules()[reps==='amrap'?3:2]];syntheticSlot(d).progression.rules=[d.progressionRules[0].id]
  d.days={}
  const result=programmeConformance(d);expect(result.level).toBe('Invalid')
  expect(result.issues).toEqual([expect.objectContaining({code:'structure.invalid',location:{path:''},fix:expect.stringContaining('Invalid program day')})])
 }
})
