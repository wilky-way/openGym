import type { ProgrammeDefinition, ProgrammeWeekModel, ProgrammeDayModel, ProgrammeSessionModel, ProgrammeSlotModel } from '../../contract/domain/programme-model'
interface SourceRow {
  kind?: string; count?: number | number[]; pct?: number | number[]; rir?: number | number[]; rpe?: number | number[]
  amrap?: boolean; reps?: number | number[] | string; reps_max?: number
  [key: string]: unknown
}
interface SourceExercise {
  slot?: string | number; name?: string; sets?: SourceRow[]
  role?: string; category?: string; loadGuidance?: string
  [key: string]: unknown
}
interface SourceDay { n?: number | string; kind?: string; exercises?: SourceExercise[] }
interface SourceWeek { n?: number | string; days?: SourceDay[] }
export interface ProgrammeSourceRaw { weeks?: SourceWeek[]; [key: string]: unknown }
export interface ProgrammeRepairDecisions {
  goal?: string | null; level?: string | null; daysPerWeek?: number; lengthWeeks?: number
  equipment?: string[]; licence?: string | null; endPlan?: ProgrammeDefinition['endPlan']
  scheduleReviewed?: boolean; source?: ProgrammeDefinition['source']
  slots?: Record<string, unknown>
}
type CatalogueEntry = { id?: string; eq?: string; [key: string]: unknown }
import type { ExerciseIndex } from '@opengym/core/exercises'
import {CATALOGUE,EXIDX,canonicalExId} from '@opengym/core/exercises'
import {programmeRuleText} from '@opengym/core/programme-rule-text'
const text=(v: unknown): v is string=>typeof v==='string' && !!v.trim()
const list=<T=unknown,>(v: unknown): T[]=>Array.isArray(v)?v:[]

/** Repair is permissive: authored values and slot patches are not schema-validated.
 * Even the root can be a primitive; callers must narrow or validate this draft.
 */
export interface ProgrammeRepairResult { definition: unknown; changes: string[] }

/** Fill only facts derivable from explicit prescriptions or supplied decisions.
 * No default effort, guessed goal/licence, load prediction or script execution.
 */
