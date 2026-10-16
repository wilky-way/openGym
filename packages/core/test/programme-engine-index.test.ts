import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { createExerciseIndex, EXIDX, canonicalExId, isAssisted, type ExerciseIndex } from '@opengym/core/exercises'
import { EXALIAS } from '@opengym/core/exercises-data'
import { convertStateUnit } from '@opengym/core/units'
import type { ProgrammeDefinition, ProgrammeState, RoutineExercise } from '../src/programme-engine-types'
import { activate, adopt, insertDeload, materializeWeek } from '../src/programme'
import { repeatProgrammeWeek } from '../src/programme-today'
import { importProgramme, saveImportedProgramme } from '../src/programme-import'
import { applyProgrammeAgentAction } from '../src/programme-agent'
import { startProgramme, switchProgramme } from '../src/programme-lifecycle'
import { refreshProgrammeDefinitions } from '../src/programme-refresh'
import { syntheticProgramme, syntheticSource } from './fixtures/synthetic-programme'
import { indexEdges } from './fixtures/synthetic-programme-index-edges'

// Real caller-owned index and matching state/import catalogue. Never register globally.
const customEx = [{id:'custom-synthetic-assisted',n:'Synthetic assisted lift',eq:'leverage machine',assisted:true,custom:true as const}]
const index = createExerciseIndex(customEx)
const id = customEx[0]!.id
const state = (): ProgrammeState => ({unit:'kg',customEx:structuredClone(customEx),routines:[],workouts:[],dayPlan:{}})
const prescription = (): RoutineExercise => ({
 id,slotId:'assisted',role:'main',sets:2,reps:5,pyramid:[5,5],weight:100,inc:5,pyramidWeight:[100,110],
 target:{rpe:8},setTargets:[{rpe:8},{rpe:7}],
 progression:{kind:'manual',instructions:'Keep the authored effort and reps.'},
})
const definition = (): ProgrammeDefinition => {
 const d: ProgrammeDefinition = syntheticProgramme()
 d.equipment=['leverage machine']
 d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex=[prescription()]
 return d
}
const source = () => {
 const raw = syntheticSource([{count:2,reps:5,rpe:8}])
 raw.weeks[0].days[0].exercises[0].id=id
 return raw
}
const slot = (d: ProgrammeDefinition) => d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!
const current = (s: ProgrammeState, cycleId: string) => s.routines.find(r=>r.programme?.cycleId===cycleId)!
function retained(e: RoutineExercise, converted = true) {
 expect(e).toMatchObject({id,slotId:'assisted',sets:2,reps:5,weight:converted?45.25:100,inc:converted?2.25:5,
  pyramidWeight:converted?[45.25,50]:[100,110],target:{rpe:8},setTargets:[{rpe:8},{rpe:7}],progression:prescription().progression})
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())

