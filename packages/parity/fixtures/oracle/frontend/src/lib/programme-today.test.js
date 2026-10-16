import { it, expect } from 'vitest'
import { activate, pause, insertDeload, advanceProgramme } from './programme.js'
import { projectCycle } from './programme-calendar.js'
import { shiftPreview, programmeIdle, repeatProgrammeWeek, repeatStageOf } from './programme-today.js'
const def={id:'test',name:'Test',weeks:[1,2,3].map(index=>({index,days:[1,2,3,4].map(i=>({key:'d'+i,sessions:[{routineSnapshot:{name:'Day '+i,ex:[]}}]}))}))}
const state=()=>{const S={unit:'lb',routines:[],workouts:[],dayPlan:{}};activate(S,def,{cycleId:'c',today:'2026-10-12',now:1});return S}
it('shift preview derives the worked example and never mutates saved dates',()=>{const S=state(),before=structuredClone(S);const preview=shiftPreview(S,'c','2026-10-12');expect(preview.before.endDate).toBe('2026-10-31');expect(preview.after.endDate).toBe('2026-11-01');expect(preview.moved).toBe(12);expect(S).toEqual(before)})
it('a long gap is offered only after seven calendar days; a repeated week preserves history and series',()=>{const S=state(),c=S.programmes.cycles[0];expect(programmeIdle(S,c,'2026-10-18')).toBe(false);expect(programmeIdle(S,c,'2026-10-19')).toBe(true);S.workouts=[{id:'w',d:'2026-10-12',entries:[{occurrenceId:c.occurrences[0].instanceId}]}];pause(S,'c','2026-10-19');const next=repeatProgrammeWeek(S,'c','2026-10-19');expect(S.workouts).toHaveLength(1);expect(next.id).not.toBe('c');expect(next.seriesId).toBe('c');expect(S.programmes.cycles[0].status).toBe('archived');expect(projectCycle(S.programmes.cycles[0],S.workouts,'2026-10-19').pending).toHaveLength(0);expect(S.routines.find(r=>r.programme.cycleId===next.id).programme.series).toBe('c:d1')})

it('repeats with a future inserted deload without rewriting the saved definition',()=>{
 const S=state();insertDeload(S,'c',{key:'future'});const template=structuredClone(S.programmes.definitions),snapshot=structuredClone(S.programmes.cycles[0].snapshot);const next=repeatProgrammeWeek(S,'c','2026-10-19');expect(S.programmes.definitions).toEqual(template);expect(S.programmes.cycles[0].snapshot).toEqual(snapshot);expect(next.snapshot.weeks.some(w=>w.weekId==='deload-future')).toBe(true);expect(next.occurrences.some(o=>o.weekId==='deload-future')).toBe(true);expect(next.weekIndex).toBe(1)
})
it('repeats the inserted current stage by identity before the next authored week',()=>{
 const S=state();insertDeload(S,'c',{key:'current'});const old=S.programmes.cycles[0];S.workouts=old.occurrences.filter(o=>o.weekIndex===1&&!o.weekId).map((o,i)=>({id:'done'+i,d:'2026-10-12',entries:[{occurrenceId:o.instanceId}]}));advanceProgramme(S,'2026-10-13');expect(old.weekId).toBe('deload-current');const next=repeatProgrammeWeek(S,'c','2026-10-19');expect(next.weekId).toBe('deload-current');expect(S.queue.ids.every(id=>S.routines.find(r=>r.id===id).programme.weekId==='deload-current')).toBe(true);expect(next.occurrences.some(o=>o.weekIndex===1)).toBe(false);expect(next.occurrences.some(o=>o.weekIndex===2&&!o.weekId)).toBe(true)
})

it('offers pickup at the unresolved week or repeats the last trained authored week',()=>{
 const S=state(),old=S.programmes.cycles[0];S.workouts=old.occurrences.filter(o=>o.weekIndex===1).map((o,i)=>({id:'done'+i,d:'2026-10-12',entries:[{occurrenceId:o.instanceId}]}));advanceProgramme(S,'2026-10-13');pause(S,'c','2026-10-13');expect(old.weekIndex).toBe(2);const stage=repeatStageOf(S,old,'2026-10-19');expect(stage.index).toBe(1);const next=repeatProgrammeWeek(S,'c','2026-10-19',{weekId:String(stage.index)});expect(next.weekIndex).toBe(1)
})