export function improveProgrammeDefinition(def: unknown, {catalogue=CATALOGUE,decisions={},sourceRaw=null}: {catalogue?: CatalogueEntry[]; decisions?: ProgrammeRepairDecisions; sourceRaw?: ProgrammeSourceRaw | null}={}, index: ExerciseIndex=EXIDX): ProgrammeRepairResult {
  const d=structuredClone(def) as ProgrammeDefinition, changes: string[]=[]
  const put=(obj: Record<string, unknown>,key: string,value: unknown,path: string)=>{if(obj[key]==null && value!=null){obj[key]=structuredClone(value);changes.push(path)}}
  // Fill a missing length only; a stated value that disagrees is the author's and stays flagged by conformance.
  if(list<ProgrammeWeekModel>(d.weeks).length && d.lengthWeeks==null) {d.lengthWeeks=d.weeks.length;changes.push('/lengthWeeks')}
  const frequency=[...new Set(list<ProgrammeWeekModel>(d.weeks).map(w=>list<ProgrammeDayModel>(w.days).length))]
  if(frequency.length===1 && frequency[0]!>0)put(d,'daysPerWeek',frequency[0],'/daysPerWeek')
  const equipment=new Set<string>(), byId=new Map<string, CatalogueEntry>(catalogue.map(e=>[canonicalExId(e.id,index),e]))
  let allEquipment=true
  for(const w of list<ProgrammeWeekModel>(d.weeks))for(const day of list<ProgrammeDayModel>(w.days))for(const [si,s] of list<ProgrammeSessionModel>(day.sessions).entries())for(const [ei,e] of list<ProgrammeSlotModel>(s.routineSnapshot?.ex).entries()) {
    const path=`/weeks/${w.index}/days/${day.key}/sessions/${si+1}/slots/${e.slotId||ei+1}`
    // Recover explicit source fields even when another slot blocks full re-import.
    // Require retained source week/session/slot identity. Explicit slots must be
    // unique; source-N falls back to source position only when no explicit
    // candidate exists and the retained "Source exercise:" note matches exactly.
    const sourceWeeks=list<SourceWeek>(sourceRaw?.weeks).filter(x=>String(x.n)===w.sourceWeek), sourceWeek=sourceWeeks.length===1?sourceWeeks[0]:null
    const sourceDays=list<SourceDay>(sourceWeek?.days).filter(x=>`d${x.n}`===day.key && `${day.key}:${x.kind||'lift'}`===s.sessionTemplateId)
    const match=e.slotId?.match(/^day:\d+:slot:(.+):part:(\d+)$/)
    let authored: SourceExercise | undefined
    if(sourceDays.length===1 && match) {
      const candidates=list<SourceExercise>(sourceDays[0]!.exercises).filter(x=>String(x.slot)===match[1])
      if(candidates.length===1)authored=candidates[0]
      else if(candidates.length===0 && /^source-\d+$/.test(match[1]!)) {
        const candidate=sourceDays[0]!.exercises![Number(match[1]!.slice(7))-1]
        if(candidate && e.note?.startsWith(`Source exercise: ${candidate.name}\n`))authored=candidate
      }
    }
    if(authored) {
      for(const field of ['role','category','loadGuidance'])put(e,field,authored[field],`${path}/${field}`)
      const translated=programmeRuleText(authored,sourceRaw!)
      if(translated.progressionInstructions)put(e,'progression',{kind:'authored',instructions:translated.progressionInstructions,provenance:'source-rule-translation'},`${path}/progression`)
    }
    const sourceRows=list<SourceRow>(authored?.sets || e.sourcePrescription).filter(row=>row && typeof row==='object' && row.kind!=='warmup')
    const expanded=sourceRows.flatMap(row=>{
      const count=Number(Array.isArray(row.count)?Math.min(...row.count):row.count??1)
      if(!Number.isInteger(count)||count<1||count>100)return []
      return Array.from({length:count},()=>row)
    })
    const groups: SourceRow[][]=[]
    for(const row of expanded) {
      const group=groups.at(-1)
      if(group && (group[0]!.pct!=null)===(row.pct!=null))group.push(row)
      else groups.push([row])
    }
    const chunks=groups.flatMap(group=>Array.from({length:Math.ceil(group.length/10)},(_,i)=>group.slice(i*10,i*10+10)))
    const rows=expanded.length<=100 ? chunks[match?Number(match[2])-1:0]||[] : []
    const repsMatch=rows.length===(e.pyramid?.length||e.sets) && rows.every((row,i)=>{
      const reps=row.amrap || row.kind==='amrap' || row.reps==='max'?'max':Number(row.reps_max??(Array.isArray(row.reps)?Math.max(...row.reps):row.reps))
      return String(reps)===String(e.pyramid?.[i]??e.reps)
    })
    // Exact rep/row alignment protects edited saved prescriptions. Ranges of
    // effort are retained as source data; never choose one endpoint here.
    if(repsMatch) {
      rows.forEach((row,i)=>{
        const target={...e.target,...e.setTargets?.[i]}, recovered: {rir?: number; rpe?: number; pct?: number}={}
        if(target.rpe==null && target.rir==null)for(const key of ['rir','rpe'] as const)if(typeof row[key]==='number' && Number.isFinite(row[key]) && row[key]>=0 && row[key]<=10)recovered[key]=row[key]
        if(target.pct==null && e.tm?.percentages?.[i]==null && typeof row.pct==='number' && Number.isFinite(row.pct) && row.pct>0)recovered.pct=row.pct
        if(Object.keys(recovered).length) {
          if(!e.setTargets)e.setTargets=Array.from({length:rows.length},()=>({}))
          e.setTargets[i]={...e.setTargets[i],...recovered};changes.push(`${path}/setTargets/${i}`)
        }
      })
    }
    const cat=byId.get(canonicalExId(e.id,index))
    if(cat && text(cat.eq))equipment.add(cat.eq)
    else if(text(e.equipment))equipment.add(e.equipment)
    else allEquipment=false
    // Numeric week RIR already becomes the routine default at materialization.
    // Normalize it only when there is no conflicting slot default effort.
    if(w.rir!=null && e.target?.rir==null && e.target?.rpe==null) {
      put(e,'target',{},`${path}/target`)
      put(e.target!,'rir',w.rir,`${path}/target/rir`)
    }
  }
  if(allEquipment && equipment.size)put(d,'equipment',[...equipment].sort(),'/equipment')
  // Source privacy inference belongs to the importer; here a missing flag needs
  // a supplied decision. "Not recognized as paid" does not mean public.
  for(const field of ['goal','level','daysPerWeek','lengthWeeks','equipment','licence','endPlan','scheduleReviewed'] as const)if(decisions[field]!=null) {
    (d as Record<string, unknown>)[field]=structuredClone(decisions[field]);changes.push(`/${field} (decision)`)
  }
  if(decisions.source) {d.source={...d.source,...structuredClone(decisions.source)};changes.push('/source (decision)')}
  // Slot decisions use a JSON-pointer path with positional indexes, not labels.
  for(const [path,patch] of Object.entries(decisions.slots||{})) {
    const m=path.match(/^\/weeks\/(\d+)\/days\/(\d+)\/sessions\/(\d+)\/slots\/(\d+)$/)
    if(!m || !patch || typeof patch!=='object' || Array.isArray(patch))throw new Error('Invalid slot decision path or value')
    const [wi,di,si,ei]=m.slice(1).map(Number), slot=d.weeks?.[wi!]?.days?.[di!]?.sessions?.[si!]?.routineSnapshot?.ex?.[ei!]
    if(!slot)throw new Error('Slot decision does not match an existing slot')
    for(const [key,value] of Object.entries(patch)) {
      if(!['category','role','target','setTargets','progression','loadGuidance'].includes(key))throw new Error('Unsupported slot decision field')
      slot[key]=structuredClone(value)
    }
    changes.push(`${path} (decision)`)
  }
  return {definition:d,changes}
}
