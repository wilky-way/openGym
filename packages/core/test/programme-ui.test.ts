import type { Workout } from '../../contract/domain/state-doc'
import {it,expect} from 'vitest'
import {loggedProgrammeWorkout,programmeWeekSets} from '../src/programme-ui.js'
it('finds legacy logs without crediting an empty leading modern routine',()=>{
 const o={instanceId:'o',routineId:'r',status:'done',date:'2026-10-12'}, legacy={id:'legacy',routineId:'r',d:o.date,entries:[]}, modern={routineIds:['r','other'],d:o.date,entries:[{occurrenceId:'other'}]}
 expect(loggedProgrammeWorkout([legacy,modern],o)).toBe(legacy)
 expect(loggedProgrammeWorkout([modern],o)).toBeUndefined()
 expect(loggedProgrammeWorkout([{...legacy,d:'2026-10-11'}],o)).toBeUndefined()
})

it('counts deload sets by the session-start floor and minimum',()=>{
 const week={days:[{sessions:[{routineSnapshot:{ex:[{sets:4},{sets:3},{sets:1}]}}]}]}
 expect(programmeWeekSets(week)).toBe(8)
 expect(programmeWeekSets({...week,mode:'deload'})).toBe(4)
})

it('accepts contract workouts with a null legacy routine mirror', () => {
 const workouts: Workout[] = [{d:'2026-10-12',start:0,routineId:null,entries:[]},
  {id:'modern',d:'2026-10-12',start:1,routineId:null,entries:[{id:'0025',sets:[],occurrenceId:'o'}]}]
 expect(loggedProgrammeWorkout(workouts,{instanceId:'o',status:'done',date:'2026-10-12',routineId:'r'})).toBe(workouts[1])
 expect(loggedProgrammeWorkout(workouts.slice(0,1),{instanceId:'o',status:'done',date:'2026-10-12',routineId:'r'})).toBeUndefined()
})
