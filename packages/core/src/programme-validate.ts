import { validateNativeDefinition } from './native-authority'
// Validation is split from programme-import by the coordinator-approved K12/K13 boundary.
// These helpers retain raw source preflight behavior so K12 can share the same limits.
import type { ProgrammeDefinition } from '../../contract/domain/programme-model'
import type { ExerciseIndex } from '@opengym/core/exercises'
import { CATALOGUE, EXIDX, canonicalExId } from '@opengym/core/exercises'
import { validateSetTarget } from '@opengym/core/programme-targets'
import { programmeSchemaIssues } from './programme-model-schema'
type CatalogueEntry = { id?: string; [key: string]: unknown }
interface PreflightExercise {
  id?: string | null; open?: boolean; role?: string | null; generatedRules?: unknown
  sets?: number | {count?: number | number[]; weight?: unknown}[]
  name?: string; equipment?: string
}
interface PreflightDay { sessions?: {routineSnapshot?: {ex?: PreflightExercise[]}}[]; exercises?: PreflightExercise[] }
interface PreflightProgramme { id?: string; weeks: {days: PreflightDay[]}[] }
const importExerciseKey = (e: PreflightExercise) => `${e.name || e.id || ''}|${e.equipment || ''}`
const numeric = (n: unknown) => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n))
const positive = (n: unknown) => numeric(n) && Number(n) > 0
const load = (n: unknown) => { if (n == null) return 0; if (!numeric(n) || Number(n) < 0) throw new Error('Invalid program prescription'); return Number(n) }
const textFields = new Set(['id','name','short','label','note','notes','noteKind','authoredInstructions','kind','key','slotId','sessionTemplateId','weekId','sourceWeek','weights_in','block_type','equipment','opengym_id','role','instructions','goal','level','licence','category','loadGuidance','provenance'])
export function programmeMetadata(value: unknown, depth = 0, parentKey = '', archival = false) {
  if (depth > 20) throw new Error('Invalid program metadata')
  if (typeof value === 'string' && archival && value.length > 10000) throw new Error('Invalid program metadata')
  if (!value || typeof value !== 'object') return
  for (const [key, v] of Object.entries(value)) {
    if (depth === 0 && ['progressionRules','tmSeeds'].includes(key)) continue // Closed authoring schema handles these, including AMRAP source references.
    if (['_ts','_f','_u'].includes(key)) continue // Sync clocks are not UI metadata.
    if (key === 'needsReview' && (!Array.isArray(v) || v.some(x=>typeof x!=='string' || x.length>10000))) throw new Error('Invalid program metadata')
    if (key === 'notes' && Array.isArray(v) && v.every(x=>typeof x==='string' && x.length<=10000)) continue
    if (key === 'equipment' && depth === 0 && Array.isArray(v) && v.every(x=>typeof x==='string' && x.length<=10000)) continue
    // These are legacy source-document indexes, never displayed as instructions.
    if (key === 'instructions' && ['rules','libraryRules'].includes(parentKey) && v && typeof v === 'object' && !Array.isArray(v)) {
      programmeMetadata(v, depth + 1, key, true); continue
    }
    if (textFields.has(key) && v != null && (typeof v !== 'string' || v.length > 10000)) throw new Error('Invalid program metadata')
    if (key === 'source' && v != null) {
      if (Array.isArray(v) || typeof v !== 'object' || Object.values(v).some(x => x != null && !['string','boolean'].includes(typeof x))) throw new Error('Invalid program metadata')
    }
    programmeMetadata(v, depth + 1, key, archival)
  }
}
// Bound both the file and its expansion before allocating any per-set rows or cloning snapshots.
export function programmePreflight(value: unknown, prescriptions: Record<string, {sets?: number}> = {}) {
  const raw = value as PreflightProgramme
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid program definition')
  programmeMetadata(raw)
  if (!Array.isArray(raw.weeks) || raw.weeks.length < 1 || raw.weeks.length > 64) throw new Error('A program needs between one and 64 explicit weeks.')
  let total = 0
  for (const w of raw.weeks) {
    if (!Array.isArray(w.days) || w.days.length > 14) throw new Error('Invalid program day')
    for (const d of w.days) {
      const sessions = d.sessions || [{routineSnapshot:{ex:d.exercises}}]
      if (!Array.isArray(sessions) || sessions.length > 8) throw new Error('Invalid program session')
      for (const session of sessions) {
        const ex = session.routineSnapshot?.ex
        if (!Array.isArray(ex) || ex.length > 100) throw new Error('Invalid program session')
        for (const e of ex) {
          if (e.generatedRules != null) {
            if (!Array.isArray(e.generatedRules) || e.generatedRules.length > 100) throw new Error('Invalid generated rules')
            for (const row of e.generatedRules) {
              if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid generated rules')
              for (const [key,value] of Object.entries(row)) {
                const valid = ['rir','rpe'].includes(key)
                  ? Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= (key === 'rpe' ? 1 : 0) && n <= 10) && value[0]! <= value[1]!
                  : ['count','pct'].includes(key)
                  ? Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(n => typeof n === 'number' && positive(n) && (key !== 'count' || Number.isInteger(n) && n <= 100))
                  : ['drop_pct','until_rpe','total_reps'].includes(key)
                    ? typeof value === 'number' && positive(value) && (key !== 'until_rpe' || value <= 10)
                    : key === 'from' ? value === 'top_set' : key === 'open_count' && value === true
                if (!valid) throw new Error('Invalid generated rules')
              }
            }
          }
          if (Array.isArray(e.sets)) {
            if (e.sets.length > 100) throw new Error('Invalid program prescription')
            const manual = prescriptions[importExerciseKey(e)]
            const open=e.open === true || /^sbs-/i.test(raw.id || '') && /accessory/i.test(e.name || e.role || '')
            let count = e.sets.length ? 0 : Number(manual?.sets ?? (open ? 3 : 1))
            if (!positive(count || 1) || !Number.isInteger(count) || count > 100) throw new Error('Invalid program prescription')
            for (const row of e.sets) {
              if (!row || typeof row !== 'object') throw new Error('Invalid program prescription')
              const values = Array.isArray(row.count) ? row.count : [row.count ?? 1]
              if (!values.length || values.length > 100 || values.some(n => !positive(n) || !Number.isInteger(Number(n)) || Number(n) > 100)) throw new Error('Invalid program prescription')
              count += Math.min(...values.map(Number))
              load(row.weight)
            }
            if (count > 100) throw new Error('Invalid program prescription')
            total += count
          } else {
            const count=Number(e.sets ?? prescriptions[importExerciseKey(e)]?.sets ?? (e.open ? 3 : 1))
            if (!positive(count) || !Number.isInteger(count) || count>100) throw new Error('Invalid program prescription')
            total += count
          }
          if (total > 10000) throw new Error('Program exceeds the import size limit.')
        }
      }
    }
  }
}
export function validateProgrammeDefinition<T>(value: T, catalogue: CatalogueEntry[] = CATALOGUE, index: ExerciseIndex = EXIDX): T {
  const d = value as ProgrammeDefinition
  programmePreflight(d)
  if (!d || typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || !d.name || !['kg','lb'].includes(d.unit)) throw new Error('Invalid program definition')
  if (!Array.isArray(d.weeks) || !d.weeks.length || d.weeks.length > 64) throw new Error('A program needs between one and 64 explicit weeks.')
  if (d.days != null && !Array.isArray(d.days)) throw new Error('Invalid program day')
  validateNativeDefinition(d,index)
  const indexes = new Set(), ids = new Set(catalogue.map(e=>e.id))
  for (const w of d.weeks) {
    if (!Number.isInteger(w.index) || w.index < 1 || indexes.has(w.index) || !Array.isArray(w.days) || !w.days.length) throw new Error('Programme week indexes must be unique positive integers')
    indexes.add(w.index)
    const days = new Set()
    for (const day of w.days) {
      if (typeof day.key !== 'string' || !day.key || days.has(day.key) || !Array.isArray(day.sessions) || !day.sessions.length) throw new Error('Invalid program day')
      days.add(day.key)
      for (const session of day.sessions) {
        const ex = session.routineSnapshot?.ex
        if (!Array.isArray(ex) || ex.length > 100) throw new Error('Invalid program session')
        for (const e of ex) {
          if(e.importNeedsPrescription) throw new Error('Enter sets and reps for unprescribed slots before saving.')
          if (!(e.open === true && !e.id) && !ids.has(canonicalExId(e.id,index))) throw new Error('Resolve unknown exercises before saving the program.')
          if (e.nativePrescription!==undefined) {
            continue
          }
          // Progression-scoped extension: legacy instruction-only slots keep
          // their exact rep validation. Engine rules can consume AMRAP notation
          // and double progression consumes an explicit authored rep range.
          const attached = Array.isArray(d.progressionRules) ? d.progressionRules.filter(r=>r && e.progression?.rules?.includes(r.id)) : []
          const amrap = attached.some(r=>['percentage','linear','amrap-tm','volume-ramp','scheduled-deload'].includes(r.kind))
          const double = attached.some(r=>r.kind==='double')
          const engineRep = (rep: unknown) => amrap && rep==='amrap' || double && typeof rep==='string' && /^\d+\s*-\s*\d+$/.test(rep) && rep.split('-').every(n=>positive(n) && Number(n)<=100) && Number(rep.split('-')[0])<=Number(rep.split('-')[1])
          if (!positive(e.sets) || !Number.isInteger(e.sets) || e.sets > 100 || (e.pyramid && (!Array.isArray(e.pyramid) || !e.pyramid.length || e.pyramid.length > 10 || e.pyramid.some(r=>r!=='max' && !engineRep(r) && (!positive(r) || !Number.isInteger(attached.length?Number(r):r)))))) throw new Error('Invalid program prescription')
          if (e.mode === 'time' ? !positive(e.sec) : !e.pyramid && e.reps !== 'max' && !engineRep(e.reps) && (!positive(e.reps) || !Number.isInteger(Number(e.reps)))) throw new Error('Invalid program prescription')
          validateSetTarget(e.target)
          if (e.setTargets && (!Array.isArray(e.setTargets) || e.setTargets.length !== (e.pyramid?.length || e.sets))) throw new Error('Invalid set targets')
          for (const target of e.setTargets || []) validateSetTarget(target)
          if (e.repsMin != null && (!positive(e.repsMin) || !Number.isInteger(Number(e.repsMin)) || Number(e.repsMin)>Number(e.reps))) throw new Error('Invalid program rep range')
          if (e.setRepsMin && (!Array.isArray(e.setRepsMin) || e.setRepsMin.length !== (e.pyramid?.length || e.sets) || e.setRepsMin.some((n,i)=>n!=null && (!positive(n) || !Number.isInteger(Number(n)) || Number(n)>Number(e.pyramid?.[i] ?? e.reps))))) throw new Error('Invalid program rep range')
          load(e.weight)
          if (e.pyramidWeight && (!Array.isArray(e.pyramidWeight) || e.pyramidWeight.length !== e.pyramid?.length)) throw new Error('Invalid program prescription')
          for (const weight of e.pyramidWeight || []) load(weight)
          if (e.tm && (!Array.isArray(e.tm.percentages) || e.tm.percentages.length!==e.pyramid?.length || e.tm.percentages.some(p=>!positive(p)))) throw new Error('Invalid percentage prescription')
        }
      }
    }
  }
  const schemaIssues = programmeSchemaIssues(d)
  if (schemaIssues.length) throw new Error(`Invalid program definition at ${schemaIssues[0]!.path}: ${schemaIssues[0]!.message}`)
  return value
}
