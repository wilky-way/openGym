import {importProgramme, saveImportedProgramme} from './programme-import.js'
import {programmeConformance} from './programme-conformance.js'
import {improveProgrammeDefinition} from './programme-quality.js'
import {CATALOGUE} from './exercises.js'
const rank={Invalid:0,Valid:1,Complete:2,Ready:3}

/** Offline preparation only. Repairing stored definitions with no source file is opt-in (options.repair). Never changes active/paused definitions, snapshots, routines or logs. */
export function refreshProgrammeDefinitions(state, files=[], options={}) {
  const S=structuredClone(state), report={added:[],updated:[],protected:[],skipped:[],needsReview:[],conformance:[],repairs:[]}
  const catalogue=[...CATALOGUE,...S.customEx||[]], assess=d=>programmeConformance(d,{catalogue})
  const cycles=S.programmes?.cycles || [], protectedIds=new Set()
  // A protected cycle's saved definition may be named by programmeId, by its snapshot, or both.
  const protect=c=>{for(const id of [c.programmeId,c.snapshot?.id])if(id)protectedIds.add(id)}
  cycles.filter(c=>['active','paused'].includes(c.status)).forEach(protect)
  // Also protect a running workout whose cycle has been archived meanwhile.
  const activeCycle=S.active?.programmeInstance?.cycleId
  for (const id of [activeCycle,...(S.active?.routineIds || []).map(id=>S.routines?.find(r=>r.id===id)?.programme?.cycleId)].filter(Boolean)) {
    const cycle=cycles.find(c=>c.id===id)
    if (cycle) protect(cycle)
  }
  const originals=new Map((S.programmes?.definitions||[]).map(d=>[d.id,d]))
  const seen=new Set(), touched=new Set(), duplicateIds=new Set(), sourceById=new Map()
  for(const {raw} of files)if(raw?.id) {
    if(sourceById.has(raw.id))duplicateIds.add(raw.id)
    sourceById.set(raw.id,raw)
  }
  for(const id of duplicateIds)sourceById.delete(id)
  const repair=def=>improveProgrammeDefinition(def,{catalogue,decisions:options.decisions?.[def.id]||{},sourceRaw:sourceById.get(def.id)})
  const store=(definition,changes,exists)=>{
    // Only a structurally valid candidate reaches the output; unresolved quality
    // issues stay in the definition/report and are never marked reviewed.
    saveImportedProgramme(S,{definition,unknown:[],unprescribed:[]},{replace:true})
    touched.add(definition.id)
    report[exists?'updated':'added'].push(definition.id)
    if(changes.length)report.repairs.push({id:definition.id,changes})
  }
  for (const {raw,filename} of files) {
    const id=raw?.id
    if (protectedIds.has(id)) {if(!report.protected.includes(id))report.protected.push(id);continue}
    if (duplicateIds.has(id)) {
      if(!seen.has(id))report.needsReview.push({id,reason:'Duplicate program id in input files; no source chosen.'})
      seen.add(id);continue
    }
    if (id) seen.add(id)
    try {
      const preview=importProgramme(raw,{...options,filename,customEx:S.customEx || [],strictPrescriptions:true})
      if (preview.skipped) {report.skipped.push(filename);continue}
      if (preview.unknown.length || preview.unprescribed.length) {report.needsReview.push({id,unknown:preview.unknown,unprescribed:preview.unprescribed});continue}
      const previous=originals.get(id)
      // Definition metadata is explicit author information. Preserve fields the
      // library format did not carry rather than losing them on re-import.
      for(const field of ['goal','level','daysPerWeek','lengthWeeks','equipment','licence','endPlan','scheduleReviewed'])if(preview.definition[field]==null && previous?.[field]!=null)preview.definition[field]=structuredClone(previous[field])
      const {definition,changes}=repair(preview.definition)
      if(previous && rank[assess(definition).level]<rank[assess(previous).level]) {
        report.needsReview.push({id,reason:'Source refresh would lower conformance; existing definition retained.'});continue
      }
      store(definition,['source re-import',...changes],!!previous)
    } catch (err) {report.needsReview.push({id,reason:err.message})}
  }
  for(const [id,old] of originals) {
    if(protectedIds.has(id)) {if(!report.protected.includes(id))report.protected.push(id);continue}
    if(touched.has(id)||!options.repair)continue
    try {
      const {definition,changes}=repair(old)
      if(changes.length && rank[assess(definition).level]>=rank[assess(old).level] && assess(definition).level!=='Invalid')store(definition,changes,true)
    } catch(err) {report.needsReview.push({id,reason:err.message})}
  }
  for(const d of S.programmes?.definitions||[]) {
    const before=originals.has(d.id)?assess(originals.get(d.id)):null, after=assess(d)
    report.conformance.push({id:d.id,protected:protectedIds.has(d.id),before:before?.level||null,after:after.level,issues:after.issues})
  }
  return {state:S,report}
}