it('materializes a real custom assisted prescription across lb to kg without losing ids or targets',()=>{
 expect(index[id]).toEqual(customEx[0]);expect(EXIDX[id]).toBeUndefined()
 expect(isAssisted(id,index)).toBe(true);expect(isAssisted(id)).toBe(false)
 const d=definition(),before=structuredClone(d)
 const built=materializeWeek(d,d.weeks[0]!,{id:'c'},{unit:'kg'},index)
 retained(built.routines[0]!.ex[0]!)
 expect(built.routines[0]!.id).toBe('c-w1d1')
 expect(built.occurrences[0]).toMatchObject({instanceId:'c:w1d1',routineId:'c-w1d1'})
 expect(d).toEqual(before)
})
it('activates custom prescriptions and adopts existing custom routine ids and prescriptions',()=>{
 const S=state(),d=definition(),cycle=activate(S,d,{cycleId:'c',today:'2026-10-12'},index)
 retained(current(S,'c').ex[0]!);retained(slot(cycle.snapshot),false)
 expect(S.queue!.ids).toEqual(['c-w1d1'])
 const T=state();T.routines=[{id:'existing-custom',name:'Existing',ex:[prescription()]}]
 adopt(T,d,['existing-custom'],{cycleId:'adopted',today:'2026-10-12'},index)
 expect(T.routines.map(r=>r.id)).toEqual(['existing-custom'])
 retained(T.routines[0]!.ex[0]!,false)
 expect(T.queue!.ids).toEqual(['existing-custom'])
 expect(T.programmes!.cycles[0]!.occurrences[0]!.routineId).toBe('existing-custom')
})
it('inserts and repeats both authored and inserted custom stages, retaining source snapshots and effort rules',()=>{
 const S=state();activate(S,definition(),{cycleId:'c',today:'2026-10-12'},index)
 const inserted=insertDeload(S,'c',{key:'custom'},index)
 expect(inserted).toBeTruthy()
 const old=S.programmes!.cycles[0]!,week=old.snapshot.weeks.find(w=>w.weekId)!
 const deload=S.routines.find(r=>r.programme?.weekId===week.weekId)!
 expect(deload.ex[0]).toMatchObject({id,slotId:'assisted',sets:2,reps:5,weight:45.25,target:{rir:8},setTargets:[{rir:8},{rir:8}]})
 expect(deload.deload).toMatchObject({setsFactor:.5,loadFactor:.7})
 const before=structuredClone(S.programmes!.definitions)
 const next=repeatProgrammeWeek(S,'c','2026-10-19',{},index)
 expect(next).not.toBe(false)
 if(!next)throw new Error('Expected an authored repeat')
 retained(current(S,next.id).ex[0]!)
 expect(next.snapshot.weeks.some(w=>w.weekId===week.weekId)).toBe(true)
 const again=repeatProgrammeWeek(S,next.id,'2026-10-26',{weekId:week.weekId!},index)
 expect(again).not.toBe(false)
 if(!again)throw new Error('Expected an inserted repeat')
 expect(current(S,again.id).ex[0]).toMatchObject({id,slotId:'assisted',sets:2,reps:5,weight:45.25,target:{rir:8},setTargets:[{rir:8},{rir:8}]})
 expect(again.weekId).toBe(week.weekId)
 expect(S.programmes!.definitions).toEqual(before)
 retained(slot(old.snapshot),false)
})
it.each(['object','JSON'] as const)('imports native custom definitions from %s and saves retained prescriptions',format=>{
 const d=definition(),preview=importProgramme(format==='JSON'?JSON.stringify(d):d,{customEx},index)
 expect(preview.unknown).toEqual([]);expect(preview.unprescribed).toEqual([])
 retained(slot(preview.definition as ProgrammeDefinition),false)
 const S=state();saveImportedProgramme(S,preview,{},index)
 retained(slot(S.programmes!.definitions[0]!),false)
 expect(S.programmes!.definitions[0]!.id).toBe(d.id)
})
it('resolves a custom source id, imports its per-set prescription and saves it',()=>{
 const preview=importProgramme(source(),{customEx,strictPrescriptions:true},index)
 expect(preview.unknown).toEqual([]);expect(preview.unprescribed).toEqual([])
 const S=state();saveImportedProgramme(S,preview,{},index)
 expect(slot(S.programmes!.definitions[0]!)).toMatchObject({id,sets:2,reps:5,setTargets:[{rpe:8},{rpe:8}]})
 expect(S.programmes!.definitions[0]!.id).toBe('synthetic-source')
})
it('starts and switches custom lifecycles atomically, retaining the archived routine and snapshot',()=>{
 const S=state();startProgramme(S,definition(),{cycleId:'old',today:'2026-10-12'},index)
 retained(current(S,'old').ex[0]!)
 const oldRoutineId=current(S,'old').id
 switchProgramme(S,'old',{...definition(),id:'new'},{cycleId:'new',today:'2026-10-13'},index)
 retained(current(S,'new').ex[0]!);retained(S.routines.find(r=>r.id===oldRoutineId)!.ex[0]!)
 expect(S.programmes!.cycles[0]!.status).toBe('archived')
 retained(slot(S.programmes!.cycles[0]!.snapshot),false)
 expect(S.queue!.ids).toEqual(['new-w1d1'])
})
it('activates a saved custom definition through the agent with intact ids and converted prescriptions',()=>{
 const S=state();S.programmes={version:1,fork:'wilky/1',definitions:[definition()],cycles:[]}
 const cycle=applyProgrammeAgentAction(S,'activate',{programmeId:'synthetic'},'2026-10-12',index)
 expect(cycle).toBeTruthy()
 retained(S.routines[0]!.ex[0]!)
 expect(S.programmes!.cycles[0]!.snapshot.id).toBe('synthetic')
 retained(slot(S.programmes!.cycles[0]!.snapshot),false)
})
it('refreshes custom source files and state-only repairs with retained ids, effort and equipment',()=>{
 const S=state(),before=structuredClone(S)
 const imported=refreshProgrammeDefinitions(S,[{raw:source(),filename:'synthetic.json'}],{},index)
 expect(imported.report.added).toEqual(['synthetic-source'])
 const d=imported.state.programmes!.definitions[0]!
 expect(slot(d)).toMatchObject({id,sets:2,reps:5,setTargets:[{rpe:8},{rpe:8}]})
 expect(d.equipment).toEqual(['leverage machine'])
 expect(imported.report.conformance[0]!.after).not.toBe('Invalid')
 expect(S).toEqual(before)
 const stored=state();const incomplete=definition();delete incomplete.equipment;delete incomplete.lengthWeeks
 stored.programmes={version:1,fork:'wilky/1',definitions:[incomplete],cycles:[]}
 const repaired=refreshProgrammeDefinitions(stored,[],{repair:true},index)
 expect(repaired.report.updated).toEqual(['synthetic'])
 expect(repaired.report.conformance[0]!.after).toBe('Ready')
 expect(repaired.state.programmes!.definitions[0]!.equipment).toEqual(['leverage machine'])
 retained(slot(repaired.state.programmes!.definitions[0]!),false)
 expect(stored.programmes!.definitions[0]!.equipment).toBeUndefined()
 // Existing source re-import also exercises the rank comparison against the prior definition.
 const updated=refreshProgrammeDefinitions(imported.state,[{raw:source()}],{},index)
 expect(updated.report.updated).toEqual(['synthetic-source'])
 expect(slot(updated.state.programmes!.definitions[0]!)).toEqual(slot(d))
})

