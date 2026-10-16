import type { ProgrammeDefinition, RoutineExercise } from '../../contract/domain/state-doc'
import type { NativePrescription, NativeSetTarget } from '../../contract/domain/native-prescription'
import { isCardio, canonicalExId, EXIDX, type ExerciseIndex } from './exercises'
import { validateNativePrescription } from './native-prescription'
import { validateNativeIndexExercise } from './native-authority'
const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==='object' && !Array.isArray(v)
const record=(v:unknown)=>{if(!object(v))throw new Error('Invalid canonical prescription');return v}
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const nonempty=(v:unknown):v is string=>typeof v==='string' && !!v.trim()
const pending=(reason:string):never=>{throw new Error(`Native prescription pending: ${reason}`)}
export function isCanonicalPrescription(value:unknown):boolean {
  if(!object(value))return false
  return object(value.source) && 'workbook_sha256' in value.source || list(value.weeks).some(w=>object(w) && list(w.days).some(d=>object(d) && list(d.exercises).some(e=>object(e) && ('source_id' in e || list(e.sets).some(s=>object(s) && 'source_template_id' in s)))))
}
export interface CanonicalImportOptions {mappings?:Record<string,string>;customEx?:{id:string;n?:string;eq?:string;[key:string]:unknown}[]}
/** Strict preparation boundary; all unresolved semantics refuse executable admission. */
export function importCanonicalPrescription(input:unknown,{mappings={},customEx=[]}:CanonicalImportOptions={},index:ExerciseIndex=EXIDX):ProgrammeDefinition {
  const raw=record(input),source=record(raw.source)
  if(raw.schema!=='opengym-library/1' || !nonempty(raw.id) || !nonempty(raw.name) || !['lb','kg'].includes(String(raw.unit)) || !list(raw.weeks).length)throw new Error('Invalid canonical programme')
  if(Object.keys(record(raw.rules ?? {})).length || raw.instructions || raw.needsReview || raw.progressionRules)pending('source rules require independent translation')
  if(Object.keys(raw).some(k=>!['schema','id','name','unit','rules','source','weeks'].includes(k)))pending('unknown programme semantics')
  if(list(raw.weeks).length>64)throw new Error('Native programme exceeds week limit')
  let total=0
  const bases=new Set<string>()
  const weeks=list(raw.weeks).map((week,wi)=>{
    const w=record(week)
    if(Object.keys(w).some(k=>!['n','days'].includes(k)))pending('unknown week semantics')
    if(list(w.days).length>14)throw new Error('Native programme exceeds day limit')
    if(!list(w.days).length)pending('empty authored week')
    if(w.placeholder || w.repeat_of!=null)pending('authored week rotation or repetition')
    return {index:wi+1,sourceWeek:String(w.n),days:list(w.days).map((day,di)=>{
      const d=record(day)
      if(d.kind!=='lift')pending('unsupported day kind; ordinary lift translation required')
      const key=`lift:${d.n ?? di+1}`
      if(Object.keys(d).some(k=>!['n','kind','name','exercises'].includes(k)) || !list(d.exercises).length)pending('unknown or empty authored day')
      if(list(d.exercises).length>100)throw new Error('Native programme exceeds exercise limit')
      const ex=list(d.exercises).map((exercise,ei):RoutineExercise=>{
        const e=record(exercise),anchor=record(e.source)
        const exerciseFields=['id','opengym_id','name','equipment','slot','role','method','rest','notes','raw','source','source_id','sets','rules','parsed','rules_supported','order','rest_structure','superset','continuations']
        if(e.order!==undefined && e.order!==ei+1)pending('authored order disagrees with source array')
        if(e.role!==undefined || e.equipment!==undefined && !nonempty(e.equipment))pending('exercise role or equipment context requires review')
        if(e.continuations!==undefined && (!Array.isArray(e.continuations) || e.continuations.length))pending('continuation context requires independent translation')
        if(Object.keys(e).some(k=>!exerciseFields.includes(k)))pending('unknown exercise semantics')
        if(e.parsed!==true || e.rules_supported!==true || e.unparsed || e.source_gap)pending('unreviewed source or unresolved prescription')
        if(list(e.rules).length || e.notes || e.method || e.instructions || e.time_block || e.condition || e.progression)pending('unmodeled source instructions')
        const mapKey=`${e.name || e.id || ''}|${e.equipment || ''}`
        const explicit=mappings[mapKey] ?? e.id ?? e.opengym_id
        const id=typeof explicit==='string'?canonicalExId(explicit,index):undefined
        const mapped=id?validateNativeIndexExercise(id,index,customEx):undefined
        if(!id || !mapped || !index[id] || !mappings[mapKey] && String(mapped.n).trim().toLowerCase()!==String(e.name).trim().toLowerCase())pending('choose the exact catalogue or custom exercise')
        if(!mappings[mapKey] && e.equipment!==undefined && String(mapped!.eq).trim().toLowerCase()!==String(e.equipment).trim().toLowerCase())pending('choose the exact source equipment variant')
        if(isCardio(id,index))pending('non-repetition movement mode')
        if(e.rules!==undefined && (!Array.isArray(e.rules) || e.rules.length))pending('unmodeled source rules')
        if(!nonempty(e.name) || !nonempty(e.source_id) || !nonempty(anchor.prescription_cell) || !nonempty(anchor.sheet) || anchor.workbook_sha256!==source.workbook_sha256)throw new Error('Invalid canonical source identity')
        const variantKey=`source-variant:${encodeURIComponent(id!)}:${encodeURIComponent(e.name.trim().toLowerCase())}:${encodeURIComponent(String(e.equipment ?? '').trim().toLowerCase())}`
        if(list(e.sets).length>100)throw new Error('Native programme exceeds template limit')
        const rows:NativeSetTarget[]=[]
        for(const value of list(e.sets)) {
          const s=record(value)
          const allowed=['count','reps','reps_min','reps_max','amrap','kind','rpe','rir','pct','pct_basis','pct_role','effort_priority','rpe_max_exclusive','source_template_id']
          if(Object.keys(s).some(k=>!allowed.includes(k)) || !['work','amrap'].includes(String(s.kind)))pending('conditional, relative, timed, exact-total or unknown set semantics')
          if(typeof s.count!=='number' || !Number.isSafeInteger(s.count) || s.count<1 || s.count>100 || rows.length+s.count>100)pending('nonfixed or unsupported set count')
          if(s.amrap!==undefined && typeof s.amrap!=='boolean' || s.amrap===false && (s.kind==='amrap' || s.reps==='max' || s.reps==='amrap'))pending('conflicting AMRAP metadata')
          const amrap=s.amrap===true || s.kind==='amrap' || s.reps==='max' || s.reps==='amrap'
          if(typeof s.reps!=='number' && !Array.isArray(s.reps) && !['max','amrap'].includes(String(s.reps)) && !(s.reps===undefined && amrap && s.reps_min!==undefined))pending('unknown repetition expression')
          const repRange=Array.isArray(s.reps)?s.reps:undefined
          if(repRange && repRange.length!==2)throw new Error('Invalid canonical rep interval')
          if(s.reps_min!==undefined && (!amrap || typeof s.reps==='number') || s.reps_max!==undefined || amrap && Array.isArray(s.reps))pending('conflicting rep encodings')
          const floor=s.reps_min ?? (repRange?repRange[0]:typeof s.reps==='number'?s.reps:undefined)
          const ceiling=s.reps_max ?? (repRange?repRange[1]:s.reps)
          const target:NativeSetTarget={reps:{kind:amrap?'amrap':repRange?'range':'fixed',min:floor as number,...(!amrap?{max:ceiling as number}:{})},sourceTemplateId:s.source_template_id as string}
          if(s.rpe!=null && s.rir!=null || s.rpe_max_exclusive!=null && (s.rpe!=null || s.rir!=null))pending('conflicting effort targets')
          const scale=s.rpe!=null?'rpe':s.rir!=null?'rir':undefined
          if(scale) {
            const v=s[scale],bounds=Array.isArray(v)?v:[v,v]
            if(bounds.length!==2)throw new Error('Invalid canonical effort interval')
            target.effort={scale,min:bounds[0] as number,max:bounds[1] as number}
          } else if(s.rpe_max_exclusive!=null)target.effort={scale:'rpe',max:s.rpe_max_exclusive as number,maxExclusive:true}
          if(s.effort_priority!==undefined && (s.effort_priority!=='rpe' || !target.effort || target.effort.scale!=='rpe'))pending('unknown effort priority')
          if(s.effort_priority==='rpe' && s.pct!==undefined && s.pct_role!=='guide')pending('conflicting effort and percentage authority')
          if(s.pct===undefined && (s.pct_basis!==undefined || s.pct_role!==undefined))pending('percentage context without percentage')
          if(s.pct!==undefined) {
            const bounds=Array.isArray(s.pct)?s.pct:[s.pct,s.pct]
            if(bounds.length!==2)throw new Error('Invalid canonical percentage interval')
            const basis=String(s.pct_basis).toLowerCase(),role=s.pct_role
            if(!['1rm','tm','e1rm'].includes(basis) || !['prescribed','guide'].includes(String(role)))pending('unknown governing percentage context or role')
            if(role==='prescribed')bases.add(basis)
            target.percentage={min:bounds[0] as number,max:bounds[1] as number,basis:basis as '1rm'|'tm'|'e1rm',role:role as 'prescribed'|'guide',key:variantKey}
          }
          total+=Number(s.count)
          if(total>10000)throw new Error('Native programme exceeds row limit')
          for(let n=0;n<Number(s.count);n++)rows.push(structuredClone(target))
        }
        let restSeconds:number|undefined
        if(e.rest_structure!=null) {
          const rest=record(e.rest_structure)
          if(rest.seconds_min!==rest.seconds_max || typeof rest.seconds_min!=='number' || Object.keys(rest).some(k=>!['seconds_min','seconds_max','raw'].includes(k)))pending('rest range, applicability or guidance policy')
          if(Number(rest.seconds_min)<=0)pending('zero-rest execution policy')
          restSeconds=Number(rest.seconds_min)
        } else if(e.rest)pending('unstructured rest')
        const nativePrescription:NativePrescription={version:1,variantKey,source:{slotId:e.source_id,workbookSha256:source.workbook_sha256 as string,sheet:anchor.sheet,cell:anchor.prescription_cell},sets:rows,...(restSeconds!==undefined?{restSeconds}:{})}
        validateNativePrescription(nativePrescription)
        const cfg:RoutineExercise={id:id!,label:e.name,slotId:e.source_id,sets:rows.length,prog:'off',nativePrescription,...(restSeconds!==undefined?{restSec:restSeconds}:{})}
        if(e.superset!==undefined) {
          const pair=record(e.superset)
          if(Object.keys(pair).some(k=>!['group','position','rest_policy'].includes(k)))pending('unknown pair semantics')
          if(!nonempty(pair.group) || !Number.isSafeInteger(pair.position) || pair.rest_policy!=='after_pair')pending('unsupported pair order or rest')
          cfg.sg=String(pair.group);cfg.sourcePairPosition=pair.position
          if(restSeconds!==undefined)cfg.sgRest=restSeconds
        }
        return cfg
      })
      const groups=new Map<string|number,RoutineExercise[]>()
      ex.forEach(e=>{if(e.sg!=null)groups.set(e.sg,[...(groups.get(e.sg) ?? []),e])})
      for(const members of groups.values()) {
        if(members.length<2 || members.some((e,i)=>e.sourcePairPosition!==i+1 || ex.indexOf(e)!==ex.indexOf(members[0]!)+i || e.sgRest!==members[0]!.sgRest))pending('noncontiguous, incomplete or inconsistent authored pair')
      }
      return {key,ordinal:di+1,sessions:[{sessionTemplateId:key,routineSnapshot:{name:String(d.name || key),ex}}]}
    })}
  })
  if(bases.size>1)pending('mixed max bases require separate reviewed max namespaces')
  return {id:raw.id,name:raw.name,unit:raw.unit as 'lb'|'kg',weeks,source:{kind:'canonical-native-v1',private:source.private!==false,workbook_sha256:String(source.workbook_sha256)},rulesSupported:true,needsReview:[],...(bases.size?{maxBasis:[...bases][0] as '1rm'|'tm'|'e1rm'}:{})}
}
