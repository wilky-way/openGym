import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Tool } from './tool-types'
import { clientFor, invalidate, withToolRedaction } from './state'
import { error, type ApiClient, type Environment, type Fetcher } from './http-client'
import { createExerciseIndex, searchExercises, CATALOGUE, type Exercise } from '@opengym/core/exercises'
import { stampChange } from '@opengym/core/sync-merge'
import { isProgrammeDate } from '@opengym/core/programme-calendar'
import { convertWeight } from '@opengym/core/units'
import { parseInput } from './draft-ops'
import { buildPlannedEntry } from '@opengym/core/session-start'
import { modeOf } from '@opengym/core/history'
import { isWarmupRow } from '@opengym/core/workout-model'
import { pyramidRestFor } from '@opengym/core/pyramid'
import { restSecFor } from '@opengym/core/supersetFlow'

type Doc = Record<string, any>
type Options = {env?: Environment; fetcher?: Fetcher; now?: () => number}
const forbidden = new Set(['__proto__','prototype','constructor'])
const id = z.string().min(1).max(200).refine(s => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s) && !forbidden.has(s), 'Use an explicit safe id.')
const text = z.string().trim().min(1).max(500)
const note = z.string().max(10000)
const count = z.number().finite().int().min(1).max(100)
const load = z.number().finite().min(0).max(9999)
const date = z.string().refine(isProgrammeDate,'Use a valid YYYY-MM-DD date.')
const apply = {apply:z.boolean().default(false),preview_token:z.string().uuid().optional()}
const exercise = z.object({
  exercise_id:id, source_index:z.number().int().min(0).max(99).optional(), sets:count,
  reps:z.number().finite().int().min(1).max(9999), weight:load.optional(), unit:z.enum(['kg','lb']).optional(),
  rest_sec:z.number().finite().int().min(0).max(3600).optional(), superset:z.string().trim().min(1).max(100).nullable().optional(),
  notes:note.optional(), bodyweight:z.boolean().optional(), assisted:z.boolean().optional(),
}).strict()
const placement = z.discriminatedUnion('kind',[
  z.object({kind:z.literal('none')}).strict(),
  z.object({kind:z.literal('week'),days:z.array(z.enum(['0','1','2','3','4','5','6'])).min(1).max(7)}).strict(),
  z.object({kind:z.literal('date'),date}).strict(),
  z.object({kind:z.literal('queue'),index:z.number().int().min(0).max(999),starts_on:date.optional(),label:text.optional()}).strict(),
])
const createRoutine = z.object({...apply,name:text,exercises:z.array(exercise).min(1).max(100),placement}).strict()
const editRoutine = z.object({...apply,routine_id:id,name:text.optional(),exercises:z.array(exercise).min(1).max(100).optional(),placement:placement.optional()}).strict()
const deleteRoutine = z.object({...apply,routine_id:id}).strict()
const customFields = {
  name:text, muscles:z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  secondary_muscles:z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  equipment:z.string().trim().min(1).max(100),bodyweight:z.boolean(),assisted:z.boolean(),notes:note.optional(),
}
const createCustom = z.object({...apply,...customFields}).strict()
const editCustom = z.object({...apply,exercise_id:id,...Object.fromEntries(Object.entries(customFields).map(([k,s])=>[k,s.optional()]))}).strict()
const undo = z.object({...apply,undo_token:z.string().uuid()}).strict()
const search = z.object({query:z.string().trim().min(1).max(200),limit:z.number().int().min(1).max(100).default(30)}).strict()
// Reject prototype-key inputs before Zod can strip/canonicalise them. Stored unknown
// extension fields are never parsed through this closed authoring schema.
function safeInput(value: unknown, depth = 0): void {
  if (depth > 20) throw error('EINVAL','Input is too deeply nested.')
  if (!value || typeof value !== 'object') return
  if (!Array.isArray(value) && ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw error('EINVAL','Use plain JSON objects.')
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) throw error('EINVAL','Prototype keys are not allowed.')
    safeInput((value as Doc)[key],depth+1)
  }
}
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().filter(k=>v[k] !== undefined).map(k=>[k,canonical(v[k])])) : v
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const rows = (v: any) => Array.isArray(v) ? v : []
const find = (xs: Doc[], key: string, value: string) => {
  const matches = xs.filter(x=>x[key] === value)
  if (matches.length !== 1) throw error(matches.length ? 'AMBIGUOUS_ID':'NOT_FOUND','Expected exactly one target for this id.')
  return matches[0]!
}
function indexOf(state: Doc) {
  const seen = new Set<string>()
  for (const ex of rows(state.customEx)) {
    if (!ex || typeof ex !== 'object' || !id.safeParse(ex.id).success || seen.has(ex.id) || CATALOGUE.some(b=>b.id === ex.id)) throw error('INVALID_INDEX','Custom exercise ids must be unique safe ids.')
    seen.add(ex.id)
  }
  return createExerciseIndex(state.customEx || [])
}
const protectedCycles = (s: Doc) => rows(s.programmes?.cycles).filter(c=>['active','paused'].includes(c.status))
function protectedRoutine(s: Doc, r: Doc): boolean {
  return protectedCycles(s).some(c=>r.programme?.cycleId === c.id || rows(c.occurrences).some(o=>o.routineId === r.id))
}
function protectRoutine(s: Doc, r: Doc): void {
  if (protectedRoutine(s,r)) throw error('PROGRAMME_OWNED','Use programme controls for active or paused programme routines.')
}
function protectExercise(s: Doc, eid: string): void {
  if (rows(s.routines).some(r=>protectedRoutine(s,r) && rows(r.ex).some(e=>e.id === eid)) || protectedCycles(s).some(c=>
    rows(c.snapshot?.weeks).some(w=>rows(w.days).some(d=>rows(d.sessions).some(session=>rows(session.routineSnapshot?.ex).some(e=>e.id === eid))))))
    throw error('PROGRAMME_OWNED','This exercise is referenced by an active or paused programme.')
}
function checkedState(got: any): Doc {
  const s = got?.state
  if (!s || typeof s !== 'object' || Array.isArray(s) || !Number.isSafeInteger(got.rev) || got.rev < 0 || s._rev !== got.rev || typeof s._wid !== 'string' || !s._wid)
    throw error('NO_STATE','Sync a valid profile with a revision and write identity first.')
  for (const field of ['routines','workouts','customEx']) if (s[field] !== undefined && (!Array.isArray(s[field]) || s[field].some((x: any)=>!x || typeof x !== 'object' || Array.isArray(x)))) throw error('NO_STATE','Malformed profile arrays cannot be edited safely.')
  if (!Array.isArray(s.routines) || !Array.isArray(s.workouts)) throw error('NO_STATE','Missing routine/workout arrays.')
  if (!['kg','lb'].includes(s.unit)) throw error('INVALID_UNIT','The profile unit must be kg or lb.')
  for (const field of ['week','dayPlan','queue','rotation']) if (s[field] != null && (typeof s[field] !== 'object' || Array.isArray(s[field]))) throw error('NO_STATE','Malformed plan or queue cannot be edited safely.')
  if (s.queue != null && (!Array.isArray(s.queue.ids) || s.queue.ids.some((x: any)=>typeof x !== 'string'))) throw error('NO_STATE','Malformed queue ids.')
  indexOf(s)
  return s
}
function configureExercises(s: Doc, input: Doc[], old: Doc[], routine: Doc): Doc[] {
  const index = indexOf(s), used = new Set<number>()
  const effective: {at:number;weight?:number;rest?:number}[] = []
  const output = input.map((e,i)=> {
    if (!Object.hasOwn(index,e.exercise_id)) throw error('EXERCISE_NOT_FOUND','Choose an exact catalogue or custom exercise id from search_exercises.')
    let at = e.source_index
    if (at === undefined) {
      const matches = old.map((x,i)=>x.id === e.exercise_id ? i : -1).filter(i=>i >= 0)
      if (matches.length > 1) throw error('AMBIGUOUS_SLOT','Supply source_index when the old routine repeats an exercise.')
      at = matches[0]
    }
    if (at !== undefined && (!old[at] || used.has(at))) throw error('EINVAL','source_index must address a distinct existing slot.')
    if (at !== undefined) used.add(at)
    const prior = at !== undefined ? old[at] : undefined
    const weight = e.weight === undefined ? undefined : parseInput(load,convertWeight(e.weight,e.unit ?? s.unit,s.unit))
    const shapeChanged = !prior || prior.id !== e.exercise_id || prior.sets !== e.sets || prior.reps !== e.reps
    if (prior && (prior.sets !== e.sets || prior.reps !== e.reps || prior.id !== e.exercise_id || weight !== undefined && prior.weight !== weight) && ['pyramid','pyramidWeight','rowReps','setTargets','enginePrescription','communityPrescription','nativePrescription','generatedRules','tm','progression'].some(k=>prior[k] != null)) throw error('UNSUPPORTED_CONFIG','This slot has per-set or engine prescriptions. Edit it in the app.')
    const out: Doc = {...prior,id:e.exercise_id,sets:e.sets,reps:e.reps}
    if (prior && prior.id !== e.exercise_id) for (const field of ['bodyweight','assisted','weight','dbLoad','mode']) delete out[field]
    if (e.weight !== undefined) out.weight = weight
    else if (e.unit !== undefined) throw error('EINVAL','A unit requires a weight.')
    if (e.rest_sec !== undefined) out.restSec = e.rest_sec
    if (e.notes !== undefined) out.note = e.notes
    if (e.bodyweight !== undefined) out.bodyweight = e.bodyweight
    if (e.assisted !== undefined) out.assisted = e.assisted
    if (e.superset === null) {delete out.sg;delete out.sgName;delete out.sgRest}
    else if (e.superset !== undefined) out.sg = e.superset
    const semanticsChanged = shapeChanged || weight !== undefined || e.rest_sec !== undefined || ['bodyweight','assisted'].some(k=>e[k] !== undefined && e[k] !== prior?.[k]) || e.superset !== undefined && e.superset !== (prior?.sg ?? null)
    if (semanticsChanged && (modeOf(out,index) !== 'reps' || prior && modeOf(prior,index) !== 'reps')) throw error('UNSUPPORTED_CONFIG','Routine strength inputs support reps mode only. Edit time/cardio prescriptions in the app; unchanged metadata can still be edited here.')
    if (weight !== undefined || e.rest_sec !== undefined) effective.push({at:i,...(weight !== undefined ? {weight}:{}),...(e.rest_sec !== undefined ? {rest:e.rest_sec}:{})})
    if ((out.assisted ?? index[e.exercise_id]?.assisted) && (out.bodyweight ?? index[e.exercise_id]?.bodyweight)) throw error('EINVAL','Assisted exercise loads need bodyweight:false.')
    return out
  })
  const groups = new Map<unknown,number[]>()
  output.forEach((e,i)=>{if (e.sg != null) groups.set(e.sg,[...(groups.get(e.sg) ?? []),i])})
  for (const indexes of groups.values()) if (indexes.length < 2 || indexes.at(-1)! - indexes[0]! + 1 !== indexes.length) throw error('EINVAL','Supersets must contain at least two adjacent slots.')
  if (effective.length) {
    // Use Start's consumer, including real history/policy, profile defaults and custom
    // catalogue semantics. Persisting a scalar is not evidence that Start will use it.
    const context = {...routine,id:String(routine.id),ex:output}
    const entries: {target:Doc;sets:Doc[]}[] = output.map(cfg=>buildPlannedEntry(s,cfg,context,{noProg:routine.excludeFromProgression === true},index))
    for (const check of effective) {
      const entry = entries[check.at]!, work = entry.sets.map((row,i)=>({row,i})).filter(({row})=>!isWarmupRow(row))
      if (check.weight !== undefined && (!work.length || work.some(({row})=>typeof row.w !== 'number' || !Number.isFinite(row.w) || Math.abs(row.w-check.weight!) > 1e-9))) throw error('UNSUPPORTED_CONFIG','The requested flat load is not the effective Start load under this history/progression or prescription. Use the app prescription controls; progression has not been disabled.')
      const unit = output[check.at]!.sg != null ? groups.get(output[check.at]!.sg)! : [check.at]
      // Any member can end an uneven round. Its own per-set override can own
      // the round timer too, even if that member's scalar rest did not change.
      const roundRests = check.rest === undefined ? [] : unit.flatMap(idx=>entries[idx]!.sets.flatMap((row,i)=>isWarmupRow(row) ? [] : [restSecFor(entries,unit,s.restSec,{idx,sec:pyramidRestFor(entries[idx]!.target,entries[idx]!.sets,i)})]))
      if (check.rest !== undefined && (!roundRests.length || roundRests.some(sec=>sec !== check.rest))) throw error('UNSUPPORTED_CONFIG','The requested rest is not the effective work-set timer under per-set/superset rest ownership or profile defaults. Edit those prescriptions in the app.')
    }
  }
  return output
}
function detach(s: Doc, rid: string): void {
  for (const day of Object.keys(s.week || {})) {
    const ids = ([] as string[]).concat(s.week[day] ?? [])
    if (!ids.includes(rid)) continue
    const next = ids.filter(x=>x !== rid)
    if (next.length) s.week[day] = next; else delete s.week[day]
  }
  for (const day of Object.keys(s.dayPlan || {})) if (s.dayPlan[day] === rid) delete s.dayPlan[day]
  if (Array.isArray(s.queue?.ids) && s.queue.ids.includes(rid)) {
    if (s.queue.programmeCycleId || s.queue.rotationId) throw error('QUEUE_OWNED','A programme or rotation owns this queue.')
    s.queue.ids = s.queue.ids.filter((x: string)=>x !== rid)
    if (!s.queue.ids.length) s.queue = null
  }
  if (Array.isArray(s.rotation?.sequence) && s.rotation.sequence.includes(rid)) throw error('QUEUE_OWNED','Use the app to edit a rotation-owned routine placement.')
}
function place(s: Doc, rid: string, p: Doc, now: number): void {
  if (p.kind === 'none') return
  if (p.kind === 'week') {
    if (new Set(p.days).size !== p.days.length) throw error('EINVAL','Weekdays must be unique.')
    s.week ??= {}
    for (const day of p.days) { const ids = ([] as string[]).concat(s.week[day] ?? []); if (!ids.includes(rid)) s.week[day] = [...ids,rid] }
  } else if (p.kind === 'date') {
    s.dayPlan ??= {}
    if (s.dayPlan[p.date] && s.dayPlan[p.date] !== rid) throw error('PLACEMENT_OCCUPIED','That date already has a routine override.')
    s.dayPlan[p.date] = rid
  } else {
    if (s.queue?.programmeCycleId || s.queue?.rotationId || protectedCycles(s).some(c=>c.status === 'active')) throw error('QUEUE_OWNED','The current programme or rotation owns queue placement.')
    const ids = rows(s.queue?.ids)
    if (ids.includes(rid)) throw error('PLACEMENT_OCCUPIED','The routine is already in the queue.')
    if (p.index > ids.length) throw error('EINVAL','Queue index exceeds its length.')
    if (!s.queue && !p.starts_on) throw error('EINVAL','A new queue needs starts_on.')
    const next = [...ids];next.splice(p.index,0,rid)
    s.queue = {...(s.queue || {since:now,startsOn:p.starts_on,label:p.label || '',strict:true}),ids:next}
    if (p.starts_on !== undefined && s.queue.startsOn !== p.starts_on || p.label !== undefined && s.queue.label !== p.label) throw error('EINVAL','Existing queue metadata must be retained.')
  }
}
function prepare(action: string, before: Doc, p: Doc, now: number): {next: Doc; target: Doc} {
  const next = structuredClone(before)
  if (action.endsWith('routine')) {
    let routine: Doc
    if (action === 'create_routine') {
      if (p.exercises.some((e: Doc)=>e.source_index !== undefined)) throw error('EINVAL','A new routine has no source_index.')
      routine = {id:'routine-'+randomUUID(),name:p.name,ex:[]}
      routine.ex = configureExercises(next,p.exercises,[],routine)
      next.routines.push(routine)
    } else {
      routine = find(next.routines,'id',p.routine_id);protectRoutine(next,routine)
      if (action === 'delete_routine') {detach(next,routine.id);next.routines = next.routines.filter((r: Doc)=>r.id !== routine.id)}
      else {
        if (p.name === undefined && p.exercises === undefined && p.placement === undefined) throw error('EINVAL','Supply a routine change.')
        if (p.name !== undefined) routine.name = p.name
        if (p.exercises !== undefined) routine.ex = configureExercises(next,p.exercises,routine.ex,routine)
      }
    }
    if (p.placement) { if (action === 'edit_routine') detach(next,routine.id); place(next,routine.id,p.placement,now) }
    return {next,target:routine}
  }
  let ex: Doc
  if (action === 'create_custom_exercise') {
    ex = {id:'custom-'+randomUUID(),custom:true};(next.customEx ??= []).push(ex)
  } else {
    ex = find(next.customEx || [],'id',p.exercise_id);protectExercise(next,ex.id)
    if (CATALOGUE.some(e=>e.id === ex.id)) throw error('INVALID_INDEX','Custom exercise shadows a built-in id; repair it in the app.')
    if (!Object.keys(customFields).some(k=>p[k] !== undefined)) throw error('EINVAL','Supply a custom exercise change.')
  }
  if (p.name !== undefined) ex.n = p.name
  if (p.muscles !== undefined) {ex.primaries = p.muscles;ex.tg = p.muscles[0]}
  if (p.secondary_muscles !== undefined) {ex.secondaries = p.secondary_muscles;ex.sm = p.secondary_muscles}
  if (p.equipment !== undefined) ex.eq = p.equipment
  if (p.bodyweight !== undefined) ex.bodyweight = p.bodyweight
  if (p.assisted !== undefined) ex.assisted = p.assisted
  if (p.notes !== undefined) ex.desc = p.notes
  if (ex.bodyweight && ex.assisted) throw error('EINVAL','Assisted exercise loads need bodyweight:false.')
  return {next,target:ex}
}

