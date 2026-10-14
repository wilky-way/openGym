import type { ExerciseIndex } from '../../contract/core-api/exercises'
import { EXIDX } from '@opengym/core/exercises'
import type { ProgrammeState, ProgrammeDefinition, ProgrammeCycle } from './programme-engine-types'
import type { ProgrammeImportOptions, ImportProblem } from './programme-import'
import type { ProgrammeRepairDecisions, ProgrammeSourceRaw } from './programme-quality'
import type { ProgrammeConformance, ProgrammeConformanceLevel } from './programme-conformance'
interface RefreshFile {raw: unknown; filename?: string}
interface RefreshOptions extends ProgrammeImportOptions {repair?: boolean; decisions?: Record<string, ProgrammeRepairDecisions>}
interface RefreshReport {
  added: string[]; updated: string[]; protected: string[]; skipped: (string | undefined)[]
  needsReview: {id?: string; reason?: string; unknown?: ImportProblem[]; unprescribed?: ImportProblem[]}[]
  conformance: {id: string; protected: boolean; before: ProgrammeConformanceLevel | null; after: ProgrammeConformanceLevel; issues: ProgrammeConformance['issues']}[]
  repairs: {id: string; changes: string[]}[]
}
import {importProgramme, saveImportedProgramme} from './programme-import'
import {programmeConformance} from './programme-conformance'
import {improveProgrammeDefinition} from './programme-quality'
import {CATALOGUE} from '@opengym/core/exercises'
const rank={Invalid:0,Valid:1,Complete:2,Ready:3}

/** Offline preparation only. Repairing stored definitions with no source file is opt-in (options.repair). Never changes active/paused definitions, snapshots, routines or logs. */
export function refreshProgrammeDefinitions(state: ProgrammeState, files: RefreshFile[]=[], options: RefreshOptions={}, index: ExerciseIndex = EXIDX) {
  const S=structuredClone(state), report: RefreshReport={added:[],updated:[],protected:[],skipped:[],needsReview:[],conformance:[],repairs:[]}
  const catalogue=[...CATALOGUE,...S.customEx||[]], assess=(d: unknown)=>programmeConformance(d,{catalogue},index)
  const cycles=S.programmes?.cycles || [], protectedIds=new Set<string>()
  // A protected cycle's saved definition may be named by programmeId, by its snapshot, or both.
  const protect=(c: ProgrammeCycle)=>{for(const id of [c.programmeId,c.snapshot?.id])if(id)protectedIds.add(id)}
  cycles.filter(c=>['active','paused'].includes(c.status)).forEach(protect)
  // Also protect a running workout whose cycle has been archived meanwhile.
  const activeCycle=S.active?.programmeInstance?.cycleId
  for (const id of [activeCycle,...(S.active?.routineIds || []).map(id=>S.routines?.find(r=>r.id===id)?.programme?.cycleId)].filter(Boolean)) {
    const cycle=cycles.find(c=>c.id===id)
    if (cycle) protect(cycle)
  }
  const originals=new Map((S.programmes?.definitions||[]).map(d=>[d.id,d]))
  const seen=new Set<string>(), touched=new Set<string>(), duplicateIds=new Set<string>(), sourceById=new Map<string, ProgrammeSourceRaw>()
  for(const {raw} of files)if((raw as {id?: string} | null)?.id) {
    if(sourceById.has((raw as {id: string}).id))duplicateIds.add((raw as {id: string}).id)
    sourceById.set((raw as {id: string}).id,raw as ProgrammeSourceRaw)
  }
  for(const id of duplicateIds)sourceById.delete(id)
  const repair=(def: ProgrammeDefinition)=>improveProgrammeDefinition(def,{catalogue,decisions:options.decisions?.[def.id]||{},sourceRaw:sourceById.get(def.id)},index)
  const store=(definition: ProgrammeDefinition,changes: string[],exists: boolean)=>{
    // Only a structurally valid candidate reaches the output; unresolved quality
    // issues stay in the definition/report and are never marked reviewed.
    saveImportedProgramme(S,{definition,unknown:[],unprescribed:[]},{replace:true},index)
    touched.add(definition.id)
    report[exists?'updated':'added'].push(definition.id)
    if(changes.length)report.repairs.push({id:definition.id,changes})
  }
  for (const {raw,filename} of files) {
    const id=(raw as {id?: string} | null)?.id
    if (protectedIds.has(id!)) {if(!report.protected.includes(id!))report.protected.push(id!);continue}
    if (duplicateIds.has(id!)) {
      if(!seen.has(id!))report.needsReview.push({id,reason:'Duplicate program id in input files; no source chosen.'})
      seen.add(id!);continue
    }
    if (id) seen.add(id!)
    try {
      const preview=importProgramme(raw,{...options,filename,customEx:S.customEx || [],strictPrescriptions:true},index)
      if (preview.skipped) {report.skipped.push(filename);continue}
      if (preview.unknown.length || preview.unprescribed.length) {report.needsReview.push({id,unknown:preview.unknown,unprescribed:preview.unprescribed});continue}
      const previous=originals.get(id!)
      // Definition metadata is explicit author information. Preserve fields the
      // library format did not carry rather than losing them on re-import.
      for(const field of ['goal','level','daysPerWeek','lengthWeeks','equipment','licence','endPlan','scheduleReviewed'])if(preview.definition![field]==null && previous?.[field]!=null)preview.definition![field]=structuredClone(previous[field])
      const repaired=repair(preview.definition! as ProgrammeDefinition)
      const {changes}=repaired, definition=repaired.definition as ProgrammeDefinition
      if(previous && rank[assess(definition).level]<rank[assess(previous).level]) {
        report.needsReview.push({id,reason:'Source refresh would lower conformance; existing definition retained.'});continue
      }
      store(definition,['source re-import',...changes],!!previous)
    } catch (err) {report.needsReview.push({id,reason:err instanceof Error ? err.message : (err as {message?: string}).message})}
  }
  for(const [id,old] of originals) {
    if(protectedIds.has(id!)) {if(!report.protected.includes(id!))report.protected.push(id!);continue}
    if(touched.has(id)||!options.repair)continue
    try {
      const repaired=repair(old)
      const {changes}=repaired, definition=repaired.definition as ProgrammeDefinition
      if(changes.length && rank[assess(definition).level]>=rank[assess(old).level] && assess(definition).level!=='Invalid')store(definition,changes,true)
    } catch(err) {report.needsReview.push({id,reason:err instanceof Error ? err.message : (err as {message?: string}).message})}
  }
  for(const d of S.programmes?.definitions||[]) {
    const before=originals.has(d.id)?assess(originals.get(d.id)):null, after=assess(d)
    report.conformance.push({id:d.id,protected:protectedIds.has(d.id),before:before?.level||null,after:after.level,issues:after.issues})
  }
  return {state:S,report}
}
