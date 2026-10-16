import { effortOf } from './history.js'
import { targetForScale, targetLabel, programmeNote } from './programme-targets.js'
import { programmeInstructions } from './programme-instructions.js'
// Framework-free surface shared by agents and MCP. Dates/position use the UI projection.
import { programmesOf, programmePreAppWeeks, activate, shiftNotToday, skip } from './programme.js'
import { isProgrammeDate, projectCycle } from './programme-calendar.js'
import { validateProgrammeDefinition } from './programme-import.js'
import { CATALOGUE } from './exercises.js'
import { missingProgrammeTMs } from './programme-tm.js'

export function programmePosition(S, today, cycleId) {
  const p=programmesOf(S),c=cycleId?p.cycles.find(c=>c.id===cycleId):p.cycles.find(c=>['active','paused'].includes(c.status))
  if(!c)return {rev:S?._rev ?? 0,wid:S?._wid || null,unit:S?.unit || 'kg',active:null,next:null,endDate:null,adherence:null}
  const projection=projectCycle(c,S.workouts,today,S.queue),next=projection.next
  const done=projection.occurrences.filter(o=>o.status==='done').length,skipped=projection.occurrences.filter(o=>o.status==='skipped').length
  return {rev:S._rev ?? 0,wid:S._wid || null,unit:S.unit,cycleId:c.id,programmeId:c.programmeId,status:c.status,lap:c.lap || 1,
    currentWeek:next?.weekIndex ?? c.weekIndex,currentWeekId:next?.weekId || String(next?.weekIndex ?? c.weekIndex),
    next:next?{instanceId:next.instanceId,routineId:next.routineId,name:next.routineName,date:next.date,dayKey:next.dayKey,missingTMs:missingProgrammeTMs(S,S.routines.find(r=>r.id===next.routineId))}:null,
    endDate:projection.endDate,nextBlockStart:projection.nextBlockStart,projection:projection.occurrences,
    adherence:{done,skipped,planned:projection.occurrences.length,pending:projection.occurrences.length-done-skipped,weeks:projection.weeks.map(w=>({weekId:w.weekId,weekIndex:w.weekIndex,done:w.done,skipped:w.skipped,planned:w.planned,closed:w.closed}))}}
}
export function getProgramme(S, {cycleId,programmeId}={}) {
  const p=programmesOf(S)
  const cycle=cycleId?p.cycles.find(c=>c.id===cycleId):programmeId?null:p.cycles.find(c=>['active','paused'].includes(c.status))
  const definition=cycle?.snapshot || p.definitions.find(d=>d.id===programmeId) || null
  const kind=effortOf(S)
  // An additional read-only projection: the original definition/cycle remain available.
  const displayDefinition=definition && {...definition,weeks:definition.weeks.map(week=>({...targetForScale(week,kind),
    effort:targetForScale(week.rir != null ? {rir:week.rir} : week.rpe != null ? {rpe:week.rpe} : null,kind),
    effortLabel:targetLabel(week,(s,n)=>s.replace('{0}',n),kind),
    days:week.days.map(day=>({...day,sessions:day.sessions.map(session=>({...session,routineSnapshot:{...session.routineSnapshot,
      ex:session.routineSnapshot.ex.map(cfg=>({...cfg,target:targetForScale(cfg.target,kind),
        ...(cfg.setTargets ? {setTargets:cfg.setTargets.map(target=>targetForScale(target,kind))} : {}),
        instructions:programmeInstructions(S,cfg),note:programmeNote(S,cfg,{definition,programme:{cycleId:cycle?.id}})}))}}))}))}))}
  return {rev:S?._rev ?? 0,wid:S?._wid || null,unit:S?.unit || 'kg',effortScale:kind,cycle:cycle || null,definition,displayDefinition}
}

/** Mutates only a caller-owned draft. Transport handles auth and conditional persistence. */
export function applyProgrammeAgentAction(S, action, params, today) {
  if(!isProgrammeDate(today))throw new Error('A programme action needs a calendar date')
  if(action==='activate') {
    const d=programmesOf(S).definitions.find(d=>d.id===params.programmeId)
    if(!d)throw new Error('The program definition does not exist')
    validateProgrammeDefinition(d,[...CATALOGUE,...(S.customEx || [])])
    return activate(S,d,{today,weekIndex:params.weekIndex,perWeek:params.perWeek,tm:params.tm,existingRoutineIds:params.existingRoutineIds,preApp:{weeks:programmePreAppWeeks(d,params.weekIndex)}})
  }
  if(action==='shift') {
    if(!shiftNotToday(S,params.cycleId,today))throw new Error('Only an active program with pending sessions can shift')
    return true
  }
  if(action==='skip')return skip(S,params.cycleId,params.instanceId,{today,reason:params.reason || ''})
  throw new Error('Unknown program action')
}
