import { createExerciseIndex } from '@opengym/core/exercises'
import { evaluate, preview, convertWeightPrecise, authoredSlots, type EngineInput, type EngineResult } from '@opengym/core/progression-engine/index'
import { targetForScale } from '@opengym/core/programme-targets'
import { programmeSchemaIssues } from '@opengym/core/programme-model-schema'
import { validateProgression } from '@opengym/core/progression-validate'
import { isoOf } from '@opengym/core/format'
import { highestStamp } from '@opengym/core/server-stamp'
import { isProgrammeDate, projectCycle } from '@opengym/core/programme-calendar'
import { validateRequest } from '@opengym/contract/validators'
import type { ApplyResult, Why, SlotRef, ProgressionRule } from '@opengym/contract/domain/progression'
import type { GymApp } from './app'
import type { AuthService } from './auth'
import type { DataService } from './data'
import { ApiError, json } from './http'

type Doc = Record<string, unknown>
const record = (v: unknown): Doc => v && typeof v==='object' && !Array.isArray(v) ? v as Doc : {}
const records = (v: unknown): Doc[] => Array.isArray(v) ? v.map(record) : []
const opaque = (v: unknown): v is string => typeof v==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v)
function checkHistory(state: Doc): void {
  const issues: { path: string; message: string }[] = []
  for (const field of ['workouts', 'routines'] as const) {
    const values = state[field]
    if (values == null) continue
    const kind = field === 'workouts' ? 'workout' : 'routine'
    if (!Array.isArray(values)) {
      issues.push({ path: field, message: `Expected a ${kind} array.` })
      continue
    }
    values.forEach((value, i) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push({
        path: `${field}.${i}`, message: `Expected a ${kind} object; apply would discard this history entry.`,
      })
    })
  }
  if (issues.length) throw new ApiError(422,'malformed history',{code:'INVALID_RULES',issues})
}

