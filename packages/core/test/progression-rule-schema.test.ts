import { it, expect } from 'vitest'
import { programmeSchemaIssues } from '../src/programme-model-schema'
import { progressionRuleSchemas } from '../src/progression-rule-schema'
import { syntheticRules, progressionProgramme } from './fixtures/synthetic-progression'
it('accepts every closed rule kind and the additive definition and slot fields',()=>{
 for(const rule of syntheticRules())expect(programmeSchemaIssues(rule,progressionRuleSchemas[rule.kind]),rule.kind).toEqual([])
 expect(programmeSchemaIssues(progressionProgramme())).toEqual([])
})
it('rejects extra fields and string numbers for every rule kind',()=>{
 for(const rule of syntheticRules()) {
  expect(programmeSchemaIssues({...rule,stage:'expression'},progressionRuleSchemas[rule.kind])).not.toEqual([])
  const bad=JSON.parse(JSON.stringify(rule),(_,v)=>typeof v==='number'?String(v):v)
  expect(programmeSchemaIssues(bad,progressionRuleSchemas[rule.kind])).not.toEqual([])
 }
})
it('closes nested objects, map values and tagged unions',()=>{
 const rules=syntheticRules() as any[]
 const changes: ((rules: any[])=>void)[]=[
  r=>{r[0].ref.expression='tm*2'},r=>{r[0].weeks[1][0].extra=true},r=>{r[0].rounding.extra=true},
  r=>{r[1].e1rm.window={sessions:2,days:7}},r=>{r[1].whenNoData.pct=0.8},
  r=>{r[1].weeks['*'][0].rir=2},r=>{r[3].every={sessions:2,weeks:1}},
  r=>{r[4].source.slot.extra=true},r=>{r[4].bands[0].extra=true},
  r=>{r[5].action.weeks=1},r=>{r[6].effort.rpe=8},r=>{r[7].scope.muscles=['chest']},
 ]
 for(const change of changes) {
  const mutated=structuredClone(rules);change(mutated)
  expect(mutated.some(r=>programmeSchemaIssues(r,progressionRuleSchemas[r.kind]).length)).toBe(true)
 }
 const d=progressionProgramme();d.tmSeeds.bench.expression='load';expect(programmeSchemaIssues(d)).not.toEqual([])
})
it('enforces numeric bounds, rule ids, week-key grammar and exact effort scales',()=>{
 const changes: [number,string,unknown][]=[
  [0,'id','Bad ID'],[0,'weeks',{'01':[{pct:0.8,reps:5}]}],
  [0,'weeks',{'1':[{pct:1.51,reps:5}]}],[0,'weeks',{'1':[{pct:0,reps:5}]}],
  [0,'weeks',{'1':[{pct:0.8,reps:101}]}],[1,'weeks',{'*':[{reps:5}]}],
  [1,'weeks',{'*':[{reps:5,rpe:0}]}],[2,'increment',101],[4,'bands',Array(11).fill({minRepsOver:0,tmDelta:0})],
  [4,'source',{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:100}],
  [5,'after',11],[5,'action',{kind:'reset',pct:1}],[6,'setsFactor',0],[7,'addPerWeek',11],
 ]
 for(const [i,field,value] of changes) {
  const rule={...syntheticRules()[i]!,[field]:value};expect(programmeSchemaIssues(rule,progressionRuleSchemas[rule.kind]),`${i}/${field}`).not.toEqual([])
 }
})
