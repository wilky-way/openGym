import {validateProgrammeDefinition} from './programme-import.js'
import {programmeSchemaIssues} from './programme-model-schema.js'
import {setTargetAt} from './programme-targets.js'
import {CATALOGUE} from './exercises.js'
const list=v=>Array.isArray(v)?v:[]
const text=v=>typeof v==='string' && !!v.trim()

// Required level is the first level blocked by this issue. A valid, unfinished
// definition remains useful; this function neither fixes nor mutates it.
export function programmeConformance(def, {catalogue=CATALOGUE}={}) {
  const issues=[]
  const add=(code,location,fix,requiredFor='Ready',extra={})=>issues.push({code,location,fix,requiredFor,...extra})
  try {validateProgrammeDefinition(def,catalogue)} catch(error) {
    const shape=programmeSchemaIssues(def)
    if(shape.length)for(const issue of shape) {
      const indexes=issue.path.match(/^\/weeks\/(\d+)\/days\/(\d+)\/sessions\/(\d+)\/routineSnapshot\/ex\/(\d+)/)
      const location={path:issue.path}
      if(indexes) {
        const [wi,di,si,ei]=indexes.slice(1).map(Number),w=def.weeks[wi],d=w.days[di],s=d.sessions[si],e=s.routineSnapshot.ex[ei]
        Object.assign(location,{week:w.index,day:d.key,session:s.sessionTemplateId||si+1,slot:e?.slotId||ei+1})
      }
      add('structure.invalid',location,`Correct the definition: ${issue.message}`,'Valid')
    }
    else {
      // Localize semantic slot failures; keep global failures (duplicate keys,
      // expansion bounds) at the program when no individual slot fails.
      for(const w of list(def?.weeks))for(const d of list(w?.days))for(const [si,s] of list(d?.sessions).entries())for(const [ei,e] of list(s?.routineSnapshot?.ex).entries()) {
        try {validateProgrammeDefinition({id:def.id,name:def.name,unit:def.unit,weeks:[{index:w.index,days:[{key:d.key,sessions:[{routineSnapshot:{ex:[e]}}]}]}]},catalogue)}
        catch(err) {add('structure.invalid',{week:w.index,day:d.key,session:s.sessionTemplateId||si+1,slot:e?.slotId||ei+1},`Correct the slot prescription: ${err.message}`,'Valid')}
      }
      if(!issues.length)add('structure.invalid',{path:''},`Correct the program structure: ${error.message}`,'Valid')
    }
    return {level:'Invalid',issues}
  }
  for(const w of def.weeks)for(const d of w.days)for(const [si,s] of d.sessions.entries()) {
   const sessionLoc={week:w.index,day:d.key,session:s.sessionTemplateId||si+1}
   if(!s.routineSnapshot.ex.length)add('session.empty',sessionLoc,'Author this session’s slots or remove the intentionally empty session.','Complete')
   if(/structure[ -]only|unprescribed|missing prescription/i.test(s.routineSnapshot.note||''))add('program.structure-only',sessionLoc,'Resolve the omitted or unprescribed source slots retained in this session’s notes.','Complete')
   for(const [ei,e] of s.routineSnapshot.ex.entries()) {
    const loc={week:w.index,day:d.key,session:s.sessionTemplateId||si+1,slot:e.slotId||ei+1}
    if(e.open && !e.id && !text(e.category))add('slot.category',loc,'Choose a category for this open slot from the source or author.','Complete')
    const missing=[]
    const cfg=w.rir==null?e:{...e,target:{...e.target,rir:w.rir}}
    for(let i=0;i<(e.pyramid?.length||e.sets);i++) {
      const target=setTargetAt(cfg,i)
      if(!target || !['rir','rpe','pct'].some(k=>target[k]!=null))missing.push(i+1)
    }
    if(missing.length)add('slot.effort',loc,'Supply an authored RIR, RPE or percentage target for every working set.','Complete',{sets:missing})
    // AMRAP ("max") and timed strength GPP are explicit prescriptions too.
    if(e.structureOnly===true || e.parsed===false || /structure[ -]only/i.test([e.note,e.instructions].filter(text).join(' ')))add('slot.structure-only',loc,'Replace the structure-only placeholder with its complete source prescription.','Complete')
    if(!['main','supplement','accessory','gpp'].includes(e.role))add('slot.role',loc,'Mark this slot as a main lift, supplement, accessory or strength GPP from the source.')
    if(e.role==='main' && !(e.progression && text(e.progression.instructions)))add('slot.progression',loc,'Attach a structured or fully translated progression rule for this main lift; explicitly state when it stays fixed.')
   }
  }
  if(def.structureOnly===true || /structure[ -]only/i.test([def.instructions,...list(def.importWarnings),...list(def.needsReview)].filter(text).join(' ')))add('program.structure-only',{path:''},'Resolve every structure-only source placeholder.','Complete')
  for(const field of ['goal','level','licence'])if(!text(def[field]))add(`metadata.${field}`,{path:`/${field}`},`Fill in the ${field} from the source or author.`)
  if(!Number.isInteger(def.daysPerWeek)||def.daysPerWeek<1)add('metadata.days-per-week',{path:'/daysPerWeek'},'State the intended training days per week.')
  if(!Number.isInteger(def.lengthWeeks)||def.lengthWeeks<1)add('metadata.length',{path:'/lengthWeeks'},'State the number of explicit authored weeks.')
  else if(def.lengthWeeks!==def.weeks.length)add('metadata.length',{path:'/lengthWeeks'},'Make lengthWeeks match the number of explicit authored weeks.')
  if(!list(def.equipment).length)add('metadata.equipment',{path:'/equipment'},'List the equipment needed for the resolved lifts and open slots.')
  if(!def.source || !text(def.source.kind) || !['ref','name','url','original_url','workbook','repo'].some(k=>text(def.source[k])))add('metadata.source',{path:'/source'},'Record the source kind and a reference, name, URL, workbook or repository.')
  if(typeof def.source?.private!=='boolean')add('metadata.private',{path:'/source/private'},'Explicitly mark whether this definition contains private prescriptions.')
  // End=next/stop alone is scheduling behavior, not an authored training plan.
  if(!def.weeks.some(w=>w.mode==='deload' || w.deload?.authored===true) && !(def.endPlan && text(def.endPlan.instructions)))add('program.end-plan',{path:'/endPlan'},'Add an authored deload or an explicit end-of-block plan (test, repeat, next or stop).')
  for(const reason of list(def.needsReview))if(text(reason))add('review.unresolved',{path:'/needsReview'},`Resolve the source review: ${reason}`)
  for(const key of ['rules','libraryRules'])if(def[key]?.instructions && typeof def[key].instructions==='object')add('review.unresolved',{path:`/${key}/instructions`},'Review the archived source-document instruction index; its guidance is not translated.')
  if(def.rulesSupported===false && !list(def.needsReview).some(text))add('review.unresolved',{path:'/rulesSupported'},'Recover or review the unsupported source rules; absence of a reason is not approval.')
  if(list(def.importWarnings).some(s=>/review the schedule/i.test(s)) && def.scheduleReviewed!==true)add('review.schedule',{path:'/scheduleReviewed'},'Review the separate sessions on each source day and explicitly acknowledge the schedule.')
  return {level:issues.some(i=>i.requiredFor==='Complete')?'Valid':issues.length?'Complete':'Ready',issues}
}
