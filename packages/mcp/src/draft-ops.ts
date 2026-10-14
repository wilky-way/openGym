import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { isAssisted, type ExerciseIndex, EXIDX } from '@opengym/core/exercises'
import { error } from './http-client'
import { checkedJSON, type Draft } from './draft-store'
import { attachDraftRule, checkDraftProgression } from './progression-draft-ops'
import { redactToolCredentials } from './state'

const text = z.string().min(1).max(10000), key = z.string().min(1).max(10000)
const integer = z.number().int().min(1).max(100)
const target = z.object({ rir: z.number().min(0).max(10).optional(), rpe: z.number().min(0).max(10).optional(), pct: z.number().positive().optional() }).strict()
const reps = z.union([integer, z.literal('max')])
export const slotRef = z.object({ week: z.number().int().min(1).max(64), day: key, session: key, slot: key }).strict()
const sessionRef = slotRef.omit({ slot: true })
export const progression = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear'), instructions: text, parameters: z.object({ successSessions: integer, increment: z.number().positive(), unit: z.enum(['lb','kg']), failure: z.object({ afterSessions: integer, action: text }).strict().optional() }).strict(), provenance: text.optional() }).strict(),
  z.object({ kind: z.literal('double'), instructions: text, parameters: z.object({ repsLow: integer, repsHigh: integer, condition: text, increment: z.number().positive(), unit: z.enum(['lb','kg']), resetTo: z.number().nonnegative() }).strict().refine(p => p.repsLow <= p.repsHigh), provenance: text.optional() }).strict(),
  z.object({ kind: z.literal('reps-sum'), instructions: text, parameters: z.object({ threshold: integer, inclusive: z.boolean(), increment: z.number().positive(), unit: z.enum(['lb','kg']) }).strict(), provenance: text.optional() }).strict(),
  z.object({ kind: z.literal('percentage'), instructions: text, parameters: z.object({ reference: text, byWeek: z.record(z.array(z.number().positive()).min(1).max(100)) }).strict(), provenance: text.optional() }).strict(),
  ...(['authored','manual','none'] as const).map(kind => z.object({ kind: z.literal(kind), instructions: text, provenance: text.optional() }).strict()),
])
const source = z.object({ kind: text.optional(), private: z.boolean().optional(), ref: text.optional(), url: text.optional(), repo: text.optional(), sha: text.optional(), path: text.optional(), workbook: text.optional() }).strict()
export const metadata = z.object({ name: text.optional(), goal: text.optional(), level: text.optional(), daysPerWeek: z.number().int().min(1).max(7).optional(), equipment: z.array(text).max(100).optional(), licence: text.optional(), end: z.enum(['next','repeat','stop']).optional(), unit: z.enum(['lb','kg']).optional(), source: source.optional() }).strict()
const exercise = z.union([z.object({ id: key }).strict(), z.object({ open: z.literal(true), category: text, label: text.optional() }).strict()])
export const prescription = z.object({ sets: integer, reps: reps.optional(), repsMin: integer.optional(), pyramid: z.array(reps).min(1).max(10).optional(), setRepsMin: z.array(integer.nullable()).max(100).optional(), mode: z.literal('time').optional(), sec: z.number().positive().optional() }).strict().superRefine((p,c) => {
  if (p.mode === 'time' ? p.sec === undefined || p.reps !== undefined || p.pyramid !== undefined : p.reps === undefined && p.pyramid === undefined || p.sec !== undefined) c.addIssue({code:'custom',message:'Supply reps/pyramid or time and sec.'})
  if (p.repsMin !== undefined && (typeof p.reps !== 'number' || p.repsMin > p.reps)) c.addIssue({code:'custom',message:'Invalid repsMin.'})
  if (p.setRepsMin && (p.setRepsMin.length !== (p.pyramid?.length ?? p.sets) || p.setRepsMin.some((n,i) => n !== null && (typeof (p.pyramid?.[i] ?? p.reps) !== 'number' || n > Number(p.pyramid?.[i] ?? p.reps))))) c.addIssue({code:'custom',message:'Invalid setRepsMin.'})
})
const slot = z.object({ slotId: key.optional(), id: key.optional(), open: z.boolean().optional(), category: text.optional(), sets: integer, reps: reps.optional(), mode: z.literal('time').optional(), sec: z.number().positive().optional(), target: target.optional(), setTargets: z.array(target).max(100).optional() }).passthrough().superRefine((s,c)=>{
  const fields=['sets','reps','repsMin','pyramid','setRepsMin','mode','sec']
  if(fields.slice(1).some(k=>s[k]!==undefined)) {
    const result=prescription.safeParse(Object.fromEntries(fields.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])))
    if(!result.success)for(const issue of result.error.issues)c.addIssue(issue)
  }
  const numeric=(v:unknown)=>typeof v==='number' || typeof v==='string' && v.trim()!==''
  if(s.pyramidWeight!=null && (!Array.isArray(s.pyramidWeight) || s.pyramidWeight.some(v=>!numeric(v) || !Number.isFinite(Number(v)) || Number(v)<0)))
    c.addIssue({code:'custom',message:'Invalid per-set load seeds.'})
  if(s.tm!=null && (typeof s.tm!=='object' || !Array.isArray((s.tm as any).percentages) || (s.tm as any).percentages.some((v:unknown)=>!numeric(v) || !Number.isFinite(Number(v)) || Number(v)<=0)))
    c.addIssue({code:'custom',message:'Invalid per-set percentages.'})
})
const session = z.object({ sessionTemplateId: key.optional(), routineSnapshot: z.object({ ex: z.array(slot).max(100) }).passthrough() }).passthrough()
const day = z.object({ key, sessions: z.array(session).max(100) }).passthrough()
export const week = z.object({ index: z.number().int().min(1).max(64), days: z.array(day).max(100) }).passthrough()
export const endPlan = z.object({ kind: z.enum(['deload','test','repeat','next','stop']), instructions: text }).strict()
export const targets = z.object({ target: target.optional(), setTargets: z.array(target).max(100).nullable().optional() }).strict()
export const ruleId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
export const ruleJSON = z.record(z.unknown())
export const ruleAt = z.union([slotRef, z.array(slotRef).min(1).max(100)])
export const opSchema = z.union([
  z.object({ op:z.literal('setProgressionRules'), rules:z.array(ruleJSON).max(100) }).strict(),
  z.object({ op:z.literal('attachRule'), at:ruleAt, ruleId }).strict(),
  z.object({ op:z.literal('detachRule'), at:ruleAt, ruleId }).strict(),
  z.object({ op:z.literal('setMetadata'), patch:metadata }).strict(),
  z.object({ op:z.literal('addWeek'), week, after:z.number().int().min(1).max(64).optional() }).strict(),
  z.object({ op:z.literal('removeWeek'), week:z.number().int().min(1).max(64) }).strict(),
  z.object({ op:z.literal('setWeek'), week:z.number().int().min(1).max(64), patch:z.object({label:text.optional(),mode:z.enum(['train','deload','test','inserted']).optional(),rir:z.number().min(0).max(10).optional()}).strict() }).strict(),
  z.object({ op:z.literal('addDay'), week:z.number().int().min(1).max(64), day }).strict(),
  z.object({ op:z.literal('removeDay'), week:z.number().int().min(1).max(64), day:key }).strict(),
  z.object({ op:z.literal('addSession'), week:z.number().int().min(1).max(64), day:key, session }).strict(),
  z.object({ op:z.literal('removeSession'), week:z.number().int().min(1).max(64), day:key, session:key }).strict(),
  z.object({ op:z.literal('addSlot'), at:sessionRef, slot, index:z.number().int().min(0).max(100).optional() }).strict(),
  z.object({ op:z.literal('removeSlot'), at:slotRef }).strict(),
  z.object({ op:z.literal('moveSlot'), at:slotRef, index:z.number().int().min(0).max(99) }).strict(),
  z.object({ op:z.literal('setSlotExercise'), at:slotRef, exercise }).strict(),
  z.object({ op:z.literal('setPrescription'), at:slotRef, ...prescription.innerType().shape }).strict(),
  z.object({ op:z.literal('setTargets'), at:slotRef, ...targets.shape }).strict(),
  z.object({ op:z.literal('setProgression'), at:z.union([slotRef,z.array(slotRef).min(1).max(100)]), progression }).strict(),
  z.object({ op:z.literal('setGuidance'), at:slotRef, restSec:z.number().nonnegative().optional(), note:text.optional(), loadGuidance:text.optional(), instructions:text.optional() }).strict(),
  z.object({ op:z.literal('setEndPlan'), endPlan }).strict(),
  z.object({ op:z.literal('acknowledgeReview'), decision:z.object({code:text,location:z.object({path:z.string().optional(),week:z.number().optional(),day:text.optional(),session:z.union([text,z.number()]).optional(),slot:z.union([text,z.number()]).optional()}).strict(),decision:text,evidence:text}).strict() }).strict(),
])
export function parseInput<T>(schema:z.ZodType<T>, value:unknown): T {
  const result=schema.safeParse(value)
  if (!result.success) throw error('EINVAL', redactToolCredentials(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')).slice(0,2000))
  return result.data
}
const need = (v:any): any => { if (!v) throw error('NOT_FOUND','The addressed week, day, session or slot does not exist.'); return v }
const find = (a:any[], k:string, v:any): any => { const matches=a.filter(x => x[k]===v); if(matches.length>1) throw error('EINVAL','Ambiguous stable identity.'); return need(matches[0]) }
export const findWeek = (d:any, n:number): any => find(d.weeks,'index',n)
function locate(d:any, at:any): {w:any;day:any;s:any;e:any} {
  const w=findWeek(d,at.week), day=find(w.days,'key',at.day), s=find(day.sessions,'sessionTemplateId',at.session)
  return {w,day,s,e:at.slot===undefined?undefined:find(s.routineSnapshot.ex,'slotId',at.slot)}
}
export function identities(d:any): void {
  for (const w of d.weeks || []) for (const day of w.days || []) for (const s of day.sessions || []) {
    s.sessionTemplateId ||= 'session:' + randomUUID()
    for(const e of s.routineSnapshot?.ex || []) e.slotId ||= 'slot:' + randomUUID()
  }
}
export function budget(d:any): void {
  checkedJSON(d)
  if (!Array.isArray(d.weeks) || d.weeks.length>64) throw error('TOO_LARGE','At most 64 weeks may be expanded.')
  let sets=0
  for(const w of d.weeks) {
    if(!Array.isArray(w.days) || w.days.length>100) throw error('TOO_LARGE','Too many days.')
    for(const day of w.days) {
      if(!Array.isArray(day.sessions) || day.sessions.length>100) throw error('TOO_LARGE','Too many sessions.')
      for(const s of day.sessions) {
        const ex=s.routineSnapshot?.ex
        if(!Array.isArray(ex) || ex.length>100) throw error('TOO_LARGE','At most 100 slots per session.')
        for(const e of ex) { const n=e.pyramid?.length ?? e.sets; if(typeof n==='number' && Number.isFinite(n) && n>0) sets+=n; if(sets>10000) throw error('TOO_LARGE','At most 10,000 expanded working sets.') }
      }
    }
  }
}
function unique(d:any): void {
  const check=(items:any[],k:string) => {const ids=items.map(x=>x[k]);if(new Set(ids).size!==ids.length) throw error('EINVAL',`Duplicate ${k}.`)}
  check(d.weeks,'index')
  for(const w of d.weeks) {check(w.days,'key');for(const day of w.days) {check(day.sessions,'sessionTemplateId');for(const s of day.sessions) check(s.routineSnapshot.ex,'slotId')}}
}
const renumber=(d:any) => {d.weeks.forEach((w:any,i:number)=>w.index=i+1);d.lengthWeeks=d.weeks.length}
export function applyOps(draft:Draft, input:unknown): number {
  const ops=parseInput(z.array(opSchema).min(1).max(100),input)
  for(const op of ops as any[]) {
    const d=draft.definition
    switch(op.op) {
      case 'setProgressionRules': d.progressionRules=structuredClone(op.rules);checkDraftProgression(draft);break
      case 'attachRule':
      case 'detachRule': {
        const rule=find(d.progressionRules ?? [],'id',op.ruleId)
        for(const at of Array.isArray(op.at)?op.at:[op.at]) attachDraftRule(locate(d,at).e,rule,op.op==='attachRule')
        checkDraftProgression(draft);break
      }
      case 'setMetadata': {
        // Drafts are personal. Privacy can be raised but never cleared by an agent.
        if(op.patch.source?.private===false && d.source?.private===true) throw error('PRIVATE_DOWNGRADE','Private drafts cannot be made public.')
        const {source,...patch}=op.patch; Object.assign(d,patch);if(source)d.source={...d.source,...source};break
      }
      case 'addWeek': {if(d.weeks.length>=64)throw error('TOO_LARGE','At most 64 weeks.');const after=op.after===undefined?d.weeks.length: d.weeks.indexOf(findWeek(d,op.after))+1; d.weeks.splice(after,0,op.week);renumber(d);break}
      case 'removeWeek': d.weeks.splice(d.weeks.indexOf(findWeek(d,op.week)),1);renumber(d);break
      case 'setWeek': Object.assign(findWeek(d,op.week),op.patch);break
      case 'addDay': findWeek(d,op.week).days.push(op.day);break
      case 'removeDay': {const w=findWeek(d,op.week);w.days.splice(w.days.indexOf(find(w.days,'key',op.day)),1);break}
      case 'addSession': find(findWeek(d,op.week).days,'key',op.day).sessions.push(op.session);break
      case 'removeSession': {const day=find(findWeek(d,op.week).days,'key',op.day);day.sessions.splice(day.sessions.indexOf(find(day.sessions,'sessionTemplateId',op.session)),1);break}
      case 'addSlot': {const ex=locate(d,op.at).s.routineSnapshot.ex;if(op.index!==undefined && op.index>ex.length)throw error('EINVAL','Slot index is out of bounds.');ex.splice(op.index??ex.length,0,op.slot);break}
      case 'removeSlot': {const {s,e}=locate(d,op.at);s.routineSnapshot.ex.splice(s.routineSnapshot.ex.indexOf(e),1);break}
      case 'moveSlot': {const {s,e}=locate(d,op.at),ex=s.routineSnapshot.ex;if(op.index>=ex.length)throw error('EINVAL','Slot index is out of bounds.');ex.splice(ex.indexOf(e),1);ex.splice(op.index,0,e);break}
      case 'setSlotExercise': {const e=locate(d,op.at).e;for(const k of ['id','open','category','label'])delete e[k];Object.assign(e,op.exercise);break}
      case 'setPrescription': {
        const {op:_,at,...p}=op;parseInput(prescription,p);const e=locate(d,at).e
        for(const k of ['sets','reps','repsMin','pyramid','setRepsMin','mode','sec'])delete e[k];Object.assign(e,p);break
      }
      case 'setTargets': {const e=locate(d,op.at).e;if(op.setTargets && op.setTargets.length!==(e.pyramid?.length??e.sets))throw error('EINVAL','One target is required per working set.');if(Object.hasOwn(op,'target'))e.target=op.target;if(Object.hasOwn(op,'setTargets')) {if(op.setTargets===null)delete e.setTargets;else e.setTargets=op.setTargets}break}
      case 'setProgression': for(const at of Array.isArray(op.at)?op.at:[op.at])locate(d,at).e.progression=structuredClone(op.progression);break
      case 'setGuidance': {const {op:_,at,...fields}=op;Object.assign(locate(d,at).e,fields);break}
      case 'setEndPlan': d.endPlan=op.endPlan;break
      case 'acknowledgeReview': draft.decisions.push({...op.decision,at:draft.updatedAt});break
    }
  }
  // Validate the final batch so an operation may also repair its retained arrays.
  // Incomplete conformance is allowed; contradictory per-set structure is not.
  for(const w of draft.definition.weeks)for(const day of w.days)for(const s of day.sessions)for(const e of s.routineSnapshot.ex) {
    const count=e.pyramid?.length??e.sets
    for(const [values,expected] of [[e.pyramidWeight,e.pyramid?.length],[e.tm?.percentages,e.pyramid?.length],[e.setTargets,count],[e.setRepsMin,count]])
      if(values!=null && (!Array.isArray(values) || values.length!==expected))
        throw error('EINVAL','Prescription conflicts with per-set loads or targets; nothing was written.')
  }
  identities(draft.definition);unique(draft.definition);budget(draft.definition)
  return ops.length
}
export const repeatSchema=z.object({fromWeek:z.number().int().min(1).max(64),copies:z.number().int().min(1).max(63),keep:z.object({targets:z.boolean(),rules:z.boolean()}).strict()}).strict()
export function repeatWeek(draft:Draft,input:unknown): void {
  const {fromWeek,copies,keep}=parseInput(repeatSchema,input),d=draft.definition,src=findWeek(d,fromWeek)
  if(d.weeks.length+copies>64)throw error('TOO_LARGE','At most 64 weeks.')
  // Compute set budget before allocating the concrete copies.
  const count=(weeks:any[])=>weeks.reduce((n,w)=>n+w.days.reduce((n:number,day:any)=>n+day.sessions.reduce((n:number,s:any)=>n+s.routineSnapshot.ex.reduce((n:number,e:any)=>n+(e.pyramid?.length??e.sets),0),0),0),0)
  if(count(d.weeks)+copies*count([src])>10000)throw error('TOO_LARGE','At most 10,000 working sets.')
  if(Buffer.byteLength(checkedJSON(d))+copies*Buffer.byteLength(checkedJSON(src))>5*1024*1024)throw error('TOO_LARGE','Expanded copies exceed 5 MiB.')
  const weeks=Array.from({length:copies},()=>structuredClone(src))
  for(const w of weeks) {delete w.weekId;if(!keep.targets)delete w.rir;for(const day of w.days)for(const s of day.sessions)for(const e of s.routineSnapshot.ex) {if(!keep.targets){delete e.target;delete e.setTargets}if(!keep.rules){delete e.progression;delete e.ruleIds}}}
  d.weeks.splice(d.weeks.indexOf(src)+1,0,...weeks);renumber(d);unique(d);budget(d)
}
export const deloadSchema=z.object({afterWeek:z.number().int().min(1).max(64),policy:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('explicit'),week}).strict(),
  z.object({kind:z.literal('factor'),fromWeek:z.number().int().min(1).max(64),setsFactor:z.number().positive().max(1),loadFactor:z.number().positive().max(1),effort:target.refine(v=>v.rir!==undefined || v.rpe!==undefined,'Supply RIR or RPE explicitly.').refine(v=>v.rir===undefined || v.rpe===undefined || v.rir+v.rpe===10,'RIR and RPE must agree.')}).strict(),
]),confirm:z.boolean().optional()}).strict()
/** Inserting a concrete week preserves the meaning of every existing week reference. */
function remapWeeks(d:any, afterPosition:number): void {
  const mapping=new Map<number,number>(d.weeks.map((w:any,i:number)=>[w.index,i<afterPosition?i+1:i+2]))
  const shift=(n:any)=>mapping.get(n)??n
  const object=(v:any)=>v && typeof v==='object' && !Array.isArray(v)
  const table=(rows:Record<string,unknown>)=>{
    const entries=Object.entries(rows).map(([k,v])=>[mapping.has(Number(k))?String(mapping.get(Number(k))):k,v] as const)
    if(new Set(entries.map(([k])=>k)).size!==entries.length)
      throw error('EINVAL','Week reference remap would overwrite an existing prescription; nothing was written.')
    return Object.fromEntries(entries)
  }
  for(const r of Array.isArray(d.progressionRules)?d.progressionRules:[]) {
    if(!object(r))continue
    if(['percentage','rpe-load'].includes(r.kind) && object(r.weeks)) r.weeks=table(r.weeks)
    if(['scheduled-deload','volume-ramp'].includes(r.kind) && Array.isArray(r.weeks)) r.weeks=r.weeks.map(shift)
    if(object(r.source?.slot))r.source.slot.week=shift(r.source.slot.week)
    for(const ref of Array.isArray(r.scope?.slots)?r.scope.slots:[])if(object(ref))ref.week=shift(ref.week)
  }
  for(const w of d.weeks)for(const day of w.days)for(const s of day.sessions)for(const e of s.routineSnapshot.ex)
    if(e.progression?.kind==='percentage' && object(e.progression.parameters?.byWeek))
      e.progression.parameters.byWeek=table(e.progression.parameters.byWeek)
}
export function generateDeload(draft:Draft,input:unknown,index:ExerciseIndex=EXIDX): any {
  const {afterWeek,policy}=parseInput(deloadSchema,input),d=draft.definition
  if(d.weeks.length>=64)throw error('TOO_LARGE','At most 64 weeks.')
  findWeek(d,afterWeek)
  const w=structuredClone(policy.kind==='explicit'?policy.week:findWeek(d,policy.fromWeek))
  delete w.weekId;w.mode='deload';w.deload={authored:true,...(policy.kind==='factor'?{setsFactor:policy.setsFactor,loadFactor:policy.loadFactor}:{})}
  if(policy.kind==='factor') {
    delete w.rir
    for(const day of w.days)for(const s of day.sessions)for(const e of s.routineSnapshot.ex) {
      const before=e.pyramid?.length??e.sets,count=Math.max(1,Math.floor(before*policy.setsFactor))
      e.sets=count
      for(const k of ['pyramid','pyramidWeight','setRepsMin'])if(Array.isArray(e[k]))e[k]=e[k].slice(0,count)
      if(e.tm?.percentages) e.tm.percentages=e.tm.percentages.slice(0,count)
      e.target=structuredClone(policy.effort);delete e.setTargets
      // A concrete authored deload must not be overwritten by automatic rules.
      delete e.ruleIds;e.progression={kind:'none',instructions:'Perform this authored deload prescription without automatic progression.'}
      const factor=isAssisted(e.id,index)?2-policy.loadFactor:policy.loadFactor
      if(e.weight!==undefined && e.weight!==null) {if(!Number.isFinite(Number(e.weight)) || typeof e.weight==='string' && !e.weight.trim())throw error('EINVAL','A deload load seed must be numeric.');e.weight=Number(e.weight)*factor}
      if(e.pyramidWeight)e.pyramidWeight=e.pyramidWeight.map((n:number)=>n*factor)
      if(e.tm?.percentages)e.tm.percentages=e.tm.percentages.map((n:number)=>n*factor)
    }
  }
  const insertion=d.weeks.indexOf(findWeek(d,afterWeek))+1
  remapWeeks(d,insertion)
  d.weeks.splice(insertion,0,w);renumber(d);identities(d);unique(d);budget(d)
  return w
}
