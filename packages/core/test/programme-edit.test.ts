import type { Cycle, SchedulingState, Log, Occurrence } from '../src/programme-sync'
import { it, expect } from 'vitest'
import { editProgrammeSessions } from '../src/programme-edit'
it('edits only pending sessions on this day, preserving completed and other-day prescriptions', () => {
  const S: SchedulingState = { routines: [1,2,3,4].map(i => ({ id: 'r'+i, ex: [{ sets:i }], programme: { cycleId:'c', instanceId:'o'+i } })), workouts: [{ entries:[{occurrenceId:'o2'}], d:'2026-10-12' }], programmes: {cycles:[{id:'c', occurrences:[1,2,3,4].map(i => ({instanceId:'o'+i,routineId:'r'+i,weekIndex:i,dayKey:i===3?'d2':'d1',status:'pending'}))}]} }
  editProgrammeSessions(S, 'r1', ex => { ex[0]!.sets!++ }, true)
  expect(S.routines.map(r=>r.ex![0]!.sets)).toEqual([2,2,3,2])
})

const scoped = () => {
 const cycles: Cycle & { occurrences: Occurrence[]; snapshot: { weeks: NonNullable<NonNullable<Cycle["snapshot"]>["weeks"]> } } = {id:'c',occurrences:[],snapshot:{weeks:[]}}
 const S: SchedulingState={routines:[],workouts:[],programmes:{cycles:[cycles]}}
 for(const [week,session,ex] of [[1,'am',[{id:'bench',sets:3},{id:'row',sets:4}]],[2,'am',[{id:'row',sets:5},{id:'bench',sets:6}]],[3,'am',[{id:'row',sets:7}]],[2,'pm',[{id:'bench',sets:8}]]] as [number,string,import('../../contract/domain/state-doc').RoutineExercise[]][]) {
  const id=`${week}-${session}`; S.routines.push({id,ex,programme:{cycleId:'c',instanceId:id}}); cycles.occurrences.push({instanceId:id,routineId:id,weekIndex:week,dayKey:'d1',sessionTemplateId:session,status:'pending'})
 }
 return S
}
it('scoped field changes match the lift after reordering, preserve other fields, omit missing lifts and evening sessions',()=>{
 const S=scoped(); editProgrammeSessions(S,'1-am',ex=>{ex[0]!.sets=10},true)
 expect(S.routines.map(r=>r.ex)).toMatchObject([[{id:'bench',sets:10},{id:'row',sets:4}],[{id:'row',sets:5},{id:'bench',sets:10}],[{id:'row',sets:7}],[{id:'bench',sets:8}]])
})
it('remove never deletes the exercise now sitting at the same later index',()=>{
 const S=scoped(); editProgrammeSessions(S,'1-am',ex=>ex.splice(0,1),true)
 expect(S.routines.map(r=>r.ex!.map(e=>e.id))).toEqual([['row'],['row'],['row'],['bench']])
})
it('add and reorder preserve stable identities without touching missing slots or other sessions',()=>{
 const S=scoped(); editProgrammeSessions(S,'1-am',ex=>ex.push({id:'curl',sets:2}),true)
 const id=S.routines[0]!.ex!.at(-1)!.slotId;expect(S.routines[1]!.ex!.at(-1)!.slotId).toBe(id);expect(S.routines[3]!.ex).toHaveLength(1)
 editProgrammeSessions(S,'1-am',ex=>ex.reverse(),true)
 expect(S.routines.map(r=>r.ex!.map(e=>e.id))).toEqual([['curl','row','bench'],['curl','row','bench'],['curl','row'],['bench']])
})
it('scoped edits update the frozen snapshot but do not rewrite the saved definition',()=>{
 const S=scoped();S.programmes!.cycles![0]!.snapshot!.weeks=[{index:1,days:[{key:'d1',sessions:[{sessionTemplateId:'am',routineSnapshot:{ex:[]}}]}]}];S.programmes!.definitions=[{id:'d',weeks:[]}]
 editProgrammeSessions(S,'1-am',ex=>{ex[0]!.sets=9},true)
 expect(S.programmes!.cycles![0]!.snapshot!.weeks![0]!.days![0]!.sessions![0]!.routineSnapshot!.ex![0]!.sets).toBe(9);expect(S.programmes!.definitions[0]!.weeks).toEqual([])
})
it('ambiguous legacy twins: removing the first bench cannot remove the retained second bench in a later week',()=>{
 const S=scoped();S.routines[0]!.ex=[{id:'bench',sets:3},{id:'row',sets:4},{id:'bench',sets:5}];S.routines[1]!.ex=[{id:'bench',sets:5}]
 editProgrammeSessions(S,'1-am',ex=>ex.splice(0,1),true)
 expect(S.routines[0]!.ex!.map(e=>e.id)).toEqual(['row','bench']);expect(S.routines[1]!.ex).toEqual([{id:'bench',sets:5}])
})
it('ambiguous legacy twins reordered later are left alone when a prescription changes',()=>{
 const S=scoped();S.routines[0]!.ex=[{id:'bench',sets:3},{id:'bench',sets:5}];S.routines[1]!.ex=[{id:'bench',sets:5},{id:'bench',sets:3}]
 editProgrammeSessions(S,'1-am',ex=>{ex[0]!.sets=9},true);expect(S.routines[1]!.ex!.map(e=>e.sets)).toEqual([5,3])
})
it('authored twin identities match after reordering',()=>{
 const S=scoped();S.routines[0]!.ex=[{id:'bench',slotId:'heavy',sets:3},{id:'bench',slotId:'light',sets:5}];S.routines[1]!.ex=[{id:'bench',slotId:'light',sets:5},{id:'bench',slotId:'heavy',sets:3}]
 editProgrammeSessions(S,'1-am',ex=>{ex[0]!.sets=9},true);expect(S.routines[1]!.ex!.map(e=>e.sets)).toEqual([5,9])
})
it('unnamed PM sessions update the PM snapshot rather than the AM snapshot',()=>{
 const S=scoped();S.programmes!.cycles![0]!.occurrences=[{instanceId:'2-am',routineId:'2-am',weekIndex:2,dayKey:'d1',status:'pending'},{instanceId:'2-pm',routineId:'2-pm',weekIndex:2,dayKey:'d1',status:'pending'}];S.programmes!.cycles![0]!.snapshot!.weeks=[{index:2,days:[{key:'d1',sessions:[{routineSnapshot:{ex:[{id:'row',sets:5}]}},{routineSnapshot:{ex:[{id:'bench',sets:8}]}}]}]}]
 editProgrammeSessions(S,'2-pm',ex=>{ex[0]!.sets=10})
 expect(S.programmes!.cycles![0]!.snapshot!.weeks![0]!.days![0]!.sessions!.map(s=>s.routineSnapshot!.ex![0]!.sets)).toEqual([5,10])
})
