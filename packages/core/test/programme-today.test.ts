import {beforeEach,afterEach,vi} from 'vitest'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
// Synthetic legacy fixtures deliberately exercise tolerant and malformed persisted shapes.
type LegacyFixture = any
import { it, expect } from 'vitest'
import { activate, pause, insertDeload, advanceProgramme } from '../src/programme'
import { projectCycle } from '@opengym/core/programme-calendar'
import { shiftPreview, programmeIdle, repeatProgrammeWeek, repeatStageOf } from '../src/programme-today'
const def: LegacyFixture={id:'test',name:'Test',weeks:[1,2,3].map((index: LegacyFixture)=>({index,days:[1,2,3,4].map((i: LegacyFixture)=>({key:'d'+i,sessions:[{routineSnapshot:{name:'Day '+i,ex:[]}}]}))}))}
const state: LegacyFixture=()=>{const S: LegacyFixture={unit:'lb',routines:[],workouts:[],dayPlan:{}};activate(S,def,{cycleId:'c',today:'2026-10-12',now:1});return S}
it('shift preview derives the worked example and never mutates saved dates',()=>{const S: LegacyFixture=state(),before: LegacyFixture=structuredClone(S);const preview: LegacyFixture=shiftPreview(S,'c','2026-10-12');expect(preview.before.endDate).toBe('2026-10-31');expect(preview.after.endDate).toBe('2026-11-01');expect(preview.moved).toBe(12);expect(S).toEqual(before)})
it('a long gap is offered only after seven calendar days; a repeated week preserves history and series',()=>{const S: LegacyFixture=state(),c: LegacyFixture=S.programmes.cycles[0];expect(programmeIdle(S,c,'2026-10-18')).toBe(false);expect(programmeIdle(S,c,'2026-10-19')).toBe(true);S.workouts=[{id:'w',d:'2026-10-12',entries:[{occurrenceId:c.occurrences[0].instanceId}]}];pause(S,'c','2026-10-19');const next: LegacyFixture=repeatProgrammeWeek(S,'c','2026-10-19');expect(S.workouts).toHaveLength(1);expect(next.id).not.toBe('c');expect(next.seriesId).toBe('c');expect(S.programmes.cycles[0].status).toBe('archived');expect(projectCycle(S.programmes.cycles[0],S.workouts,'2026-10-19').pending).toHaveLength(0);expect(S.routines.find((r: LegacyFixture)=>r.programme.cycleId===next.id).programme.series).toBe('c:d1')})

it('repeats with a future inserted deload without rewriting the saved definition',()=>{
 const S: LegacyFixture=state();insertDeload(S,'c',{key:'future'});const template: LegacyFixture=structuredClone(S.programmes.definitions),snapshot: LegacyFixture=structuredClone(S.programmes.cycles[0].snapshot);const next: LegacyFixture=repeatProgrammeWeek(S,'c','2026-10-19');expect(S.programmes.definitions).toEqual(template);expect(S.programmes.cycles[0].snapshot).toEqual(snapshot);expect(next.snapshot.weeks.some((w: LegacyFixture)=>w.weekId==='deload-future')).toBe(true);expect(next.occurrences.some((o: LegacyFixture)=>o.weekId==='deload-future')).toBe(true);expect(next.weekIndex).toBe(1)
})
it('repeats the inserted current stage by identity before the next authored week',()=>{
 const S: LegacyFixture=state();insertDeload(S,'c',{key:'current'});const old: LegacyFixture=S.programmes.cycles[0];S.workouts=old.occurrences.filter((o: LegacyFixture)=>o.weekIndex===1&&!o.weekId).map((o: LegacyFixture,i: LegacyFixture)=>({id:'done'+i,d:'2026-10-12',entries:[{occurrenceId:o.instanceId}]}));advanceProgramme(S,'2026-10-13');expect(old.weekId).toBe('deload-current');const next: LegacyFixture=repeatProgrammeWeek(S,'c','2026-10-19');expect(next.weekId).toBe('deload-current');expect(S.queue.ids.every((id: LegacyFixture)=>S.routines.find((r: LegacyFixture)=>r.id===id).programme.weekId==='deload-current')).toBe(true);expect(next.occurrences.some((o: LegacyFixture)=>o.weekIndex===1)).toBe(false);expect(next.occurrences.some((o: LegacyFixture)=>o.weekIndex===2&&!o.weekId)).toBe(true)
})

it('offers pickup at the unresolved week or repeats the last trained authored week',()=>{
 const S: LegacyFixture=state(),old: LegacyFixture=S.programmes.cycles[0];S.workouts=old.occurrences.filter((o: LegacyFixture)=>o.weekIndex===1).map((o: LegacyFixture,i: LegacyFixture)=>({id:'done'+i,d:'2026-10-12',entries:[{occurrenceId:o.instanceId}]}));advanceProgramme(S,'2026-10-13');pause(S,'c','2026-10-13');expect(old.weekIndex).toBe(2);const stage: LegacyFixture=repeatStageOf(S,old,'2026-10-19');expect(stage.index).toBe(1);const next: LegacyFixture=repeatProgrammeWeek(S,'c','2026-10-19',{weekId:String(stage.index)});expect(next.weekIndex).toBe(1)
})