it('pins membership-only validation while real custom alias identity depends on the index',()=>{
 const shadow={id:'1019',n:'Synthetic alias shadow',eq:'leverage machine',custom:true as const}
 const shadowIndex=createExerciseIndex([shadow])
 const members=new Set([...Object.keys(EXIDX),shadow.id,id])
 expect(canonicalExId(shadow.id,shadowIndex)).toBe(shadow.id)
 expect(canonicalExId(shadow.id)).toBe('3841')
 for(const exerciseId of [...Object.keys(EXALIAS),shadow.id,id]) {
  expect(members.has(canonicalExId(exerciseId,shadowIndex))).toBe(members.has(canonicalExId(exerciseId)))
 }
 // Native definition validation preserves its input id rather than canonicalizing it.
 const d=definition();slot(d).id=shadow.id
 for(const format of [d,JSON.stringify(d)]) {
  expect(slot(importProgramme(format,{customEx:[shadow]},shadowIndex).definition as ProgrammeDefinition).id).toBe(shadow.id)
  expect(slot(importProgramme(format,{customEx:[shadow]}).definition as ProgrammeDefinition).id).toBe(shadow.id)
 }
})
it('keeps the custom alias id in source import and source refresh actual output',()=>{
 const shadow={id:'1019',n:'Synthetic alias shadow',eq:'leverage machine',custom:true as const}
 const shadowIndex=createExerciseIndex([shadow]),raw=source()
 raw.weeks[0].days[0].exercises[0].id=shadow.id
 const preview=importProgramme(raw,{customEx:[shadow],strictPrescriptions:true},shadowIndex)
 expect(preview.unknown).toEqual([])
 expect(slot(preview.definition as ProgrammeDefinition).id).toBe(shadow.id)
 const S=state();S.customEx=[shadow]
 const refreshed=refreshProgrammeDefinitions(S,[{raw}],{},shadowIndex)
 expect(refreshed.report.needsReview).toEqual([])
 expect(refreshed.report.added).toEqual(['synthetic-source'])
 expect(slot(refreshed.state.programmes!.definitions[0]!).id).toBe(shadow.id)
})
it('keeps built-in equipment distinct from custom alias-shadow equipment during stored repair',()=>{
 const shadow={id:'1019',n:'Synthetic alias shadow',eq:'leverage machine',custom:true as const}
 const shadowIndex=createExerciseIndex([shadow]),d=definition()
 slot(d).id='3841';delete d.equipment
 const S=state();S.customEx=[shadow];S.programmes={version:1,fork:'wilky/1',definitions:[d],cycles:[]}
 const repaired=refreshProgrammeDefinitions(S,[],{repair:true},shadowIndex)
 expect(repaired.report.needsReview).toEqual([])
 expect(repaired.report.updated).toEqual(['synthetic'])
 expect(repaired.state.programmes!.definitions[0]!.equipment).toEqual(['band'])
 expect(slot(repaired.state.programmes!.definitions[0]!).id).toBe('3841')
 expect(S.programmes!.definitions[0]!.equipment).toBeUndefined()
})
it('proves the routine-only conversion payload is index inert even while conversion runs',()=>{
 const input={unit:'lb',routines:[{ex:[prescription()]}]}
 const withIndex=convertStateUnit(input,'kg',index),withoutIndex=convertStateUnit(input,'kg')
 expect(withIndex).toEqual(withoutIndex);expect(withIndex.routines[0].ex[0].weight).toBe(45.25)
 // units accesses exercise metadata only for barWeights/workout volume; K12 passes neither.
 expect(Object.keys(input).sort()).toEqual(['routines','unit'])
})

