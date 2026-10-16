import { isCanonicalPrescription, importCanonicalPrescription } from './canonical-prescription'
import type { ExerciseIndex } from '../../contract/core-api/exercises'
import { EXIDX } from '@opengym/core/exercises'
import type { ProgrammeState, ProgrammeDefinition, ProgrammeWeek, ProgrammeDay, RoutineExercise, SetTarget } from './programme-engine-types'
// Previews intentionally retain unresolved exercise ids as null until validation succeeds.
type KnownShape<T> = {[K in keyof T as string extends K ? never : number extends K ? never : K]: T[K]}
export type ProgrammePreviewSlot = Omit<KnownShape<RoutineExercise>, 'id'> & {id?: string | null; [key: string]: unknown}
type PreviewSession = Omit<KnownShape<import('../../contract/domain/state-doc').ProgrammeSession>, 'routineSnapshot'> & {
  routineSnapshot: Omit<KnownShape<import('../../contract/domain/state-doc').ProgrammeSession['routineSnapshot']>, 'ex'> & {ex: ProgrammePreviewSlot[]; [key: string]: unknown}
  [key: string]: unknown
}
type PreviewDay = Omit<KnownShape<ProgrammeDay>, 'sessions'> & {sessions: PreviewSession[]; [key: string]: unknown}
type PreviewWeek = Omit<KnownShape<ProgrammeWeek>, 'days'> & {days: PreviewDay[]; [key: string]: unknown}
export type ProgrammePreviewDefinition = Omit<KnownShape<ProgrammeDefinition>, 'weeks'> & {weeks: PreviewWeek[]; [key: string]: unknown}
interface SourceSet {
  count?: number | string | number[]; sets?: number; reps?: number | string | number[]; reps_max?: number; reps_min?: number
  pct?: number | number[]; rir?: number | number[]; rpe?: number | number[]; weight?: number | string
  kind?: string; from?: string; drop_pct?: number; until_rpe?: number; total_reps?: number; open_count?: boolean
  amrap?: boolean; target?: SetTarget
}
interface SourceExercise {
  id?: string; opengym_id?: string; name?: string; equipment?: string; slot?: string | number; label?: string
  open?: boolean; sets?: SourceSet[] | number; reps?: number; minutes?: number; notes?: string; role?: string
  target?: SetTarget & Record<string, unknown>; rest?: string; rules?: unknown[]; category?: string; loadGuidance?: string; progression?: unknown
  [key: string]: unknown
}
interface SourceDay { n?: number | string; kind?: string; name?: string; exercises?: SourceExercise[] }
interface SourceWeek { n?: number | string; placeholder?: boolean; repeat_of?: unknown; block_type?: string; days: SourceDay[] }
interface SourceProgramme {
  id: string; name: string; unit: 'kg' | 'lb'; weeks: SourceWeek[]; source?: ProgrammeDefinition['source']; instructions?: string
  weights_in?: string; rules?: {instructions?: unknown; notes?: string[]; progression_scripts?: string[]}; libraryRules?: {instructions?: unknown}
  end?: string; repeat?: unknown; [key: string]: unknown
}
export interface ProgrammeImportOptions {
  filename?: string; mappings?: Record<string, string>; prescriptions?: Record<string, SourceSet>; customEx?: {id: string; n?: string; eq?: string; [key: string]: unknown}[]; strictPrescriptions?: boolean
}
export interface ImportProblem {key: string; name?: string; equipment?: string}
export interface ProgrammeImportPreview {definition: ProgrammePreviewDefinition | null; unknown: ImportProblem[]; unprescribed: ImportProblem[]; warnings: string[]; skipped: boolean}
// Runtime file conversion only: no training library is bundled or fetched by the app.
import { programmeRuleText } from '@opengym/core/programme-rule-text'
import { validateSetTarget, effortRangeLabel } from '@opengym/core/programme-targets'
import { CATALOGUE, canonicalExId } from '@opengym/core/exercises'
const list = <T,>(v: T[] | unknown): T[] => Array.isArray(v) ? v : []
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const clone = <T,>(x: T): T => structuredClone(x)
const numeric = (n: unknown) => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n))
const positive = (n: unknown) => numeric(n) && Number(n) > 0
const load = (n: unknown) => { if (n == null) return 0; if (!numeric(n) || Number(n) < 0) throw new Error('Invalid program prescription'); return Number(n) }
const MAX_BYTES = 5 * 1024 * 1024
import { programmePreflight as preflight, validateProgrammeDefinition } from './programme-validate'
export { validateProgrammeDefinition } from './programme-validate'
function numbered<T extends {n?: number | string; kind?: string}>(items: T[], sessions = false) {
  if (items.every(x => x.n == null)) return items
  if (items.some(x => !positive(x.n) || !Number.isInteger(Number(x.n)))) throw new Error('Invalid program numbering')
  const seen = new Map<number, Set<string | undefined>>()
  for (const item of items) {
    const n = Number(item.n), kinds = seen.get(n) || new Set()
    if (kinds.size && (!sessions || !item.kind || kinds.has(item.kind))) throw new Error('Invalid program numbering')
    kinds.add(item.kind);seen.set(n,kinds)
  }
  return [...items].sort((a,b) => Number(a.n) - Number(b.n))
}
// Rules are displayed for the athlete to follow; they never calculate today's load.
export function ruleInstructions(e: {sets?: unknown}, kind = 'none') {
  const parts = []
  for (const row of list<SourceSet>(e.sets)) {
    const rules = []
    if (Array.isArray(row.count)) rules.push(`Perform ${Math.min(...row.count)}–${Math.max(...row.count)} sets`)
    if (Array.isArray(row.pct)) rules.push(`Target ${Math.min(...row.pct)}–${Math.max(...row.pct)}%`)
    for (const key of ['drop_pct','until_rpe','total_reps']) if ((row as Record<string, unknown>)[key] != null && (!numeric((row as Record<string, unknown>)[key]) || Number((row as Record<string, unknown>)[key]) <= 0 || key === 'until_rpe' && Number((row as Record<string, unknown>)[key]) > 10)) throw new Error('Invalid program rule')
    if (row.drop_pct != null) rules.push(`Drop ${row.drop_pct}%${/back.?off/i.test(row.kind || '') || row.from === 'top_set' ? " from today's top set" : ''}`)
    if (row.until_rpe != null) rules.push(kind === 'none' ? `repeat until @${row.until_rpe}` : `repeat until ${effortRangeLabel('rpe',Number(row.until_rpe),Number(row.until_rpe),kind)}`)
    if (row.total_reps != null) rules.push(`${row.total_reps} total reps`)
    if (row.open_count && row.until_rpe == null && row.total_reps == null) rules.push('repeat as needed')
    for (const key of ['rir','rpe'] as const) if (Array.isArray((row as Record<string, unknown>)[key])) rules.push(`${effortRangeLabel(key,(row[key] as number[])[0],(row[key] as number[])[1],kind)} (as authored; choose the per-set target).`)
    if (rules.length) parts.push(rules.join('; '))
  }
  return parts.join(' · ')
}
// Retain only rule values, never source prose (including in private imports).
function generatedRules(e: SourceExercise) {
  return list<SourceSet>(e.sets).map(row => ({
    ...(Array.isArray(row.count) ? {count:row.count.map(Number)} : {}),
    ...(Array.isArray(row.pct) ? {pct:row.pct.map(Number)} : {}),
    ...Object.fromEntries(['rir','rpe'].filter(key => Array.isArray((row as Record<string, unknown>)[key])).map(key => [key,((row as Record<string, unknown>)[key] as number[]).map(Number)])),
    ...Object.fromEntries(['drop_pct','until_rpe','total_reps'].filter(key => (row as Record<string, unknown>)[key] != null).map(key => [key,Number((row as Record<string, unknown>)[key])])),
    ...(/back.?off/i.test(row.kind || '') || row.from === 'top_set' ? {from:'top_set'} : {}),
    ...(row.open_count ? {open_count:true} : {}),
  })).filter(row => Object.keys(row).some(key => key !== 'from'))
}
const privateSource = (raw: {source?: ProgrammeDefinition['source']; id?: string}) => raw.source?.private === true || /^(?:bbm|sbs)-/i.test(raw.id || '')