// Opaque single-use previews and undo seals are scoped to this MCP process. Bound
// receipts retain full before state privately in memory, never in the server doc.
type Ticket = {kind:'preview'|'undo';scope:string;action:string;params:string;before:Doc;next?:Doc;rev:number;wid:string;fingerprint:string;expires:number;target:Doc}
export function createTemplateTools(options: Options = {}): Tool[] {
  const tickets = new Map<string,Ticket>(), now = options.now ?? Date.now
  const remember = (t: Ticket) => {
    for (const [key,value] of tickets) if (value.expires <= now()) tickets.delete(key)
    const token = randomUUID();tickets.set(token,t)
    while (tickets.size > 32 || Buffer.byteLength(JSON.stringify([...tickets.values()])) > 24*1024*1024) tickets.delete(tickets.keys().next().value!)
    if (!tickets.has(token)) throw error('PREVIEW_TOO_LARGE','The reversible preview exceeds this process memory budget.')
    return token
  }
  const tool = (name: string, description: string, schema: z.AnyZodObject): Tool => ({name,description,schema:schema.shape,withRedaction:run=>withToolRedaction(run,options),handler:raw=>withToolRedaction(async()=> {
    safeInput(raw)
    const p: Doc = parseInput(schema,raw), env = options.env ?? process.env, client = clientFor(env,options.fetcher)
    // Match the max-tool path: retain the actual client across first-call renewal,
    // including failures, without changing shared transports or cached state.
    try { return client.redactCredentials(await run(name,p,env,client)) }
    catch (failure) {
      if (!(failure instanceof Error)) throw client.redactCredentials(failure)
      const safe = client.redactCredentials({...failure,name:failure.name,message:failure.message})
      throw Object.assign(new Error(safe.message),safe)
    }
  },options)})
  const run = async (name:string,p:Doc,env:Environment,client:ApiClient): Promise<Doc> => {
    await client.checkProfile()
    const got = await client.request('GET','/api/data'), before = checkedState(got)
    if (name === 'search_exercises') {
      const index = indexOf(before), results = searchExercises(Object.values(index),p.query) as Exercise[]
      return {matches:results.slice(0,p.limit).map(e=>({exercise_id:e.id,name:e.n,muscles:e.primaries ?? [e.tg].filter(Boolean),secondary_muscles:e.secondaries ?? e.sm ?? [],equipment:e.eq,bodyweight:e.bodyweight,assisted:e.assisted,custom:e.custom === true})),total:results.length,rev:got.rev,wid:before._wid}
    }
    const scope = digest([client.base,client.profile,env.OPENGYM_TOKEN]), intent = {...p};delete intent.apply;delete intent.preview_token
    const params = digest(intent), gate = name.includes('custom_exercise') ? 'OPENGYM_ENABLE_EXERCISE_WRITES' : name === 'undo_template_change' ? undefined : 'OPENGYM_ENABLE_ROUTINE_WRITES'
    let built: {next:Doc;target:Doc}, ticket: Ticket | undefined
    if (name === 'undo_template_change') {
      ticket = tickets.get(p.undo_token)
      if (!ticket || ticket.kind !== 'undo' || ticket.expires <= now() || ticket.scope !== scope) throw error('UNDO_UNAVAILABLE','Undo seal expired or belongs to another MCP process/profile.')
      if (ticket.rev !== got.rev || ticket.wid !== before._wid || ticket.fingerprint !== digest(before)) throw error('UNDO_MODIFIED','Undo refuses a document that changed after apply.')
      const restore = structuredClone(ticket.before)
      // Keep server lineage and cumulative sync records; stampChange restores only
      // domain values with fresh causal stamps, never rewinds the document clock.
      for (const k of ['_rev','_wid','_wids','_ts','deleted','edited']) if (Object.hasOwn(before,k)) restore[k] = structuredClone(before[k])
      built = {next:restore,target:ticket.target}
    } else built = prepare(name,before,p,now())
    const activity = await client.request('GET','/api/data/activity')
    if (!['active','idle','unknown'].includes(activity?.status)) throw error('API_UNAVAILABLE','Server training guard is unavailable.')
    if (!p.apply) {
      const preview_token = remember({kind:'preview',scope,action:name,params,before:structuredClone(before),next:built.next,rev:got.rev,wid:before._wid,fingerprint:digest(before),expires:now()+15*60000,target:built.target})
      return {applied:false,preview_token,expected_rev:got.rev,expected_wid:before._wid,content_fingerprint:digest(before),training_status:activity.status,target:built.target,changes:changes(before,built.next),expires_in_seconds:900}
    }
    const preview = tickets.get(p.preview_token)
    if (!preview || preview.kind !== 'preview' || preview.expires <= now() || preview.scope !== scope || preview.action !== name || preview.params !== params) throw error('PREVIEW_REQUIRED','Apply requires the exact action and parameters from a fresh preview_token.')
    const requiredGate = gate ?? (ticket!.action.includes('custom_exercise') ? 'OPENGYM_ENABLE_EXERCISE_WRITES':'OPENGYM_ENABLE_ROUTINE_WRITES')
    if (env[requiredGate] !== '1') throw error('WRITES_DISABLED',`Enable ${requiredGate}=1 to apply this change.`)
    if (preview.rev !== got.rev || preview.wid !== before._wid || preview.fingerprint !== digest(before)) throw error('REV_CONFLICT','The preview document changed. Create a new preview; no action was rebased.')
    if (activity.status !== 'idle') throw error(activity.status === 'active' ? 'TRAINING_NOW':'TRAINING_UNKNOWN','The owning device must finish training and confirm idle first.')
    const next = structuredClone(preview.next!)
    next._ts = stampChange(before,next,now())
    // A failed/uncertain network write cannot be blindly repeated with this token.
    tickets.delete(p.preview_token)
    let ack: any
    try { ack = await client.request('PUT','/api/data',{state:next,baseRev:got.rev,baseWid:before._wid,stamped:true,requireIdle:true}) }
    finally {invalidate(client)}
    if (ack?.ok !== true || !Number.isSafeInteger(ack.rev) || ack.rev <= got.rev || typeof ack.wid !== 'string' || !ack.wid) throw error('API_UNAVAILABLE','Invalid acknowledgement; inspect the profile before creating another preview.')
    if (name === 'undo_template_change') tickets.delete(p.undo_token)
    let undo_token: string | undefined
    try {
      const fresh = await client.request('GET','/api/data'), saved = checkedState(fresh)
      if (saved._wid === ack.wid) undo_token = remember({kind:'undo',scope,action:ticket?.action ?? name,params:'',before:structuredClone(before),rev:fresh.rev,wid:saved._wid,fingerprint:digest(saved),expires:now()+60*60000,target:preview.target})
    } catch { /* The committed before/after record remains available if readback fails. */ }
    return {applied:true,applied_rev:ack.rev,applied_wid:ack.wid,target:preview.target,changes:changes(before,next),undo_token,undo_available:!!undo_token}
  }
  return [
    tool('search_exercises','Search catalogue and custom metadata; returns explicit exercise IDs. Search never auto-selects a match.',search),
    tool('create_routine','Preview a reps-mode workout template with ordered exercise IDs, sets/reps/rest/supersets and explicit placement. Ineffective load/rest inputs under history, progression or timer ownership are refused. apply:true requires its exact preview_token and OPENGYM_ENABLE_ROUTINE_WRITES=1.',createRoutine),
    tool('edit_routine','Preview edits to a routine, preserving unknown fields. Full ordered exercise list; source_index carries existing slot extensions. Active/paused programme routines are protected. Load/shape changes to per-set, engine or TM prescriptions and ineffective load/rest inputs are refused. Time/cardio slots permit unchanged prescriptions with metadata edits only.',editRoutine),
    tool('delete_routine','Preview routine deletion and removal of its plan/manual queue references. Programme and rotation ownership are protected; exact preview required to apply.',deleteRoutine),
    tool('create_custom_exercise','Preview a custom exercise with name, primary/secondary muscles, equipment, bodyweight/assisted flags and notes. apply:true requires preview_token and OPENGYM_ENABLE_EXERCISE_WRITES=1.',createCustom),
    tool('edit_custom_exercise','Preview a custom exercise edit by exact ID; retains unknown metadata and protects active/paused programme references. No built-in catalogue changes.',editCustom),
    tool('undo_template_change','Preview undo using the returned undo_token; refuses any document edit since apply. Apply needs this undo preview_token and the original write gate. Tokens live only in this MCP process.',undo),
  ]
}
function changes(before: Doc, after: Doc) {
  return Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!k.startsWith('_') && digest(before[k] ?? null) !== digest(after[k] ?? null)).map(k=>[k,{before:before[k] ?? null,after:after[k] ?? null}]))
}
