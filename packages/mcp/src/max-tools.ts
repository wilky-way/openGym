import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Tool } from './tool-types'
import { clientFor, invalidate, withToolRedaction } from './state'
import { error, type ApiClient, type Environment, type Fetcher } from './http-client'
import { parseInput } from './draft-ops'
import { createExerciseIndex } from '@opengym/core/exercises'
import { todayISO } from '@opengym/core/format'
import { isProgrammeDate } from '@opengym/core/programme-calendar'
import { setTrainingMax } from '@opengym/core/programme-max'
import { stampChange } from '@opengym/core/sync-merge'
import type { MaxAdjustment } from '../../contract/domain/state-doc'

type Doc = Record<string, any>
type Options = { env?: Environment; fetcher?: Fetcher; now?: () => number }
const date = z.string().refine(isProgrammeDate, 'Use a valid YYYY-MM-DD date.')
const controls = { apply:z.boolean().default(false), preview_token:z.string().uuid().optional() }
const maxSchema = z.object({...controls,cycle_id:z.string().min(1).max(200),lift:z.string().min(1).max(200),
  value:z.number().finite().positive(),unit:z.enum(['lb','kg']),today:date.optional(),reason:z.string().max(1000).default(''),
  expected_rev:z.number().int().nonnegative(),expected_wid:z.string().min(1)}).strict()
const undoSchema = z.object({...controls,undo_token:z.string().uuid(),today:date.optional()}).strict()
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().filter(k=>v[k] !== undefined).map(k=>[k,canonical(v[k])])) : v
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const payloadDigest = (doc: Doc) => digest(Object.fromEntries(Object.entries(doc).filter(([key])=>!['_rev','_wid','_wids'].includes(key))))
function checkedState(got: any): Doc {
  const s = got?.state
  if (!s || typeof s !== 'object' || Array.isArray(s) || !Number.isSafeInteger(got.rev) || got.rev < 0 || s._rev !== got.rev || typeof s._wid !== 'string' || !s._wid ||
    !Array.isArray(s.routines) || !Array.isArray(s.workouts) || !['kg','lb'].includes(s.unit) || !Array.isArray(s.programmes?.cycles))
    throw error('NO_STATE','Sync a valid profile with a revision, write identity and programme cycle first.')
  if (s.active != null) throw error('TRAINING_NOW','Finish the current workout before applying an agent max decision.')
  return s
}
function cycleOf(state: Doc, id: string): Doc {
  const cycles = state.programmes.cycles.filter((c: Doc)=>c?.id === id)
  if (cycles.length !== 1) throw error('CYCLE_NOT_FOUND','Expected exactly one programme cycle for this id.')
  return cycles[0]!
}
type Preview = {kind:'preview';scope:string;action:string;params:string;rev:number;wid:string;fingerprint:string;expires:number;next:Doc;event:MaxAdjustment;cycleId:string;undoToken?:string}
type Undo = {kind:'undo';scope:string;rev:number;wid:string;fingerprint:string;expires:number;event:MaxAdjustment;cycleId:string}
type Ticket = Preview | Undo
const matches = (t: Ticket, got: any, doc: Doc) => t.rev === got.rev && t.wid === doc._wid && t.fingerprint === digest(doc)
const audit = (event: MaxAdjustment, compensation = false) => ({outcome:compensation?'append-compensating-decision':'append-max-decision',event_id:event.id,
  current:event.previous,proposed:event.value,effective_on:event.effectiveOn,unit:event.unit,basis:event.basis ?? 'unspecified',lift:event.lift,reason:event.reason,
  original_seed_preserved:true,existing_history_preserved:true})