export const hasPrivateProgrammes = (S: ProgrammeState) => list<ProgrammeDefinition>(S.programmes?.definitions).some(d=>d.source?.private) || list<import('./programme-engine-types').ProgrammeCycle>(S.programmes?.cycles).some(c=>c.snapshot?.source?.private)
export const importExerciseKey = (e: {name?: string; id?: string; equipment?: string}) => `${e.name || e.id || ''}|${e.equipment || ''}`

/** Preview is pure. Explicit mappings beat unique exact catalogue names; ambiguities stay unresolved. */
export function importProgramme(input: unknown, { filename='', mappings={}, prescriptions={}, customEx=[], strictPrescriptions=false }: ProgrammeImportOptions = {}, index: ExerciseIndex = EXIDX): ProgrammeImportPreview {
  if (filename === 'pub-_flagged.json' || (input as {id?: string} | null)?.id === 'pub-_flagged' || Array.isArray(input)) return {skipped:true,definition:null,unknown:[],unprescribed:[],warnings:[]}
  const canonicalSource=typeof input!=='string' && (input as ProgrammeDefinition)?.weeks?.[0]?.index==null && isCanonicalPrescription(input)
  if(canonicalSource) {
    if(Object.keys(prescriptions).length)throw new Error('Native prescription pending: legacy manual prescriptions cannot replace native source goals')
    importCanonicalPrescription(input,{mappings,customEx},index)
  }
  if (typeof input !== 'string' && !canonicalSource) {preflight(input,prescriptions);if((input as ProgrammeDefinition).weeks?.[0]?.index != null) validateProgrammeDefinition(input,[...CATALOGUE,...customEx],index)}
  const json = typeof input === 'string' ? input : JSON.stringify(input)
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_BYTES) throw new Error('Program exceeds the import size limit.')
  const parsed: unknown = JSON.parse(json)
  const raw = parsed as SourceProgramme
  const catalogue = [...CATALOGUE,...customEx]
  if (!raw || typeof raw !== 'object') throw new Error('Invalid program definition')
  if((raw as ProgrammeDefinition).weeks?.[0]?.index!=null || !isCanonicalPrescription(raw))preflight(raw,prescriptions)
  if ((parsed as ProgrammeDefinition).weeks?.[0]?.index != null) {
    const definition = validateProgrammeDefinition({...(parsed as ProgrammeDefinition),source:{...raw.source,private:privateSource(raw)}},catalogue,index)
    return {definition,unknown:[],unprescribed:[],warnings:[],skipped:false}
  }
  if (isCanonicalPrescription(raw)) {
    if(Object.keys(prescriptions).length)throw new Error('Native prescription pending: legacy manual prescriptions cannot replace native source goals')
    const native=importCanonicalPrescription(raw,{mappings,customEx},index)
    preflight(native)
    const definition=validateProgrammeDefinition(native,catalogue,index)
    return {definition,unknown:[],unprescribed:[],warnings:[],skipped:false}
  }
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !['lb','kg'].includes(raw.unit) || !list<SourceWeek>(raw.weeks).length) throw new Error('Invalid library program')
  const unknown = new Map<string, ImportProblem>(), unprescribed = new Map<string, ImportProblem>(), warnings = new Set<string>()
  const isPrivate = privateSource(raw)
  const needsReview=new Set<string>()
  if ((raw.rules?.instructions && typeof raw.rules.instructions === 'object') || (raw.libraryRules?.instructions && typeof raw.libraryRules.instructions === 'object')) needsReview.add('The source-document instruction index needs review; its authored guidance has not been translated.')
  const anyExerciseRules=list<SourceWeek>(raw.weeks).some(w=>list<SourceDay>(w.days).some(d=>list<SourceExercise>(d.exercises).some(e=>list(e.rules).length)))
  const globalRules=programmeRuleText({instructions:raw.instructions,notes:raw.rules?.notes,
    rules:anyExerciseRules?[]:list(raw.rules?.progression_scripts).map(summary=>({kind:'progress',summary}))},raw)
  globalRules.reasons.forEach(reason=>needsReview.add(reason))
  const resolve = (e: SourceExercise) => {
    const key = importExerciseKey(e), supplied = mappings[key] || e.id || e.opengym_id
    const explicit = mappings[key]
    const suppliedMatch = catalogue.find(x=>x.id===canonicalExId(supplied,index))
    if (suppliedMatch && (explicit || !e.equipment || norm(suppliedMatch.eq)===norm(e.equipment))) return suppliedMatch.id
    let matches = catalogue.filter(x=>norm(x.n)===norm(e.name))
    if (e.equipment) matches = matches.filter(x=>norm(x.eq)===norm(e.equipment))
    if (matches.length===1) return matches[0]!.id
    unknown.set(key,{key,name:e.name || supplied || '',equipment:e.equipment || ''})
    return null
  }
  let omitted = 0
  const weeks: PreviewWeek[] = numbered(raw.weeks.filter(w=>!w.placeholder && w.repeat_of == null)).map((w,wi): PreviewWeek=>({
    index:wi+1, sourceWeek:String(w.n), mode:/deload/i.test(w.block_type || '')?'deload':'train',
    ...(/deload/i.test(w.block_type || '')?{deload:{authored:true,setsFactor:1,loadFactor:1}}:{}),
    days:numbered(w.days.filter(day=>{if (/cardio|conditioning/i.test(day.kind || '')) {omitted++;return false} return true}),true).map((day,di): PreviewDay=>({
      key:`d${day.n ?? di+1}`,ordinal:Number(day.n ?? di+1),sessions:[{sessionTemplateId:`d${day.n ?? di+1}:${day.kind || 'lift'}`,routineSnapshot:{name:day.name || `D${di+1}`,prog:'off',ex:list<SourceExercise>(day.exercises).flatMap((e,ei): ProgrammePreviewSlot[]=>{
        if (/cardio|conditioning/i.test(e.role || '')) {omitted++;return []}
        const exerciseKey=importExerciseKey(e)
        const open = e.open === true || /^sbs-/i.test(raw.id || '') && !list<SourceSet>(e.sets).length && /accessory/i.test(e.name || e.role || '')
        const id = open ? null : resolve(e)
        if (!list<SourceSet>(e.sets).length && positive(e.minutes)) return [{id,slotId:`day:${di+1}:slot:${e.slot || ei+1}`,mode:'time',sec:Number(e.minutes)*60,sets:1,weight:0,prog:'off',note:String(e.notes || ''),...(e.role?{role:e.role}:{}),...(e.target?{target:clone(e.target)}:{})}]
        let setRows=list<SourceSet>(e.sets)
        if (open && !setRows.length) {
          const manual = prescriptions[exerciseKey]
          if (strictPrescriptions && !manual && !(typeof e.sets === 'number' && e.reps != null)) unprescribed.set(exerciseKey,{key:exerciseKey,name:e.name})
          setRows = [manual ? { ...manual, count:manual.count ?? manual.sets } : {count:typeof e.sets === 'number'?e.sets:3,reps:e.reps || [10,15]}]
        }
        if (!setRows.length) {
          const manual=prescriptions[exerciseKey]
          if(manual && positive(manual.sets) && Number.isInteger(Number(manual.sets)) && positive(manual.reps) && Number.isInteger(Number(manual.reps))) setRows=[{...manual,count:Number(manual.sets),reps:Number(manual.reps),weight:load(manual.weight)}]
          else {unprescribed.set(exerciseKey,{key:exerciseKey,name:e.name});setRows=[{count:1,reps:1}]}
          warnings.add('Some slots have no prescription. Enter sets and reps before saving.')
        }
        if (setRows.reduce((n,s)=>n+Number(Array.isArray(s.count)?Math.min(...s.count):s.count ?? 1),0)>100) throw new Error('Invalid program prescription')
        const translated=programmeRuleText(e,raw)
        translated.reasons.forEach(reason=>needsReview.add(reason))
        const rows = setRows.filter(s=>s.kind!=='warmup').flatMap(s=>{
          const count=Number(Array.isArray(s.count)?Math.min(...s.count):s.count ?? 1)
          if (!Number.isInteger(count) || count<1 || count>100) throw new Error('Invalid program prescription')
          const range=Array.isArray(s.reps)?s.reps:null
          if (range && (!range.length || range.length > 100 || range.some(r=>!positive(r) || !Number.isInteger(Number(r))))) throw new Error('Invalid program prescription')
          if (Array.isArray(s.pct) && (!s.pct.length || s.pct.length > 100 || s.pct.some(p=>!positive(p)))) throw new Error('Invalid percentage prescription')
          const maxReps=s.reps==='max'
          for (const key of ['rir','rpe'] as const) if (Array.isArray(s[key])) {
            if (s[key].length !== 2 || s[key].some(n=>typeof n !== 'number' || !Number.isFinite(n) || n<(key === 'rpe' ? 1 : 0) || n>10) || s[key][0]!>s[key][1]!) throw new Error('Invalid set target')
            needsReview.add(`An authored ${key.toUpperCase()} range needs a per-set target decision; the range is retained in instructions.`)
          }
          const reps=maxReps?'max':Number(s.reps_max ?? (range?Math.max(...range):s.reps))
          if (reps!=='max' && (!positive(reps) || !Number.isInteger(reps))) throw new Error('Invalid program prescription')
          return Array.from({length:count},()=>({reps:(maxReps || s.amrap || s.kind==='amrap'?'max':reps) as number | 'max',weight:load(s.weight),pct:Array.isArray(s.pct)?Math.min(...s.pct):s.pct,target:{...s.target,...(s.rir != null && !Array.isArray(s.rir)?{rir:Number(s.rir)}:{}),...(s.rpe != null && !Array.isArray(s.rpe)?{rpe:Number(s.rpe)}:{}),...(s.pct != null?{pct:Number(Array.isArray(s.pct)?Math.min(...s.pct):s.pct)}:{})},repsMin:s.reps_min ?? (range?Math.min(...range):null)}))
        })
        if (!rows.length) throw new Error('Invalid program prescription')
        if (rows.some(r=>r.pct!=null && !positive(r.pct))) throw new Error('Invalid percentage prescription')
        const configs: ProgrammePreviewSlot[]=[], groups: typeof rows[]=[]
        for(const row of rows) {const last=groups.at(-1);if(last && (last[0]!.pct!=null)===(row.pct!=null))last.push(row);else groups.push([row])}
        for(const group of groups) for(let start=0;start<group.length;start+=10) {
          const chunk=group.slice(start,start+10), cfg: ProgrammePreviewSlot={...(open ? {open:true,label:e.label || e.name || ''} : {id}),slotId:`day:${di+1}:slot:${e.slot || ei+1}:part:${configs.length+1}`,sets:chunk.length,reps:chunk[0]!.reps,prog:'off',pyramid:chunk.map(r=>r.reps),pyramidWeight:chunk.map(r=>r.weight),weight:chunk[0]!.weight,...(configs.length===0 && !isPrivate && e.sets != null ? {sourcePrescription:clone(e.sets)} : {}),...(unprescribed.has(exerciseKey)?{importNeedsPrescription:true}:{})}
          if (chunk.some(r=>r.repsMin!=null)) {
            cfg.setRepsMin=chunk.map(r=>r.repsMin ?? null)
            if (!cfg.tm && chunk.every(r=>r.pct==null && r.reps===chunk[0]!.reps && r.repsMin===chunk[0]!.repsMin && r.weight===chunk[0]!.weight)) {
              cfg.repsMin=Number(chunk[0]!.repsMin)
              delete cfg.pyramid;delete cfg.pyramidWeight
            }
          }
          if (e.target) cfg.target=clone(e.target)
          for (const field of ['role','category','loadGuidance','progression']) if (e[field] != null) cfg[field]=clone(e[field])
          if (!cfg.progression && translated.progressionInstructions) cfg.progression={kind:'authored',instructions:translated.progressionInstructions,provenance:'source-rule-translation'}
          cfg.setTargets=chunk.map(r=>r.target)
          cfg.setTargets.forEach(validateSetTarget)
          if (chunk.every(r=>r.pct!=null)) cfg.tm={key:id || importExerciseKey(e),percentages:chunk.map(r=>Number(r.pct)),reference:raw.weights_in || 'as-authored'}
          if (e.rest && /^\d+(?:s)?$/.test(e.rest)) cfg.restSec=parseInt(e.rest,10)
          if (e.notes) cfg.note=String(e.notes)
          const rules=generatedRules(e)
          if (rules.length) {
            cfg.generatedRules=rules
            cfg.authoredInstructions=translated.instructions
          }
          const instructions=[ruleInstructions(e),translated.instructions].filter(Boolean).join('\n\n')
          if (instructions) cfg.instructions=instructions
          configs.push(cfg)
        }
        return configs
      })}}],
    })).filter(day=>day.sessions[0]!.routineSnapshot.ex.length).reduce<PreviewDay[]>((days,day)=>{const existing=days.find(d=>d.key===day.key);if(existing)existing.sessions.push(...day.sessions);else days.push(day);return days},[]),
  })).filter(w=>w.days.length)
  if (!weeks.length || weeks.length>64) throw new Error('A program needs between one and 64 explicit weeks.')
  if (weeks.some(w=>w.days.some(day=>day.sessions.length>1))) {warnings.add('Multiple sessions on one source day are queued separately. Review the schedule before loading.')}
  if (omitted) warnings.add('Cardio and conditioning were omitted; strength sessions are kept.')
  const definition: ProgrammePreviewDefinition={id:raw.id,name:raw.name,unit:raw.unit,weeks,source:{...raw.source,kind:'library',library:true,private:isPrivate},rulesSupported:!needsReview.size && !unknown.size && !unprescribed.size,needsReview:[...needsReview,...(unknown.size?['Resolve unknown exercises before saving the program.']:[]),...(unprescribed.size?['Enter sets and reps for unprescribed slots before saving.']:[])],...(globalRules.instructions?{instructions:globalRules.instructions}:{}),end:raw.end || 'next',...(raw.repeat?{repeat:clone(raw.repeat)}:{}),importWarnings:[...warnings]}
  for (const field of ['goal','level','daysPerWeek','lengthWeeks','equipment','licence','endPlan','scheduleReviewed']) if (raw[field] != null) definition[field]=clone(raw[field])
  if (!unknown.size && !unprescribed.size) validateProgrammeDefinition(definition,catalogue,index)
  return {definition,unknown:[...unknown.values()],unprescribed:[...unprescribed.values()],warnings:[...warnings],skipped:false}
}