export interface ProgressionServices {
  livePresence?: (uid: string) => Doc | null
  now?: () => number
  today?: () => string
  resolveDefinition?: (uid: string, id: string, versionId?: string) => unknown
}
function validLogs(logs: unknown[]): {logs:unknown[];warnings:EngineResult['warnings']} {
  const warnings: EngineResult['warnings']=[]
  return {logs:logs.filter((v,i)=> {
    if (isProgrammeDate(record(v).d)) return true
    warnings.push({code:'log.invalid-date',message:`Excluded log ${i}: expected a valid YYYY-MM-DD date.`});return false
  }),warnings}
}
function engineOk(result: EngineResult): void {
  if (result.error || result.slotErrors?.length) throw new ApiError(422,'invalid progression',{
    code:result.error?.code ?? result.slotErrors?.[0]?.code ?? 'UNSUPPORTED_REPS',issues:result.error && 'issues' in result.error ? result.error.issues : result.slotErrors ?? [{path:'load',message:result.error && 'message' in result.error ? result.error.message : 'Invalid load'}],warnings:result.warnings,
  })
}
const profile = (state: Doc): EngineInput['profile'] => ({...state,unit:state.unit==='kg' ? 'kg' : 'lb',effortScale:state.effort==='rpe' || state.effortScale==='rpe' ? 'rpe' : 'rir'})
function checkedWeeks(weeks: number[], definition: unknown): void {
  const authored = records(record(definition).weeks).map(w=>w.index)
  if (!weeks.length || weeks.length>100 || weeks.some(w=>w<1 || !authored.includes(w))) throw new ApiError(422,'invalid weeks',{code:'INVALID_RULES',issues:[{path:'weeks',message:'Choose authored week indexes'}]})
}
/** Mount once with the shared document writer and presence service. */
export function installProgression(app: GymApp, data: DataService, auth?: AuthService, services: ProgressionServices = {}): void {
  const now = services.now ?? Date.now
  const today = services.today ?? (()=>isoOf(new Date(now())))
  for (const action of ['validate','preview','apply'] as const) app.post(`/api/progression/${action}`,async c=> {
    if (!c.get('session')) throw new ApiError(401,'not signed in')
    const body = await c.get('body').readJson()
    const session = auth ? auth.sessionOf(c.req.raw) : c.get('session')
    if (!session) throw new ApiError(401,'not signed in')
    const uid=session.user.id
    const validation=validateRequest(`POST /api/progression/${action}`,body)
    if (!validation.ok) throw new ApiError(400,'invalid request',{issues:validation.issues})
    const {state: saved,rev}=data.get(uid), state=saved ?? {}, index=createExerciseIndex(records(state.customEx))
    if (action==='validate') {
      const structural=programmeSchemaIssues(body.definition)
      return json(200,structural.length ? {ok:false,issues:structural.map(i=>({code:'rule.range',path:i.path,fix:i.message}))} : validateProgression(body.definition,index))
    }
    const programmes=record(state.programmes), cycles=records(programmes.cycles)
    if (body.cycleId!==undefined && !opaque(body.cycleId)) throw new ApiError(400,'invalid cycle id')
    const cycle=cycles.find(x=>x.id===body.cycleId)
    if (body.cycleId && !cycle) throw new ApiError(404,'not found',{code:'NOT_FOUND'})
    const source=record(body.source)
    let definition: unknown=cycle?.snapshot
    if (action==='preview') {
      if (Object.hasOwn(source,'definition')) definition=source.definition
      else {
        if (!opaque(source.definitionId) || source.versionId!==undefined && !opaque(source.versionId)) throw new ApiError(400,'invalid definition id')
        definition=services.resolveDefinition?.(uid,source.definitionId,source.versionId as string | undefined) ?? records(programmes.definitions).find(d=>d.id===source.definitionId && (source.versionId===undefined || d.versionId===source.versionId)) ?? (record(cycle?.snapshot).id===source.definitionId && source.versionId===undefined ? cycle?.snapshot : undefined)
        if (!definition) throw new ApiError(404,'not found',{code:'NOT_FOUND'})
      }
    }
    const weeks=body.weeks as number[]
    checkedWeeks(weeks,definition)
    if (action==='apply') checkHistory(state)
    const logs=[...(Array.isArray(state.workouts) ? state.workouts : []),...(action==='preview' && Array.isArray(body.hypotheticalLogs) ? body.hypotheticalLogs : [])]
    const accepted=validLogs(logs)
    if (body.asOf!==undefined && !isProgrammeDate(body.asOf)) throw new ApiError(400,'invalid asOf')
    if (cycle && (!isProgrammeDate(cycle.week1StartDate) || !Number.isInteger(cycle.weekIndex))) throw new ApiError(422,'invalid cycle',{code:'INVALID_RULES',issues:[{path:'cycle',message:'Invalid cycle date or week'}]})
    if (action==='apply') {
      if (body.expectedRev!==rev || body.expectedWid!==(state._wid ?? null)) throw new ApiError(409,'conflict',{code:'REV_CONFLICT',rev,state})
      if (cycle?.status!=='active') throw new ApiError(409,'cycle not active',{code:'CYCLE_NOT_ACTIVE'})
      if (weeks.some(w=>w<Number(cycle.weekIndex))) throw new ApiError(422,'past week',{code:'PAST_WEEK'})
      if (services.livePresence?.(uid)) throw new ApiError(423,'training now',{code:'TRAINING_NOW'})
    }
    // Apply has no client cutoff. A declared preview cutoff can look backward,
    // but neither persisted nor hypothetical future logs can move today's load.
    const serverToday=today(), asOf=action==='preview' && typeof body.asOf==='string' && body.asOf<serverToday ? body.asOf : serverToday
    const result=(action==='preview' ? preview : evaluate)({definition,cycle:cycle as EngineInput['cycle'],logs:accepted.logs,profile:profile(state),weeks,asOf,now:serverToday}, {}, index)
    const warnings=new Map([...result.warnings,...accepted.warnings].map(w=>[JSON.stringify(w),w]))
    result.warnings=[...warnings].sort(([a],[b])=>a<b ? -1 : a>b ? 1 : 0).map(([,w])=>w)
    engineOk(result)
    if (action==='preview') return json(200,result)
    if (result.warnings.some(w=>w.code==='rounding.large-adjustment') && body.confirmInventoryAdjustment!==true) throw new ApiError(422,'inventory adjustment requires confirmation',{code:'INVALID_RULES',issues:result.warnings.filter(w=>w.code==='rounding.large-adjustment'),warnings:result.warnings})
    const changed: ApplyResult['changed']=[], stamp=Math.max(now(),highestStamp(state))+1
    const update=(entry:Doc,field:string,after:unknown,ref:SlotRef,why:Why[])=> {
      if (JSON.stringify(entry[field])===JSON.stringify(after)) return
      changed.push({ref,field,before:entry[field] ?? null,after,why});entry[field]=after;entry._ts=stamp;entry._f={...record(entry._f),[field]:stamp}
    }
    const projected=projectCycle(cycle as Parameters<typeof projectCycle>[0],accepted.logs.filter(log=>String(record(log).d)<=serverToday) as Parameters<typeof projectCycle>[1],serverToday,state.queue as Parameters<typeof projectCycle>[3]).occurrences
    const slots=authoredSlots(definition as Parameters<typeof authoredSlots>[0])
    for (const week of result.weeks) for (const prescribed of week.slots) {
      const occurrences=records(cycle!.occurrences).filter(o=>o.weekIndex===week.index && o.dayKey===prescribed.ref.day && o.sessionTemplateId===prescribed.ref.session)
      if (occurrences.length!==1) throw new ApiError(422,'invalid occurrence',{code:'INVALID_RULES',issues:[{ref:prescribed.ref,message:'Expected one cycle-owned occurrence'}]})
      const occurrence=occurrences[0]!
      const scheduled=projected.find(o=>o.instanceId===occurrence.instanceId)
      if (!scheduled?.date || scheduled.date<=serverToday || scheduled.status!=='pending' || occurrence.status==='done' || occurrence.status==='skipped') continue
      const routine=records(state.routines).find(r=>r.id===occurrence.routineId)
      if (!routine || record(routine.programme).cycleId!==cycle!.id) throw new ApiError(422,'invalid routine',{code:'INVALID_RULES',issues:[{ref:prescribed.ref,message:'Routine is not owned by this cycle'}]})
      const ex=records(routine.ex).filter(e=>e.slotId===prescribed.ref.slot)
      if (ex.length!==1) throw new ApiError(422,'invalid slot',{code:'INVALID_RULES',issues:[{ref:prescribed.ref,message:'Expected one materialized slot'}]})
      const entry=ex[0]!, sets=prescribed.sets, why=[...prescribed.why,...sets.flatMap(s=>s.why)]
      const values: Doc={enginePrescription:true,prog:'off',sets:sets.length,...(sets.length ? {reps:sets[0]!.reps==='amrap' ? 'max' : sets[0]!.reps} : {}),pyramid:sets.map(s=>s.reps==='amrap' ? 'max' : s.reps),weight:sets[0]?.load ?? null,pyramidWeight:sets.map(s=>s.load),setTargets:sets.map(s=>{const base={...record(entry.target)};if(s.target?.rir!==undefined || s.target?.rpe!==undefined){delete base.rir;delete base.rpe}return targetForScale({...base,...s.target,...(s.target?.pct!==undefined ? {pct:s.target.pct*100} : {})},profile(state).effortScale) ?? {}}),repsMin:null,setRepsMin:sets.map(s=>s.repsMin ?? null),prescriptionWhy:why}
      // A generated prescription must override authored percentage-TM materialization.
      if (entry.tm!==undefined) values.tm=null
      for (const [field,value] of Object.entries(values)) update(entry,field,value,prescribed.ref,why)
      if (changed.some(x=>x.ref===prescribed.ref)) {routine._ts=stamp;routine._f={...record(routine._f),ex:stamp}}
    }
    // Timeline seeds include rule-free lifts too. Only attached engine rules own
    // cache keys; leave other legacy values (and unavailable seeds) untouched.
    const rules=new Map<string,ProgressionRule>(records(record(definition).progressionRules).map(r=>[String(r.id),r as unknown as ProgressionRule]))
    const owned=new Set(slots.flatMap(({slot})=> {
      const attached=(slot.progression?.rules ?? []).map(id=>rules.get(id)).filter(r=>r!==undefined)
      return attached.length ? [...(slot.tm?.key ? [slot.tm.key] : []),...attached.flatMap(r=>r.kind==='percentage' ? [r.ref.lift] : r.kind==='rpe-load' || r.kind==='amrap-tm' ? [r.lift] : [])] : []
    }))
    const engineTm=Object.fromEntries(Object.entries(result.tm).flatMap(([lift,points])=>owned.has(lift) && points.length ? [[lift,convertWeightPrecise(points.at(-1)!.value,record(definition).unit==='kg' ? 'kg' : 'lb',profile(state).unit)]] : []))
    const tm={...record(cycle!.tm),...engineTm}
    if (slots.length && Object.keys(engineTm).length && JSON.stringify(record(cycle!.tm))!==JSON.stringify(tm)) update(cycle!,'tm',tm,slots[0]!.ref,[])
    if (body.dryRun===true || !changed.length) return json(200,{stateRev:rev,wid:state._wid ?? null,changed,warnings:result.warnings})
    try {
      data.compareAndWrite(uid,{state,baseRev:body.expectedRev,baseWid:body.expectedWid,stamped:true})
    } catch(error) {if(error instanceof ApiError && error.status===409) throw new ApiError(409,'conflict',{...error.extra,code:'REV_CONFLICT'});throw error}
    const committed=data.rev(uid)
    return json(200,{stateRev:committed.rev,wid:committed.wid,changed,warnings:result.warnings})
  })
}
