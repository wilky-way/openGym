import {expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {importProgramme,saveImportedProgramme} from '../src/programme-import'
import {startProgramme} from '../src/programme-lifecycle'
import {projectCycle,addProgrammeDays} from '../src/programme-calendar'
import {queueNext} from '../src/queue'
import {buildCombinedEntries,requireProgrammeStart} from '../src/session-merge'
import {programmeInstanceFor} from '../src/session-start'
import {buildCompletedWorkout} from '../src/finish-workout'
import {advanceProgramme} from '../src/programme'
import {finishProgrammeBlock} from '../src/programme-rollover'
import {repeatSessionEntries} from '../src/session-repeat'
import {workoutVolume} from '../src/history'
import {ownedWeightsFor} from '../src/dumbbells'
import type {Routine, Workout} from '../../contract/domain/state-doc'
import type {Routine as SessionRoutine, Session} from '../src/session-types'
// Deliberately invented persisted state exercises the public seed/native-engine composition.
// Loose persisted fixtures are the same tolerated input domain as the import API.
type Fixture = Record<string, any> & {routines: (Routine & SessionRoutine)[]; workouts: (Workout & Session)[]}
it.each(['kg','lb'])('%s single-bell loads stay physical at every dumbbell seed occurrence', unit => {
  const definition=JSON.parse(readFileSync(new URL('../../../seeds/generic-v1/dumbbell-only.json',import.meta.url),'utf8'))
  const state:Fixture={unit,effortScale:'rir',routines:[],workouts:[],dayPlan:{},week:{},exWeights:{},dbLoad:{'1760':{mode:'each',_ts:1}},dumbbells:{[unit]:{weights:[16,20,24],_ts:1}}}
  saveImportedProgramme(state,importProgramme(definition,{strictPrescriptions:true}))
  startProgramme(state,state.programmes.definitions[0],{cycleId:'public-invented',today:'2026-01-05',now:1,perWeek:3})
  let date='2026-01-05'
  for(const [ordinal,load] of [16,20,24].entries()) {
    const cycle=state.programmes.cycles.find((c:Fixture)=>c.status==='active')
    const occurrence=projectCycle(cycle,state.workouts,date,state.queue).next!
    date=occurrence.date!
    const routine=queueNext(state,date,date)!
    requireProgrammeStart(state,[routine],date)
    const built=buildCombinedEntries(state,[routine])
    const goblet=built.entries.find(entry=>entry.id==='1760')!
    expect(goblet.target?.dbLoad).toBe('as')
    expect(goblet.target?.side).toBeUndefined()
    expect(ownedWeightsFor(state,{id:goblet.id,dbLoad:goblet.target?.dbLoad})).toEqual([16,20,24])
    const active={id:`invented-volume-${ordinal}`,d:date,unit,start:1000+ordinal,name:'Invented bell control',routineIds:built.routineIds,programmeInstance:programmeInstanceFor(built.routines)??undefined,
      entries:built.entries.map(entry=>({...entry,sets:entry.sets.map(row=>({...row,w:load,r:8,done:true}))}))}
    const saved=JSON.parse(JSON.stringify(buildCompletedWorkout(active,{end:2000+ordinal})))
    state.workouts.push(saved)
    const before=JSON.stringify(state)
    for(const entry of saved.entries) {
      const expected=(entry.id==='1760'?1:2)*load*8*3
      expect(workoutVolume({entries:[entry]})).toBe(expected)
      expect(entry.target.dbLoad).toBe(entry.id==='1760'?'as':'each')
    }
    const repeated=repeatSessionEntries(state,saved)
    expect(repeated.skipped).toBe(0)
    const again=repeated.entries.find(entry=>entry.id==='1760')!
    expect(again.target?.dbLoad).toBe('as')
    expect(again.sets?.map(row=>[row.w,row.done])).toEqual([[load,false],[load,false],[load,false]])
    expect(JSON.stringify(state)).toBe(before)
    advanceProgramme(state,date,3000+ordinal)
    date=addProgrammeDays(date,1)!
  }
  const finished=state.programmes.cycles.find((c:Fixture)=>c.status==='finished')
  finishProgrammeBlock(state,finished.id,'repeat',{today:date})
  expect(state.programmes.cycles.some((c:Fixture)=>c.status==='active')).toBe(true)
  expect(state.dbLoad['1760']).toEqual({mode:'each',_ts:1})
})
