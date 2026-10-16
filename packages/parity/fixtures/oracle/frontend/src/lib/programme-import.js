// Runtime file conversion only: no training library is bundled or fetched by the app.
import { programmeRuleText } from './programme-rule-text.js'
import { validateSetTarget, effortRangeLabel } from './programme-targets.js'
import { CATALOGUE, canonicalExId } from './exercises.js'
import { programmeSchemaIssues } from './programme-model-schema.js'
const list = v => Array.isArray(v) ? v : []
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const clone = x => structuredClone(x)
const numeric = n => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n))
const positive = n => numeric(n) && Number(n) > 0
const load = n => { if (n == null) return 0; if (!numeric(n) || Number(n) < 0) throw new Error('Invalid program prescription'); return Number(n) }
const MAX_BYTES = 5 * 1024 * 1024
const textFields = new Set(['id','name','short','label','note','notes','noteKind','authoredInstructions','kind','key','slotId','sessionTemplateId','weekId','sourceWeek','weights_in','block_type','equipment','opengym_id','role','instructions','goal','level','licence','category','loadGuidance','provenance'])
function metadata(value, depth = 0, parentKey = '', archival = false) {
  if (depth > 20) throw new Error('Invalid program metadata')
  if (typeof value === 'string' && archival && value.length > 10000) throw new Error('Invalid program metadata')
  if (!value || typeof value !== 'object') return
  for (const [key, v] of Object.entries(value)) {
    if (['_ts','_f','_u'].includes(key)) continue // Sync clocks are not UI metadata.
    if (key === 'needsReview' && (!Array.isArray(v) || v.some(x=>typeof x!=='string' || x.length>10000))) throw new Error('Invalid program metadata')
    if (key === 'notes' && Array.isArray(v) && v.every(x=>typeof x==='string' && x.length<=10000)) continue
    if (key === 'equipment' && depth === 0 && Array.isArray(v) && v.every(x=>typeof x==='string' && x.length<=10000)) continue
    // These are legacy source-document indexes, never displayed as instructions.
    if (key === 'instructions' && ['rules','libraryRules'].includes(parentKey) && v && typeof v === 'object' && !Array.isArray(v)) {
      metadata(v, depth + 1, key, true); continue
    }
    if (textFields.has(key) && v != null && (typeof v !== 'string' || v.length > 10000)) throw new Error('Invalid program metadata')
    if (key === 'source' && v != null) {
      if (Array.isArray(v) || typeof v !== 'object' || Object.values(v).some(x => x != null && !['string','boolean'].includes(typeof x))) throw new Error('Invalid program metadata')
    }
    metadata(v, depth + 1, key, archival)
  }
}
// Bound both the file and its expansion before allocating any per-set rows or cloning snapshots.
function preflight(raw, prescriptions = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid program definition')
  metadata(raw)
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
                  ? Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= (key === 'rpe' ? 1 : 0) && n <= 10) && value[0] <= value[1]
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
function numbered(items, sessions = false) {
  if (items.every(x => x.n == null)) return items
  if (items.some(x => !positive(x.n) || !Number.isInteger(Number(x.n)))) throw new Error('Invalid program numbering')
  const seen = new Map()
  for (const item of items) {
    const n = Number(item.n), kinds = seen.get(n) || new Set()
    if (kinds.size && (!sessions || !item.kind || kinds.has(item.kind))) throw new Error('Invalid program numbering')
    kinds.add(item.kind);seen.set(n,kinds)
  }
  return [...items].sort((a,b) => Number(a.n) - Number(b.n))
}
// Rules are displayed for the athlete to follow; they never calculate today's load.
export function ruleInstructions(e, kind = 'none') {
  const parts = []
  for (const row of list(e.sets)) {
    const rules = []
    if (Array.isArray(row.count)) rules.push(`Perform ${Math.min(...row.count)}–${Math.max(...row.count)} sets`)
    if (Array.isArray(row.pct)) rules.push(`Target ${Math.min(...row.pct)}–${Math.max(...row.pct)}%`)
    for (const key of ['drop_pct','until_rpe','total_reps']) if (row[key] != null && (!numeric(row[key]) || Number(row[key]) <= 0 || key === 'until_rpe' && Number(row[key]) > 10)) throw new Error('Invalid program rule')
    if (row.drop_pct != null) rules.push(`Drop ${row.drop_pct}%${/back.?off/i.test(row.kind || '') || row.from === 'top_set' ? " from today's top set" : ''}`)
    if (row.until_rpe != null) rules.push(kind === 'none' ? `repeat until @${row.until_rpe}` : `repeat until ${effortRangeLabel('rpe',Number(row.until_rpe),Number(row.until_rpe),kind)}`)
    if (row.total_reps != null) rules.push(`${row.total_reps} total reps`)
    if (row.open_count && row.until_rpe == null && row.total_reps == null) rules.push('repeat as needed')
    for (const key of ['rir','rpe']) if (Array.isArray(row[key])) rules.push(`${effortRangeLabel(key,row[key][0],row[key][1],kind)} (as authored; choose the per-set target).`)
    if (rules.length) parts.push(rules.join('; '))
  }
  return parts.join(' · ')
}
// Retain only rule values, never source prose (including in private imports).
function generatedRules(e) {
  return list(e.sets).map(row => ({
    ...(Array.isArray(row.count) ? {count:row.count.map(Number)} : {}),
    ...(Array.isArray(row.pct) ? {pct:row.pct.map(Number)} : {}),
    ...Object.fromEntries(['rir','rpe'].filter(key => Array.isArray(row[key])).map(key => [key,row[key].map(Number)])),
    ...Object.fromEntries(['drop_pct','until_rpe','total_reps'].filter(key => row[key] != null).map(key => [key,Number(row[key])])),
    ...(/back.?off/i.test(row.kind || '') || row.from === 'top_set' ? {from:'top_set'} : {}),
    ...(row.open_count ? {open_count:true} : {}),
  })).filter(row => Object.keys(row).some(key => key !== 'from'))
}
const privateSource = raw => raw.source?.private === true || /^(?:bbm|sbs)-/i.test(raw.id)

