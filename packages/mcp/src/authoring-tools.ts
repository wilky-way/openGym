import { z } from 'zod'
import { createHash } from 'node:crypto'
import { CATALOGUE, createExerciseIndex } from '@opengym/core/exercises'
import { programmeConformance } from '@opengym/core/programme-conformance'
import { importProgramme } from '@opengym/core/programme-import'
import { DraftStore, authoringDirectory, checkedJSON, type Draft } from './draft-store'
import { applyOps, budget, identities, parseInput, opSchema, slotRef, prescription, metadata, targets, progression, repeatSchema, repeatWeek, deloadSchema, generateDeload, ruleJSON, ruleAt } from './draft-ops'
import { withRemoteState, getState, currentClient, redactToolCredentials, withToolRedaction } from './state'
import { error, type Environment, type Fetcher } from './http-client'
import type { Tool } from './tool-types'

export const libraryId=z.string().regex(/^[A-Za-z0-9._-]{1,128}$/).refine(v=>!/^\.+$/.test(v),'Invalid library id.')
const key=z.string().min(1).max(128), rev=z.number().int().positive()
const draftKey={draft_id:key}, editKey={...draftKey,expected_rev:rev}
export function validation(definition:unknown,customEx: any[]=[],fullIssues=false): any {
  checkedJSON(definition)
  const result=redactToolCredentials(programmeConformance(definition,{catalogue:[...CATALOGUE,...customEx]},createExerciseIndex(customEx)))
  const levels=['Invalid','Valid','Complete','Ready']
  const byCode: Record<string,number>=Object.create(null),byLevel: Record<string,number>=Object.create(null)
  for(const issue of result.issues){byCode[issue.code]=(byCode[issue.code]??0)+1;byLevel[issue.requiredFor]=(byLevel[issue.requiredFor]??0)+1}
  if(fullIssues)return {...result,nextLevel:levels[levels.indexOf(result.level)+1]??null,counts:{byCode,byLevel}}
  const issues=[];let bytes=0
  for(const issue of result.issues.slice(0,200)){const safe={...issue,fix:issue.fix.slice(0,1000),location:Object.fromEntries(Object.entries(issue.location).map(([k,v])=>[k,typeof v==='string'?v.slice(0,1000):v]))};bytes+=Buffer.byteLength(JSON.stringify(safe));if(bytes>16*1024)break;issues.push(safe)}
  return {...result,issues,...(result.issues.length>issues.length?{issuesTruncated:true,totalIssues:result.issues.length}:{}),nextLevel:levels[levels.indexOf(result.level)+1]??null,counts:{byCode,byLevel}}
}
export function draftResult(draft:Draft,full=false,customEx:any[]=[]): any {
  const conformance=validation(draft.definition,draft.customEx??customEx)
  const {definition,customEx:_,...info}=draft
  const result=redactToolCredentials({...info,draft_id:draft.draftId,...conformance,...(full?{definition}:{summary:{name:definition.name,unit:definition.unit,private:definition.source?.private===true,weeks:(definition.weeks??[]).map((w:any)=>({index:w.index,label:w.label,mode:w.mode,days:(w.days??[]).map((d:any)=>({key:d.key,sessions:(d.sessions??[]).map((s:any)=>({session:s.sessionTemplateId,name:s.routineSnapshot?.name,slots:(s.routineSnapshot?.ex??[]).map((e:any)=>({slot:e.slotId,id:e.id,open:e.open,sets:e.sets,reps:e.reps,mode:e.mode}))}))}))}))}})})
  if(!full && Buffer.byteLength(JSON.stringify(result))>32*1024) return {draft_id:draft.draftId,rev:draft.rev,origin:draft.origin.kind,...conformance,summary:{name:redactToolCredentials(String(definition.name??'')).slice(0,512),unit:redactToolCredentials(String(definition.unit??'')).slice(0,16),private:definition.source?.private===true,weeks:definition.weeks?.length??0},truncated:true}
  return result
}
export function createAuthoringTools(options:{env?:Environment;fetcher?:Fetcher;now?:()=>string}={}): Tool[] {
  const env=()=>options.env??process.env
  const enabled=()=>{if(env().OPENGYM_ENABLE_PROGRAMME_AUTHORING!=='1')throw error('WRITES_DISABLED','Enable OPENGYM_ENABLE_PROGRAMME_AUTHORING=1 to edit drafts.')}
  const store=<T,>(run:(s:DraftStore)=>T):T=>{const s=new DraftStore(authoringDirectory(env()),options.now);try{return run(s)}finally{s.close()}}
  const previewView=(w:any,full=false):any=>{
    w=redactToolCredentials(w)
    if(full || Buffer.byteLength(JSON.stringify(w))<=16*1024)return w
    const counts={days:w.days.length,sessions:0,slots:0};for(const d of w.days)for(const s of d.sessions){counts.sessions++;counts.slots+=s.routineSnapshot.ex.length}
    return {index:w.index,mode:w.mode,deload:w.deload,counts,truncated:true}
  }
  const remote=<T,>(run:()=>T|Promise<T>)=>withRemoteState(run,options)
  const resolveProgramme=async(id:string):Promise<{definition:any;customEx:any[]}>=>remote(async()=>{
    const state=getState(),definition=state?.programmes?.definitions?.find((d:any)=>d.id===id)
    if(definition)return {definition,customEx:state.customEx??[]}
    const entry=await currentClient()!.request<any>('GET','/api/programmes/library/'+encodeURIComponent(id))
    return {definition:entry.definition??entry,customEx:state?.customEx??[]}
  })
  const tool=(name:string,description:string,shape:z.ZodRawShape,run:(p:any)=>any,write=false):Tool=>({name,description,schema:shape,withRedaction:run=>withToolRedaction(run,options),handler:(params:any={})=>withToolRedaction(()=>{if(write)enabled();return run(parseInput(z.object(shape).strict(),params))},options)})
  const edit=(p:any,ops:unknown)=>store(s=>draftResult(s.edit(p.draft_id,p.expected_rev,d=>applyOps(d,ops))))
  return [
    tool('validate_program','Validate supplied JSON, a local draft, or an HTTP library definition without writing data.',{definition:z.unknown().optional(),draft_id:key.optional(),programme_id:libraryId.optional()},async p=>{
      if(['definition','draft_id','programme_id'].filter(k=>Object.hasOwn(p,k)).length!==1)throw error('EINVAL','Supply exactly one definition, draft_id or programme_id.')
      if(p.draft_id)return store(s=>validation(s.get(p.draft_id).definition,s.get(p.draft_id).customEx))
      if(p.programme_id){const {definition,customEx}=await resolveProgramme(p.programme_id);return validation(definition,customEx)}
      return validation(p.definition)
    }),
    tool('create_program_draft','Create a personal local draft from scratch, a clone, or canonical/library JSON. No state writes.',{
      from:z.enum(['scratch','clone','import']),name:z.string().min(1).max(10000).optional(),unit:z.enum(['lb','kg']).optional(),definition:z.record(z.unknown()).optional(),programme_id:libraryId.optional(),draft_id:key.optional(),version_id:key.nullable().optional(),format:z.enum(['json','library']).optional(),content:z.union([z.string(),z.record(z.unknown())]).optional(),filename:z.string().max(10000).optional(),mappings:z.record(z.string()).optional(),prescriptions:z.record(z.unknown()).optional(),
    },async p=>{
      let definition:any,origin:Draft['origin'],targetDefinitionId:string|undefined, customEx:any[]=[]
      if(p.from==='scratch') {
        if(p.programme_id || p.draft_id || p.content!==undefined)throw error('EINVAL','Scratch takes name/unit or definition.')
        if(p.definition)definition=structuredClone(p.definition)
        else {if(!p.name || !p.unit)throw error('EINVAL','Scratch requires name and unit.');definition={id:'own-'+crypto.randomUUID(),name:p.name,unit:p.unit,weeks:[],source:{kind:'own',private:true}}}
        origin={kind:'scratch'}
      } else if(p.from==='clone') {
        if([p.definition,p.programme_id,p.draft_id].filter(v=>v!==undefined).length!==1)throw error('EINVAL','Clone needs one definition, programme_id or draft_id.')
        if(p.definition)definition=structuredClone(p.definition)
        else if(p.draft_id){const source=store(s=>s.get(p.draft_id));definition=source.definition;customEx=source.customEx??[]}
        else {const source=await resolveProgramme(p.programme_id);definition=source.definition;customEx=source.customEx}
        if(p.version_id!==undefined && (definition.authoring?.versionId??null)!==p.version_id)throw error('PARENT_CONFLICT','The requested source version changed.')
        definition=structuredClone(definition);targetDefinitionId=definition.id
        origin={kind:'clone',definitionId:definition.id,versionId:definition.authoring?.versionId??null}
        definition.id=definition.id.slice(0,86)+'-copy-'+crypto.randomUUID();delete definition.authoring
      } else {
        if(p.content===undefined || !p.format)throw error('EINVAL','Import requires explicit format and JSON content.')
        checkedJSON(p.content)
        const preview=importProgramme(p.content,{filename:p.filename,mappings:p.mappings,prescriptions:p.prescriptions},createExerciseIndex())
        if(!preview.definition)throw error('EINVAL','Import did not produce a definition.')
        definition=preview.definition
        origin={kind:'import',format:p.format,...(p.filename?{filename:p.filename}:{}),sha256:createHash('sha256').update(typeof p.content==='string'?p.content:JSON.stringify(p.content)).digest('hex')}
      }
      // All host drafts are the operator unpublished personal working copies.
      definition.source={...definition.source,private:true};identities(definition);budget(definition)
      return store(s=>draftResult(s.create({definition,origin,customEx,...(targetDefinitionId?{targetDefinitionId}:{})})))
    },true),
    tool('get_program_draft','Return a week summary and conformance; full JSON requires full:true.',{...draftKey,full:z.boolean().optional()},p=>store(s=>draftResult(s.get(p.draft_id),p.full))),
    tool('list_program_drafts','List personal draft summaries without full programme JSON.',{},()=>store(s=>({drafts:s.list().map(d=>({draft_id:d.draftId,rev:d.rev,name:redactToolCredentials(String(d.definition.name??'')).slice(0,512),level:validation(d.definition,d.customEx).level,private:d.definition.source?.private===true,updatedAt:d.updatedAt,origin:d.origin.kind}))}))),
    tool('delete_program_draft','Delete a draft only at the caller’s expected revision.',editKey,p=>store(s=>{s.delete(p.draft_id,p.expected_rev);return {deleted:true,draft_id:p.draft_id}}),true),
    tool('patch_program_draft','Atomically apply typed operations addressed by stable identities.',{...editKey,ops:z.array(opSchema).min(1).max(100)},p=>({...edit(p,p.ops),applied:p.ops.length}),true),
    tool('set_slot','Set an exercise and/or prescription at a stable slot reference.',{...editKey,at:slotRef,exercise:z.union([z.object({id:key}).strict(),z.object({open:z.literal(true),category:key,label:key.optional()}).strict()]).optional(),prescription:prescription.optional()},p=>{if(!p.exercise&&!p.prescription)throw error('EINVAL','Supply exercise or prescription.');return edit(p,[...(p.exercise?[{op:'setSlotExercise',at:p.at,exercise:p.exercise}]:[]),...(p.prescription?[{op:'setPrescription',at:p.at,...p.prescription}]:[])])},true),
    tool('set_slot_targets','Set explicit default/per-set effort targets.',{...editKey,at:slotRef,...targets.shape},p=>{const {draft_id,expected_rev,...op}=p;return edit(p,[{op:'setTargets',...op}])},true),
    tool('set_progression','Attach an authored progression to one or more stable slots.',{...editKey,at:z.union([slotRef,z.array(slotRef).min(1).max(100)]),progression},p=>edit(p,[{op:'setProgression',at:p.at,progression:p.progression}]),true),
    tool('set_progression_rule','Upsert one closed engine rule and optionally attach it to stable slots. Stall rules attach through onStall. Atomic, revision checked, validated; no state writes.',{...editKey,rule:ruleJSON,at:ruleAt.optional()},p=>store(s=>draftResult(s.edit(p.draft_id,p.expected_rev,d=>{
      const rules=d.definition.progressionRules ?? [],id=p.rule.id
      const replacement=rules.some((r:any)=>r.id===id) ? rules.map((r:any)=>r.id===id?p.rule:r) : [...rules,p.rule]
      applyOps(d,[{op:'setProgressionRules',rules:replacement},...(p.at===undefined?[]:[{op:'attachRule',at:p.at,ruleId:id}])])
    }))),true),
    tool('set_program_metadata','Edit metadata while retaining personal draft privacy.',{...editKey,patch:metadata},p=>edit(p,[{op:'setMetadata',patch:p.patch}]),true),
    tool('repeat_week','Expand explicit concrete copies with required target/rule retention choices.',{...editKey,...repeatSchema.shape},p=>store(s=>draftResult(s.edit(p.draft_id,p.expected_rev,d=>repeatWeek(d,{fromWeek:p.fromWeek,copies:p.copies,keep:p.keep})))),true),
    tool('generate_deload','Preview an authored deload; apply only with confirm:true. Factors and effort have no defaults.',{...editKey,...deloadSchema.shape,full:z.boolean().optional()},p=>store(s=>{
      const input={afterWeek:p.afterWeek,policy:p.policy,...(p.confirm===undefined?{}:{confirm:p.confirm})}
      if(p.confirm!==true){const d=s.expect(p.draft_id,p.expected_rev),preview=generateDeload(structuredClone(d),input,createExerciseIndex(d.customEx));return {...draftResult(d),preview:previewView(preview,p.full),applied:false}}
      let preview:any;const d=s.edit(p.draft_id,p.expected_rev,d=>{preview=generateDeload(d,input,createExerciseIndex(d.customEx))});return {...draftResult(d),preview:previewView(preview,p.full),applied:true}
    }),true),
  ]
}