// The standing ruling permits AST checks only for proven inert edges. These checks
// preserve the caller's parameter identity without mocking any domain predicate.
type AstNode = {type?: string; [key: string]: unknown}
function calls(sourceText: string): AstNode[] {
 const result: AstNode[]=[]
 const visit=(value: unknown): void=>{
  if(Array.isArray(value)){value.forEach(visit);return}
  if(!value || typeof value!=='object')return
  const node=value as AstNode
  if(node.type==='CallExpression')result.push(node)
  for(const [key,child] of Object.entries(node))if(!['loc','comments','tokens'].includes(key))visit(child)
 }
 visit(parse(sourceText,{sourceType:'module',plugins:['typescript']}))
 return result
}
for(const edge of indexEdges)it(`inert forwarding: ${edge.name}`,()=>{
 const text=readFileSync(new URL(`../src/${edge.module}.ts`,import.meta.url),'utf8')
 const matching=calls(text).filter(n=>(n.callee as AstNode)?.name===edge.callee)
 expect(matching,edge.proof).toHaveLength(edge.total)
 const argument=(matching[edge.ordinal]!.arguments as AstNode[])[edge.argument]
 expect(argument,edge.proof).toMatchObject({type:'Identifier',name:'index'})
})

// A caller's immutable index can outlive a retired state/import custom row.
// No contract requires the explicit index and catalogue to have identical customs.
// Fail closed rather than silently turning the retired alias shadow into a built-in.
it('rejects a retired custom alias through parsed import, standalone save and refresh assessment',()=>{
 const shadow={id:'1019',n:'Retired synthetic alias shadow',eq:'leverage machine',custom:true as const}
 const retiredIndex=createExerciseIndex([shadow]),d=definition();slot(d).id=shadow.id
 expect(()=>importProgramme(JSON.stringify(d),{},retiredIndex)).toThrow('Resolve unknown exercises')
 const S=state();S.customEx=[]
 expect(()=>saveImportedProgramme(S,{definition:d,unknown:[]},{},retiredIndex)).toThrow('Resolve unknown exercises')
 S.programmes={version:1,fork:'wilky/1',definitions:[d],cycles:[]}
 const refreshed=refreshProgrammeDefinitions(S,[],{},retiredIndex)
 expect(refreshed.report.conformance[0]).toMatchObject({before:'Invalid',after:'Invalid'})
 expect(refreshed.state.programmes!.definitions[0]).toEqual(d)
})
it('preflights the native custom alias before a JSON hook changes the serialized identity',()=>{
 const shadow={id:'1019',n:'Retired synthetic alias shadow',eq:'leverage machine',custom:true as const}
 const retiredIndex=createExerciseIndex([shadow]),d=definition();slot(d).id=shadow.id
 const serialized=definition();slot(serialized).id='0025'
 Object.defineProperty(d,'toJSON',{enumerable:false,value:()=>serialized})
 expect(()=>importProgramme(d,{},retiredIndex)).toThrow('Resolve unknown exercises')
 expect(slot(d).id).toBe(shadow.id)
})
it('rejects a retired custom alias atomically through start, switch and agent activation',()=>{
 const shadow={id:'1019',n:'Retired synthetic alias shadow',eq:'leverage machine',custom:true as const}
 const retiredIndex=createExerciseIndex([shadow]),d=definition();slot(d).id=shadow.id
 const S=state();S.customEx=[];const before=structuredClone(S)
 expect(()=>startProgramme(S,d,{cycleId:'new',today:'2026-10-12'},retiredIndex)).toThrow('Resolve unknown exercises')
 expect(S).toEqual(before)
 const existing=definition();slot(existing).id='0025'
 activate(S,existing,{cycleId:'old',today:'2026-10-12'},retiredIndex)
 const running=structuredClone(S)
 expect(()=>switchProgramme(S,'old',d,{cycleId:'new',today:'2026-10-13'},retiredIndex)).toThrow('Resolve unknown exercises')
 expect(S).toEqual(running)
 const T=state();T.customEx=[];T.programmes={version:1,fork:'wilky/1',definitions:[d],cycles:[]}
 expect(()=>applyProgrammeAgentAction(T,'activate',{programmeId:'synthetic'},'2026-10-12',retiredIndex)).toThrow('Resolve unknown exercises')
 expect(T.programmes!.cycles).toEqual([])
})