export const hasPrivateProgrammes = S => list(S.programmes?.definitions).some(d=>d.source?.private) || list(S.programmes?.cycles).some(c=>c.snapshot?.source?.private)
export const importExerciseKey = e => `${e.name || e.id || ''}|${e.equipment || ''}`

export function validateProgrammeDefinition(d, catalogue = CATALOGUE) {
  preflight(d)
  if (!d || typeof d.id !== 'string' || !d.id || typeof d.name !== 'string' || !d.name || !['kg','lb'].includes(d.unit)) throw new Error('Invalid program definition')
  if (!Array.isArray(d.weeks) || !d.weeks.length || d.weeks.length > 64) throw new Error('A program needs between one and 64 explicit weeks.')
  if (d.days != null && !Array.isArray(d.days)) throw new Error('Invalid program day')
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
          if (!(e.open === true && !e.id) && !ids.has(canonicalExId(e.id))) throw new Error('Resolve unknown exercises before saving the program.')
          if (!positive(e.sets) || !Number.isInteger(e.sets) || e.sets > 100 || (e.pyramid && (!Array.isArray(e.pyramid) || !e.pyramid.length || e.pyramid.length > 10 || e.pyramid.some(r=>r!=='max' && (!positive(r) || !Number.isInteger(r)))))) throw new Error('Invalid program prescription')
          if (e.mode === 'time' ? !positive(e.sec) : !e.pyramid && e.reps !== 'max' && (!positive(e.reps) || !Number.isInteger(Number(e.reps)))) throw new Error('Invalid program prescription')
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
  if (schemaIssues.length) throw new Error(`Invalid program definition at ${schemaIssues[0].path}: ${schemaIssues[0].message}`)
  return d
}

