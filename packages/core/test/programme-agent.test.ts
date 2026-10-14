import {beforeEach,afterEach,vi} from 'vitest'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
// Synthetic legacy fixtures deliberately exercise tolerant and malformed persisted shapes.
type LegacyFixture = any
import {it,expect} from 'vitest'
import {programmePosition,applyProgrammeAgentAction,getProgramme} from '../src/programme-agent'
import {projectCycle} from '@opengym/core/programme-calendar'
const def: LegacyFixture={id:'synthetic',name:'Test',unit:'lb',weeks:[1,2].map((index: LegacyFixture)=>({index,days:['d1','d2'].map((key: LegacyFixture)=>({key,sessions:[{routineSnapshot:{name:key,ex:[{id:'0025',sets:3,reps:8,weight:100}]}}]}))}))}
const state: LegacyFixture=()=>({unit:'lb',routines:[{id:'old1',ex:[{id:'0025',sets:4,reps:6,weight:150}]},{id:'old2',ex:[]}],workouts:[],queue:{ids:['old2','old1'],since:10,startsOn:'2026-10-12'},programmes:{definitions:[structuredClone(def)],cycles:[]}})
it('agent adoption preserves queue order, ids, prescriptions and existing history',()=>{const S: LegacyFixture=state();S.workouts=[{id:'log',d:'2026-10-12',start:20,routineId:'old1',entries:[]}];const before: LegacyFixture=structuredClone(S);const c: LegacyFixture=applyProgrammeAgentAction(S,'activate',{programmeId:'synthetic',existingRoutineIds:{d1:'old1',d2:'old2'}},'2026-10-12');expect(S.queue.ids).toEqual(before.queue.ids);expect(S.routines[0].ex[0]).toMatchObject(before.routines[0].ex[0]);expect(S.workouts).toEqual(before.workouts);const p: LegacyFixture=programmePosition(S,'2026-10-12');expect(p.next.routineId).toBe('old2');expect(p.adherence.done).toBe(1);expect(p.endDate).toBe(projectCycle(c,S.workouts,'2026-10-12',S.queue).endDate)})
it('agent actions refuse stale identities and invalid dates without changing the draft',()=>{const S: LegacyFixture=state(),before: LegacyFixture=structuredClone(S);expect(()=>applyProgrammeAgentAction(S,'activate',{programmeId:'synthetic'},'2026-02-30')).toThrow('calendar date');expect(()=>applyProgrammeAgentAction(S,'activate',{programmeId:'missing'},'2026-10-12')).toThrow('does not exist');expect(S).toEqual(before)})
it('active workout blocks agent activation and archived history remains readable',()=>{const S: LegacyFixture=state();S.active={id:'in-progress'};expect(()=>applyProgrammeAgentAction(S,'activate',{programmeId:'synthetic'},'2026-10-12')).toThrow('current workout');S.active=null;const c: LegacyFixture=applyProgrammeAgentAction(S,'activate',{programmeId:'synthetic'},'2026-10-12');c.status='archived';const before: LegacyFixture=JSON.stringify(S);expect(getProgramme(S,{cycleId:c.id}).definition!.name).toBe('Test');expect(programmePosition(S,'2026-10-12',c.id).next).toBeNull();expect(JSON.stringify(S)).toBe(before)})
it('records earlier numbered weeks as pre-app without authoring missing prescriptions',()=>{
 const S: LegacyFixture=state();S.programmes.definitions[0].weeks=[4,5,6].map((index: LegacyFixture)=>({...structuredClone(def.weeks[0]),index}))
 const c: LegacyFixture=applyProgrammeAgentAction(S,'activate',{programmeId:'synthetic',weekIndex:4,existingRoutineIds:{d1:'old1',d2:'old2'}},'2026-10-12')
 expect(c.preApp.weeks).toEqual([1,2,3]);expect(c.snapshot.weeks.map((w: LegacyFixture)=>w.index)).toEqual([4,5,6]);expect(S.workouts).toEqual([])
})

it('reports a profile-scale program projection alongside the untouched authored definition',()=>{
 const S: LegacyFixture=state(),d: LegacyFixture=S.programmes.definitions[0];d.weeks[0].rir=1.5;d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].setTargets=[{rpe:8.5},{rir:2},{rir:3}]
 S.effort='rpe';const before: LegacyFixture=JSON.stringify(S),view: LegacyFixture=getProgramme(S,{programmeId:d.id})
 expect(view.effortScale).toBe('rpe');expect(view.definition.weeks[0].rir).toBe(1.5);expect(view.displayDefinition.weeks[0].effort).toEqual({rpe:8.5})
 expect(view.displayDefinition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].setTargets).toEqual([{rpe:8.5},{rpe:8},{rpe:7}]);expect(JSON.stringify(S)).toBe(before)
})
