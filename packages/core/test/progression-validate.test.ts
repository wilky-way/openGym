import {createExerciseIndex} from '../src/exercises'
import {it,expect} from 'vitest'
import fc from 'fast-check'
import type {ProgressionIssueCode} from '../../contract/domain/progression'
import {validateProgression} from '../src/progression-validate'
import {programmeConformance} from '../src/programme-conformance'
import {validateProgrammeDefinition} from '../src/programme-validate'
import {syntheticProgramme,syntheticSlot} from './fixtures/synthetic-programme'
import {progressionProgramme,syntheticRules,sourceRef} from './fixtures/synthetic-progression'
const codes=(d: unknown)=>validateProgression(d).issues.map(i=>i.code)
const failing: [ProgressionIssueCode,(d: any)=>void][]=[
 ['rule.unknown-kind',d=>{d.progressionRules[0].kind='script'}],
 ['rule.duplicate-id',d=>{d.progressionRules.push(structuredClone(d.progressionRules[0]))}],
 ['rule.unknown-ref',d=>{syntheticSlot(d).progression.rules=['missing']}],
 ['rule.unknown-lift',d=>{d.progressionRules[0].ref.lift='missing'}],
 ['rule.unknown-week',d=>{d.progressionRules[0].weeks={'2':d.progressionRules[0].weeks['1']}}],
 ['rule.unknown-slot',d=>{d.progressionRules=[syntheticRules()[4]];d.progressionRules[0].source.slot={...sourceRef,slot:'missing'};syntheticSlot(d).progression.rules=[]}],
 ['rule.unknown-set',d=>{d.progressionRules=[syntheticRules()[4]];d.progressionRules[0].source.set=2;syntheticSlot(d).progression.rules=[]}],
 ['rule.two-load-rules',d=>{d.progressionRules.push(syntheticRules()[2]);syntheticSlot(d).progression.rules.push('double')}],
 ['rule.range',d=>{d.progressionRules[0].weeks[1][0].pct=1.51}],
 ['rule.extra-field',d=>{d.progressionRules[0].rounding.expression='weights*2'}],
 ['rule.unit-mismatch',d=>{d.progressionRules=[syntheticRules()[2]];d.progressionRules[0].unit='kg';syntheticSlot(d).progression.rules=['double']}],
 ['rule.ramp-order',d=>{d.weeks.push({...structuredClone(d.weeks[0]),index:2});d.lengthWeeks=2;d.progressionRules=[syntheticRules()[7]];d.progressionRules[0].weeks=[2,1];syntheticSlot(d).progression.rules=['ramp']}],
 ['rule.deload-overlap',d=>{d.progressionRules=[syntheticRules()[6],syntheticRules()[7]];syntheticSlot(d).progression.rules=['deload','ramp']}],
 ['rule.missing-rounding',d=>{delete d.progressionRules[0].rounding}],
 ['rule.two-volume-ramps',d=>{d.progressionRules=[syntheticRules()[7],{...syntheticRules()[7],id:'ramp-two'}];syntheticSlot(d).progression.rules=['ramp','ramp-two']}],
 ['rule.multiple-amrap-bumps',d=>{d.progressionRules.push(syntheticRules()[4],{...syntheticRules()[4],id:'amrap-two'})}],
 ['rule.amrap-source-not-amrap',d=>{d.progressionRules=[syntheticRules()[4]];syntheticSlot(d).progression.rules=[]}],
 ['rule.reps-unsupported',d=>{syntheticSlot(d).reps='unsupported'}],
 ['rule.tm-stall-without-key',d=>{d.progressionRules=[syntheticRules()[3],{...syntheticRules()[5],appliesTo:'tm'}];syntheticSlot(d).progression.rules=['linear'];syntheticSlot(d).progression.onStall='stall'}],
]
it.each(failing)('fails closed and blocks Complete for %s',(code,change)=>{
 const d=progressionProgramme();change(d);const before=JSON.stringify(d)
 const result=validateProgression(d);expect(result.ok).toBe(false);expect(codes(d)).toContain(code)
 const c=programmeConformance(d);expect(c.level).not.toBe('Complete');expect(c.level).not.toBe('Ready')
 expect(c.issues.find(i=>i.code===code)).toMatchObject({requiredFor:'Complete'})
 expect(JSON.stringify(d)).toBe(before)
})
it('accepts each of the eight rule kinds without mutating the definition',()=>{
 for(const rule of syntheticRules()) {
  const d=progressionProgramme();d.progressionRules=[rule];syntheticSlot(d).progression.rules=rule.kind==='stall'?[]:[rule.id]
  if(rule.kind==='amrap-tm')syntheticSlot(d).pyramid=[5,'max']
  const before=JSON.stringify(d);expect(validateProgression(d),rule.kind).toEqual({ok:true,issues:[]})
  expect(()=>validateProgrammeDefinition(d),rule.kind).not.toThrow();expect(programmeConformance(d).level,rule.kind).toBe('Ready');expect(JSON.stringify(d)).toBe(before)
 }
})
it('keeps all four existing conformance levels unchanged for definitions with no engine rules',()=>{
 const d=syntheticProgramme();expect(validateProgression(d)).toEqual({ok:true,issues:[]});expect(programmeConformance(d).level).toBe('Ready')
 delete d.goal;expect(programmeConformance(d).level).toBe('Complete')
 delete syntheticSlot(d).target;expect(programmeConformance(d).level).toBe('Valid')
 syntheticSlot(d).sets=0;expect(programmeConformance(d).level).toBe('Invalid')
})
it('accepts slot TM keys as lift declarations and closes both seed variants',()=>{
 const d=progressionProgramme();delete d.tmSeeds;syntheticSlot(d).pyramid=[5,'max'];syntheticSlot(d).tm={key:'bench',percentages:[65,80]}
 expect(validateProgression(d).ok).toBe(true)
 d.tmSeeds={bench:{fromE1rm:{pct:0.9}}};expect(validateProgression(d).ok).toBe(true)
 d.tmSeeds.bench.fromE1rm.expression='script';expect(codes(d)).toContain('rule.extra-field')
 d.tmSeeds={bench:{value:'100',unit:'lb'}};expect(codes(d)).toContain('rule.range')
 d.tmSeeds={bench:{value:100,unit:'kg'}};expect(codes(d)).toContain('rule.unit-mismatch')
})
it('requires stable and unambiguous SlotRefs with no positional fallback',()=>{
 const d=progressionProgramme();d.progressionRules=[syntheticRules()[4]];syntheticSlot(d).progression.rules=[]
 delete syntheticSlot(d).slotId;expect(codes(d)).toContain('rule.unknown-slot')
 syntheticSlot(d).slotId='bench';delete d.weeks[0].days[0].sessions[0].sessionTemplateId;expect(codes(d)).toContain('rule.unknown-slot')
 d.weeks[0].days[0].sessions[0].sessionTemplateId='main';d.weeks[0].days[0].sessions[0].routineSnapshot.ex.push(structuredClone(syntheticSlot(d)));expect(codes(d)).toContain('rule.unknown-slot')
})
it('checks actual working counts, rep floors, double ranges and AMRAP band order',()=>{
 const d=progressionProgramme();syntheticSlot(d).sets=1;expect(codes(d)).toContain('rule.unknown-set')
 syntheticSlot(d).sets=2;d.progressionRules[0].weeks[1][1].repsMin=undefined;expect(codes(d)).toContain('rule.range')
 d.progressionRules=[syntheticRules()[2]];syntheticSlot(d).progression.rules=['double'];d.progressionRules[0].repsLow=9;expect(codes(d)).toContain('rule.range')
 d.progressionRules=[syntheticRules()[4]];syntheticSlot(d).progression.rules=[];d.progressionRules[0].bands.reverse();expect(codes(d)).toContain('rule.range')
})
it('checks onStall roles and permits a valid attached load/stall pair',()=>{
 const d=progressionProgramme();d.progressionRules.push(syntheticRules()[5]);syntheticSlot(d).progression.onStall='stall';expect(validateProgression(d).ok).toBe(true)
 syntheticSlot(d).progression.onStall='percent';expect(codes(d)).toContain('rule.unknown-ref')
 syntheticSlot(d).progression.onStall='stall';syntheticSlot(d).progression.rules=[];expect(codes(d)).toContain('rule.unknown-ref')
})
it('detects only deload conflicts on affected slots and authored weeks',()=>{
 const d=progressionProgramme();d.progressionRules=[syntheticRules()[6],{...syntheticRules()[6],id:'deload-two'}];syntheticSlot(d).progression.rules=['deload','deload-two'];expect(codes(d)).toContain('rule.deload-overlap')
 d.weeks.push({...structuredClone(d.weeks[0]),index:2});d.progressionRules[1].weeks=[2];expect(codes(d)).not.toContain('rule.deload-overlap')
 d.progressionRules[1]=syntheticRules()[7];d.progressionRules[1].weeks=[2];syntheticSlot(d).progression.rules=['deload','ramp'];expect(codes(d)).not.toContain('rule.deload-overlap')
 d.progressionRules[1].weeks=[1];expect(codes(d)).toContain('rule.deload-overlap')
 d.progressionRules[1].scope={muscles:['invalid']};expect(codes(d)).toContain('rule.range')
})
it('uses caller-owned custom exercise muscle data at the scope lookup and forwards it from conformance',()=>{
 const d=progressionProgramme();syntheticSlot(d).id='custom-loaded';d.progressionRules=[syntheticRules()[6],syntheticRules()[7]];d.progressionRules[1].scope={muscles:['chest']};syntheticSlot(d).progression.rules=['deload','ramp']
 const custom={id:'custom-loaded',n:'Synthetic machine',eq:'machine',custom:true,muscleWeights:{chest:1}}
 expect(validateProgression(d,createExerciseIndex([custom])).issues.map(i=>i.code)).toContain('rule.deload-overlap')
 expect(validateProgression(d,{}).issues.map(i=>i.code)).not.toContain('rule.deload-overlap')
 expect(programmeConformance(d,{catalogue:[custom]}).issues.map(i=>i.code)).toContain('rule.deload-overlap')
})
it('is total, deterministic and pure for seeded arbitrary JSON and malformed rules',()=>{
 fc.assert(fc.property(fc.jsonValue({maxDepth:5}),input=>{
  for(const d of [input,{...progressionProgramme(),progressionRules:[input]}]) {
   const before=JSON.stringify(d),a=validateProgression(d);expect(validateProgression(d)).toEqual(a);expect(a.ok).toBe(a.issues.length===0);expect(JSON.stringify(d)).toBe(before)
  }
 }),{seed:100013,numRuns:1000})
})
it('rejects string numbers, out-of-range sets and extra fields as mutations rather than coercing them',()=>{
 for(const change of [(d: any)=>{d.progressionRules[0].weeks[1][0].pct='0.8'},(d: any)=>{d.progressionRules[0].extra=true},(d: any)=>{d.progressionRules[0].weeks[1].push({pct:0.8,reps:5})}]) {
  const d=progressionProgramme();change(d);expect(validateProgression(d).ok).toBe(false);expect(programmeConformance(d).level).not.toBe('Ready')
 }
})
it('uses wildcard prescriptions only where there is no explicit week override',()=>{
 const d=progressionProgramme();d.progressionRules=[syntheticRules()[1]];syntheticSlot(d).progression.rules=['rpe'];syntheticSlot(d).sets=1
 d.progressionRules[0].weeks[1]=[{reps:5,rpe:8}];expect(validateProgression(d).ok).toBe(true)
 delete d.progressionRules[0].weeks[1];expect(codes(d)).toContain('rule.unknown-set')
})
it('requires stable identity on attached rule-driven slots, without tightening legacy slots',()=>{
 const d=progressionProgramme();delete syntheticSlot(d).slotId;expect(codes(d)).toContain('rule.unknown-slot')
 syntheticSlot(d).progression.rules=[];expect(codes(d)).not.toContain('rule.unknown-slot')
})
it('preserves optional percentage rep floors and detects deload overlap only for attached ramps',()=>{
 const d=progressionProgramme();delete d.progressionRules[0].weeks[1][1].repsMin;expect(validateProgression(d).ok).toBe(true)
 d.progressionRules=[syntheticRules()[6],syntheticRules()[7]];syntheticSlot(d).progression.rules=['deload'];expect(codes(d)).not.toContain('rule.deload-overlap')
 syntheticSlot(d).progression.rules.push('ramp');expect(codes(d)).toContain('rule.deload-overlap')
})
it('retains default exercise aliases and resolves them against an explicit catalogue index',()=>{
 const d=progressionProgramme();d.progressionRules=[syntheticRules()[6],syntheticRules()[7]];d.progressionRules[1].scope={muscles:['chest']};syntheticSlot(d).id='1066';syntheticSlot(d).progression.rules=['deload','ramp']
 expect(codes(d)).toContain('rule.deload-overlap')
 expect(programmeConformance(d).issues.map(i=>i.code)).toContain('rule.deload-overlap');expect(programmeConformance(d).level).toBe('Valid')
 const catalogue=[{id:'3359',n:'Synthetic canonical alias target',muscleWeights:{chest:1}}]
 expect(programmeConformance(d,{catalogue}).issues.map(i=>i.code)).toContain('rule.deload-overlap')
})