/** Preview is pure. Explicit mappings beat unique exact catalogue names; ambiguities stay unresolved. */
export function importProgramme(input, { filename='', mappings={}, prescriptions={}, customEx=[], strictPrescriptions=false } = {}) {
  if (filename === 'pub-_flagged.json' || input?.id === 'pub-_flagged' || Array.isArray(input)) return {skipped:true,definition:null,unknown:[],unprescribed:[],warnings:[]}
  if (typeof input !== 'string') {preflight(input,prescriptions);if(input.weeks?.[0]?.index != null) validateProgrammeDefinition(input,[...CATALOGUE,...customEx])}
  const json = typeof input === 'string' ? input : JSON.stringify(input)
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_BYTES) throw new Error('Program exceeds the import size limit.')
  const raw = JSON.parse(json)
  const catalogue = [...CATALOGUE,...customEx]
  if (!raw || typeof raw !== 'object') throw new Error('Invalid program definition')
  preflight(raw,prescriptions)
  if (raw.weeks?.[0]?.index != null) {
    const definition = validateProgrammeDefinition({...raw,source:{...raw.source,private:privateSource(raw)}},catalogue)
    return {definition,unknown:[],unprescribed:[],warnings:[],skipped:false}
  }
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !['lb','kg'].includes(raw.unit) || !list(raw.weeks).length) throw new Error('Invalid library program')
  const unknown = new Map(), unprescribed = new Map(), warnings = new Set()
  const isPrivate = privateSource(raw)
  const needsReview=new Set()
  if ((raw.rules?.instructions && typeof raw.rules.instructions === 'object') || (raw.libraryRules?.instructions && typeof raw.libraryRules.instructions === 'object')) needsReview.add('The source-document instruction index needs review; its authored guidance has not been translated.')
  const anyExerciseRules=list(raw.weeks).some(w=>list(w.days).some(d=>list(d.exercises).some(e=>list(e.rules).length)))
  const globalRules=programmeRuleText({instructions:raw.instructions,notes:raw.rules?.notes,
    rules:anyExerciseRules?[]:list(raw.rules?.progression_scripts).map(summary=>({kind:'progress',summary}))},raw)
  globalRules.reasons.forEach(reason=>needsReview.add(reason))
  const resolve = e => {
    const key = importExerciseKey(e), supplied = mappings[key] || e.id || e.opengym_id
    const explicit = mappings[key]
    const suppliedMatch = catalogue.find(x=>x.id===canonicalExId(supplied))
    if (suppliedMatch && (explicit || !e.equipment || norm(suppliedMatch.eq)===norm(e.equipment))) return suppliedMatch.id
    let matches = catalogue.filter(x=>norm(x.n)===norm(e.name))
    if (e.equipment) matches = matches.filter(x=>norm(x.eq)===norm(e.equipment))
    if (matches.length===1) return matches[0].id
    unknown.set(key,{key,name:e.name || supplied || '',equipment:e.equipment || ''})
    return null
  }
  let omitted = 0
  const weeks = numbered(raw.weeks.filter(w=>!w.placeholder && w.repeat_of == null)).map((w,wi)=>({
    index:wi+1, sourceWeek:String(w.n), mode:/deload/i.test(w.block_type || '')?'deload':'train',
    ...(/deload/i.test(w.block_type || '')?{deload:{authored:true,setsFactor:1,loadFactor:1}}:{}),
    days:numbered(w.days.filter(day=>{if (/cardio|conditioning/i.test(day.kind || '')) {omitted++;return false} return true}),true).map((day,di)=>({
      key:`d${day.n ?? di+1}`,ordinal:Number(day.n ?? di+1),sessions:[{sessionTemplateId:`d${day.n ?? di+1}:${day.kind || 'lift'}`,routineSnapshot:{name:day.name || `D${di+1}`,prog:'off',ex:list(day.exercises).flatMap((e,ei)=>{
        if (/cardio|conditioning/i.test(e.role || '')) {omitted++;return []}
        const exerciseKey=importExerciseKey(e)
        const open = e.open === true || /^sbs-/i.test(raw.id) && !list(e.sets).length && /accessory/i.test(e.name || e.role || '')
        const id = open ? null : resolve(e)
        if (!list(e.sets).length && positive(e.minutes)) return [{id,slotId:`day:${di+1}:slot:${e.slot || ei+1}`,mode:'time',sec:Number(e.minutes)*60,sets:1,weight:0,prog:'off',note:String(e.notes || ''),...(e.role?{role:e.role}:{}),...(e.target?{target:clone(e.target)}:{})}]
        let setRows=list(e.sets)
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
          for (const key of ['rir','rpe']) if (Array.isArray(s[key])) {
            if (s[key].length !== 2 || s[key].some(n=>typeof n !== 'number' || !Number.isFinite(n) || n<(key === 'rpe' ? 1 : 0) || n>10) || s[key][0]>s[key][1]) throw new Error('Invalid set target')
            needsReview.add(`An authored ${key.toUpperCase()} range needs a per-set target decision; the range is retained in instructions.`)
          }
          const reps=maxReps?'max':Number(s.reps_max ?? (range?Math.max(...range):s.reps))
          if (reps!=='max' && (!positive(reps) || !Number.isInteger(reps))) throw new Error('Invalid program prescription')
          return Array.from({length:count},()=>({reps:maxReps || s.amrap || s.kind==='amrap'?'max':reps,weight:load(s.weight),pct:Array.isArray(s.pct)?Math.min(...s.pct):s.pct,target:{...s.target,...(s.rir != null && !Array.isArray(s.rir)?{rir:Number(s.rir)}:{}),...(s.rpe != null && !Array.isArray(s.rpe)?{rpe:Number(s.rpe)}:{}),...(s.pct != null?{pct:Number(Array.isArray(s.pct)?Math.min(...s.pct):s.pct)}:{})},repsMin:s.reps_min ?? (range?Math.min(...range):null)}))
        })
        if (!rows.length) throw new Error('Invalid program prescription')
        if (rows.some(r=>r.pct!=null && !positive(r.pct))) throw new Error('Invalid percentage prescription')
        const configs=[], groups=[]
        for(const row of rows) {const last=groups.at(-1);if(last && (last[0].pct!=null)===(row.pct!=null))last.push(row);else groups.push([row])}
        for(const group of groups) for(let start=0;start<group.length;start+=10) {
          const chunk=group.slice(start,start+10), cfg={...(open ? {open:true,label:e.label || e.name || ''} : {id}),slotId:`day:${di+1}:slot:${e.slot || ei+1}:part:${configs.length+1}`,sets:chunk.length,reps:chunk[0].reps,prog:'off',pyramid:chunk.map(r=>r.reps),pyramidWeight:chunk.map(r=>r.weight),weight:chunk[0].weight,...(configs.length===0 && !isPrivate && e.sets != null ? {sourcePrescription:clone(e.sets)} : {}),...(unprescribed.has(exerciseKey)?{importNeedsPrescription:true}:{})}
          if (chunk.some(r=>r.repsMin!=null)) {
            cfg.setRepsMin=chunk.map(r=>r.repsMin ?? null)
            if (!cfg.tm && chunk.every(r=>r.pct==null && r.reps===chunk[0].reps && r.repsMin===chunk[0].repsMin && r.weight===chunk[0].weight)) {
              cfg.repsMin=Number(chunk[0].repsMin)
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
    })).filter(day=>day.sessions[0].routineSnapshot.ex.length).reduce((days,day)=>{const existing=days.find(d=>d.key===day.key);if(existing)existing.sessions.push(...day.sessions);else days.push(day);return days},[]),
  })).filter(w=>w.days.length)
  if (!weeks.length || weeks.length>64) throw new Error('A program needs between one and 64 explicit weeks.')
  if (weeks.some(w=>w.days.some(day=>day.sessions.length>1))) {warnings.add('Multiple sessions on one source day are queued separately. Review the schedule before loading.')}
  if (omitted) warnings.add('Cardio and conditioning were omitted; strength sessions are kept.')
  const definition={id:raw.id,name:raw.name,unit:raw.unit,weeks,source:{...raw.source,kind:'library',library:true,private:isPrivate},rulesSupported:!needsReview.size && !unknown.size && !unprescribed.size,needsReview:[...needsReview,...(unknown.size?['Resolve unknown exercises before saving the program.']:[]),...(unprescribed.size?['Enter sets and reps for unprescribed slots before saving.']:[])],...(globalRules.instructions?{instructions:globalRules.instructions}:{}),end:raw.end || 'next',...(raw.repeat?{repeat:clone(raw.repeat)}:{}),importWarnings:[...warnings]}
  for (const field of ['goal','level','daysPerWeek','lengthWeeks','equipment','licence','endPlan','scheduleReviewed']) if (raw[field] != null) definition[field]=clone(raw[field])
  if (!unknown.size && !unprescribed.size) validateProgrammeDefinition(definition,catalogue)
  return {definition,unknown:[...unknown.values()],unprescribed:[...unprescribed.values()],warnings:[...warnings],skipped:false}
}

/** Confirm saves a definition only. Activate/adopt remains a separate UI step. */
export function saveImportedProgramme(S, preview, {replace=false} = {}) {
  if (preview.skipped || preview.unknown.length) throw new Error('Resolve unknown exercises before saving the program.')
  if(preview.unprescribed?.length) throw new Error('Enter sets and reps for unprescribed slots before saving.')
  const d=validateProgrammeDefinition(preview.definition,[...CATALOGUE,...list(S.customEx)])
  const definitions=list(S.programmes?.definitions)
  if (definitions.some(x=>x.id===d.id) && !replace) throw new Error('A program with this id already exists. Confirm replacement first.')
  S.programmes={version:1,fork:'wilky/1',...S.programmes,cycles:list(S.programmes?.cycles),definitions:definitions.filter(x=>x.id!==d.id).concat(clone(d))}
  return d
}