/** Process-local seals; max undo is a new audited decision, never history deletion. */
export function createMaxTools(options: Options = {}): Tool[] {
  const tickets = new Map<string,Ticket>(), inspections = new Map<string,{eventId:string;expires:number}>(), now = options.now ?? Date.now
  const prune = () => {
    for (const [key,t] of tickets) if (t.expires <= now()) tickets.delete(key)
    for (const [key,t] of inspections) if (t.expires <= now()) inspections.delete(key)
  }
  const remember = (ticket: Ticket) => {
    prune()
    const token = randomUUID();tickets.set(token,ticket)
    while (tickets.size > 32 || Buffer.byteLength(JSON.stringify([...tickets.values()])) > 24*1024*1024) tickets.delete(tickets.keys().next().value!)
    if (!tickets.has(token)) throw error('PREVIEW_TOO_LARGE','The max preview exceeds this process memory budget.')
    return token
  }
  const inspect = (scope:string,eventId:string) => {
    inspections.set(scope,{eventId,expires:now()+60*60000})
    while (inspections.size > 32) inspections.delete(inspections.keys().next().value!)
  }
  const tool = (name: string, description: string, schema: z.AnyZodObject): Tool => ({name,description,schema:schema.shape,
    withRedaction:run=>withToolRedaction(run,options),handler:raw=>withToolRedaction(async()=> {
      const p: Doc = parseInput(schema,raw), env = {...(options.env ?? process.env)}, client = clientFor(env,options.fetcher)
      // The per-client wrapper also redacts credentials renewed during this very call.
      try { return client.redactCredentials(await run(name,p,env,client)) }
      catch (failure) {
        if (!(failure instanceof Error)) throw client.redactCredentials(failure)
        const safe = client.redactCredentials({...failure,name:failure.name,message:failure.message})
        throw Object.assign(new Error(safe.message),safe)
      }
    },options)})
  const run = async (name:string,p:Doc,env:Environment,client:ApiClient): Promise<Doc> => {
    prune()
    await client.checkProfile()
    const got = await client.request('GET','/api/data'), before = checkedState(got)
    const scope = digest([client.base,client.profile,env.OPENGYM_TOKEN])
    const inspection = inspections.get(scope)
    if (inspection) {
      inspections.delete(scope)
      return {applied:false,inspection_only:true,outcome:'inspected-after-uncertain-write',rev:got.rev,wid:before._wid,
        content_fingerprint:digest(before),event_present:before.programmes.cycles.some((c:Doc)=>c.maxAdjustments?.some((e:Doc)=>e.id===inspection.eventId)),
        message:'Fresh state inspected. Review it and create a new preview; no prior token can be replayed.'}
    }
    const intent: Doc = {...p,today:p.today ?? todayISO()};delete intent.apply;delete intent.preview_token
    const params = digest(intent)
    let undo: Undo | undefined
    if (name === 'undo_training_max') {
      const t = tickets.get(p.undo_token)
      if (!t || t.kind !== 'undo' || t.expires <= now() || t.scope !== scope) throw error('UNDO_UNAVAILABLE','Undo seal expired or belongs to another process, server, profile or configured credential.')
      undo = t
      if (!matches(undo,got,before)) throw error('UNDO_MODIFIED','Undo refuses a document changed after the max decision.')
      const original = cycleOf(before,undo.cycleId).maxAdjustments?.filter((e:Doc)=>e.id===undo!.event.id)
      if (original?.length !== 1 || digest(original[0]) !== digest(undo.event)) throw error('UNDO_MODIFIED','The original audited max decision changed.')
      if (!(typeof undo.event.previous === 'number' && Number.isFinite(undo.event.previous) && undo.event.previous > 0))
        throw error('UNDO_UNAVAILABLE','No prior max existed; a compensating value cannot safely be inferred. The original history is retained.')
    } else if (got.rev !== p.expected_rev || before._wid !== p.expected_wid) throw error('REV_CONFLICT','The expected revision or write identity changed. Read the programme and create a new preview.')

    let activity: any
    try {activity = await client.request('GET','/api/data/activity')}
    catch {throw error('TRAINING_GUARD_UNAVAILABLE','The server training guard endpoint is unavailable; no max write is authorized.')}
    if (!['active','idle','unknown'].includes(activity?.status)) throw error('TRAINING_GUARD_UNAVAILABLE','The server returned an invalid training guard status.')
    if (!p.apply) {
      const next = structuredClone(before);delete next.active
      const cycleId = undo?.cycleId ?? p.cycle_id
      cycleOf(next,cycleId)
      const event = setTrainingMax(next as any,cycleId,{lift:undo?.event.lift ?? p.lift,value:undo ? undo.event.previous! : p.value,
        unit:undo?.event.unit ?? p.unit,today:intent.today,reason:undo ? `Compensating MCP decision for ${undo.event.id}.` : p.reason,now:now()},createExerciseIndex(next.customEx ?? []))
      const preview_token = remember({kind:'preview',scope,action:name,params,rev:got.rev,wid:before._wid,fingerprint:digest(before),expires:now()+15*60000,next,event,cycleId,...(undo?{undoToken:p.undo_token}:{})})
      return {applied:false,preview_token,expected_rev:got.rev,expected_wid:before._wid,content_fingerprint:digest(before),expires_in_seconds:900,
        training_status:activity.status,can_apply:activity.status==='idle',audit:audit(event,!!undo),
        undo_available_after_apply:typeof event.previous==='number' && event.previous>0,
        ...(event.previous===null?{undo_limitation:'No prior max exists. Undo cannot infer a safe value and will not erase history.'}:{})}
    }
    const t = tickets.get(p.preview_token)
    if (!t || t.kind !== 'preview' || t.expires <= now() || t.scope !== scope || t.action !== name || t.params !== params) throw error('PREVIEW_REQUIRED','Apply requires the exact action and inputs from a fresh preview token.')
    if (env.OPENGYM_ENABLE_PROGRAMME_WRITES !== '1') throw error('WRITES_DISABLED','Enable OPENGYM_ENABLE_PROGRAMME_WRITES=1 to apply the reviewed max decision.')
    // Consume before any write attempt, including refusals. Tokens never rebase or retry.
    tickets.delete(p.preview_token)
    if (!matches(t,got,before)) throw error('REV_CONFLICT','The preview document changed. Create a new preview; no decision was rebased.')
    if (activity.status !== 'idle') throw Object.assign(error('TRAINING_NOW','The owning device must finish training and confirm idle first.'),{guardStatus:activity.status})
    const next = structuredClone(t.next)
    next._ts = stampChange(before,next,now())
    if (t.undoToken) tickets.delete(t.undoToken)
    let ack: any
    try {
      ack = await client.request('PUT','/api/data',{state:next,baseRev:got.rev,baseWid:before._wid,stamped:true,requireIdle:true})
    } catch (failure) {
      const code = (failure as {code?:string}).code
      if (code==='REV_CONFLICT' || code==='TRAINING_NOW') throw failure
      return uncertain(client,scope,t)
    } finally {invalidate(client)}
    if (ack?.ok !== true || !Number.isSafeInteger(ack.rev) || ack.rev <= got.rev || typeof ack.wid !== 'string' || !ack.wid || ack.wid===before._wid)
      return uncertain(client,scope,t)
    try {
      const fresh = await client.request('GET','/api/data'), saved = checkedState(fresh)
      if (fresh.rev !== ack.rev || saved._wid !== ack.wid || payloadDigest(saved)!==payloadDigest(next)) return uncertain(client,scope,t)
      const events = cycleOf(saved,t.cycleId).maxAdjustments?.filter((e:Doc)=>e.id===t.event.id)
      if (events?.length !== 1 || digest(events[0])!==digest(t.event)) return uncertain(client,scope,t)
      const undo_token = typeof t.event.previous==='number' && t.event.previous>0 ? remember({kind:'undo',scope,rev:fresh.rev,wid:saved._wid,fingerprint:digest(saved),
        expires:now()+60*60000,event:structuredClone(t.event),cycleId:t.cycleId}) : undefined
      return {applied:true,applied_rev:ack.rev,applied_wid:ack.wid,audit:audit(t.event,name==='undo_training_max'),undo_token,undo_available:!!undo_token,
        ...(!undo_token?{undo_limitation:'No prior max existed; compensation cannot infer a safe value. History is retained.'}:{})}
    } catch {return uncertain(client,scope,t)}
  }
  const uncertain = async (client:ApiClient,scope:string,t:Preview): Promise<Doc> => {
    inspect(scope,t.event.id)
    let observed: Doc | undefined
    try {
      const got = await client.request('GET','/api/data'), saved = checkedState(got)
      observed = {rev:got.rev,wid:saved._wid,event_present:saved.programmes.cycles.some((c:Doc)=>c.maxAdjustments?.some((e:Doc)=>e.id===t.event.id))}
    } catch { /* An authenticated fresh read is required before another action. */ }
    return {applied:null,outcome:'uncertain',inspection_required:true,observed,undo_available:false,
      message:'No replay or undo token is available. The next call only inspects fresh state; review it before creating another preview.'}
  }
  return [
    tool('set_training_max','Preview an audited per-lift max decision by default. apply:true requires its exact expiring preview_token, programme-write opt-in and unchanged authenticated document; active/unknown training refuses. Original seed and history stay immutable.',maxSchema),
    tool('undo_training_max','Preview compensation for a sealed max decision. apply:true appends an audited restoring value; never deletes the original event. Refuses changed documents or an absent prior max. Requires the exact undo preview and programme-write opt-in.',undoSchema),
  ]
}