/** Confirm saves a definition only. Activate/adopt remains a separate UI step. */
export function saveImportedProgramme(S: ProgrammeState, preview: Pick<ProgrammeImportPreview, 'definition' | 'unknown'> & Partial<Pick<ProgrammeImportPreview, 'skipped' | 'unprescribed'>>,  {replace=false} = {}, index: ExerciseIndex = EXIDX) {
  if (preview.skipped || preview.unknown.length) throw new Error('Resolve unknown exercises before saving the program.')
  if(preview.unprescribed?.length) throw new Error('Enter sets and reps for unprescribed slots before saving.')
  // The shared validator rejects unresolved ids before this saved-definition narrowing.
  const d=validateProgrammeDefinition(preview.definition!,[...CATALOGUE,...list<NonNullable<ProgrammeState['customEx']>[number]>(S.customEx)],index) as ProgrammeDefinition
  const definitions=list<ProgrammeDefinition>(S.programmes?.definitions)
  if (definitions.some(x=>x.id===d.id) && !replace) throw new Error('A program with this id already exists. Confirm replacement first.')
  S.programmes={version:1,fork:'wilky/1',...S.programmes,cycles:list<import('./programme-engine-types').ProgrammeCycle>(S.programmes?.cycles),definitions:definitions.filter(x=>x.id!==d.id).concat(clone(d))}
  return d
}
