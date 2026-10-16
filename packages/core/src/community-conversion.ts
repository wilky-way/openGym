import { bindCommunitySource, communityAdmissionProblem } from './community-admission'
import type { LinearRule, DoubleRule, StallRule, Rounding, SlotRef } from '../../contract/domain/progression'
import type { OpenGymProgrammeDefinition, Slot } from '../../contract/domain/programme-model.generated'
import { authoredSlots, record } from './progression-engine/replay'
import { convertWeightPrecise } from './progression-engine/units'
import { createSha256 } from './sha256'
import { validateProgression } from './progression-validate'
import { programmeSchemaIssues } from './programme-model-schema'
import { validateProgrammeDefinition } from './programme-validate'
import { CATALOGUE, EXIDX, type ExerciseIndex } from './exercises'

type Unit = 'kg' | 'lb'
type CommunityRule = LinearRule | DoubleRule | StallRule
export interface ScriptConversion {
  status: 'supported' | 'manual' | 'unsupported'
  reason: string
  rules: CommunityRule[]
  repProgression?: 'step'
}
const unsupported = (reason: string): ScriptConversion => ({status:'unsupported',reason,rules:[]})
const integer = (v: string | undefined, fallback: number) => v === undefined || v === '' ? fallback : /^\d+$/.test(v) ? Number(v) : NaN

/** Whitelist parser, never eval: custom/update code is deliberately not translated. */
export function convertCommunityScript(script: string, unit: Unit, id: string, rounding?: Rounding, update?: string): ScriptConversion {
  if (update && update.trim() !== 'none') return unsupported('Update scripts require a reviewed state machine; no code was executed.')
  const text=script.trim()
  if (text === 'none') return {status:'manual',reason:'Source explicitly disables progression.',rules:[]}
  const match=/^(lp|dp)\(([^()]*)\)$/.exec(text)
  if (!match) return unsupported('Only ordinary lp/dp built-ins are supported; custom, sum, reuse and unknown scripts need separate review.')
  const args=match[2]!.split(',').map(s=>s.trim()), weight=/^(\d+(?:\.\d+)?)\s*(kg|lb)$/.exec(args[0] ?? '')
  if (!weight || (match[1] === 'lp' ? args.length>6 : args.length!==3)) return unsupported('Use an explicit absolute kg/lb increment and supported argument count; percentage increases are not equivalent.')
  const increment=convertWeightPrecise(Number(weight[1]),weight[2] as Unit,unit)
  if (!(increment>0 && increment<=100)) return unsupported('Increment is outside engine limits.')
  const grid=rounding ?? {increment,mode:'nearest' as const,usePlates:false}
  if (match[1] === 'dp') {
    const low=integer(args[1],NaN), high=integer(args[2],NaN)
    if (!(low>=1 && high<=100 && low<=high)) return unsupported('Double progression needs ordered integer endpoints from 1 to 100.')
    return {status:'supported',reason:'All sets progress reps to the high endpoint, then add load and reset reps.',repProgression:'step',rules:[
      {id,kind:'double',repsLow:low,repsHigh:high,condition:'all-sets',increment,unit,afterIncrease:'reset-to-low',rounding:grid},
    ]}
  }
  const sessions=integer(args[1],1), successCounter=integer(args[2],0), failureCounter=integer(args[5],0)
  if (!(sessions>=1 && Number.isSafeInteger(sessions)) || successCounter!==0 || failureCounter!==0) return unsupported('Nonzero initial counters and invalid attempt counts cannot be replayed from an immutable empty history.')
  const rules: CommunityRule[]=[{id,kind:'linear',increment,unit,every:{sessions},success:'all-sets-all-reps',rounding:grid}]
  if (args[3]) {
    const decrease=/^(\d+(?:\.\d+)?)%$/.exec(args[3]), after=integer(args[4],1)
    if (!decrease || !(Number(decrease[1])>0 && Number(decrease[1])<=50 && after>=1 && after<=10)) return unsupported('Only percentage load resets (up to 50%) after 1–10 misses are supported; absolute decrements require another rule.')
    rules.push({id:`${id}-stall`,kind:'stall',after,action:{kind:'reset',pct:1-Number(decrease[1])/100},appliesTo:'load'})
  } else if (args[4]) return unsupported('Failure attempts without a decrement have no mapped semantics.')
  return {status:'supported',reason:'All prescribed work sets must reach their targets; misses hold load or trigger the authored reset.',rules}
}

/** Exact summaries emitted by the existing structure-only importer; no prose guessing. */
export function communityScriptFromSummary(summary: string): string | undefined {
  if (summary === 'progress: none (progression disabled)') return 'none'
  const lp=/^linear: add (.+) after (\d+) successful session\(s\)(?:; subtract (.+) after (\d+) failed session\(s\))?$/.exec(summary)
  if (lp) return `lp(${lp[1]}, ${lp[2]}, 0${lp[3] ? `, ${lp[3]}, ${lp[4]}, 0` : ''})`
  const dp=/^double progression: reps (\d+)-(\d+); at the top add (.+) and reset reps to (\d+)$/.exec(summary)
  if (dp && dp[1] === dp[4]) return `dp(${dp[3]}, ${dp[1]}, ${dp[2]})`
  return undefined
}

export interface CommunityExercise {
  slot?: string | number; name?: string; equipment?: string; label?: string
  rules?: {kind: string; summary?: string; script?: string; [key:string]:unknown}[]
  [key:string]:unknown
}
export interface CommunitySource {
  id: string; length_weeks?: number; source?: Record<string,string|boolean|null>
  rules?: {frequency?: number|null; goal?: string; [key:string]:unknown}
  weeks: {n: string|number; repeat_of?: unknown; days: {n: string|number; kind?: string; exercises: CommunityExercise[]}[]}[]
  [key:string]:unknown
}
export interface CommunityBinding {ref: SlotRef; sourceWeek: string; sourceDay: string; sourceKind?: string; sourcePosition: number}
export interface CommunityRepairOptions {
  bindings?: CommunityBinding[]
  rounding?: Rounding
  /** Explicit athlete input only, keyed by continuity key reported by the plan. */
  athleteLoads?: Record<string,number>
  maxBasis?: '1rm'|'tm'|'e1rm'
  /** A source-template rotation; only needed when native day count differs from frequency. */
  rotation?: string[]
}
export interface RepairIssue {code: string; message: string; ref?: SlotRef}
export interface CommunityRepairPlan {
  schema:'opengym-community-repair/1'; id:string; beforeHash:string; sourceHash:string
  status:'reviewable'|'blocked'; definition:OpenGymProgrammeDefinition
  slots:{ref:SlotRef;continuityKey?:string;status:ScriptConversion['status'];reason:string}[]
  issues:RepairIssue[]; changes:string[]
}
export const communityHash = (value: unknown) => createSha256().update(new TextEncoder().encode(JSON.stringify(value))).hex()

function scriptFor(e: CommunityExercise): {script?:string;update?:string;problem?:string} {
  const rules=e.rules ?? []
  if (!Array.isArray(rules) || rules.some(r=>!r || typeof r!=='object' || Array.isArray(r) || Object.keys(r).some(k=>!['kind','script','summary','notes','source','provenance','extension','extensions'].includes(k)) || r.script!==undefined && typeof r.script!=='string' || r.summary!==undefined && typeof r.summary!=='string')) return {problem:'Source rule fields are unsupported or ambiguous.'}
  const progress=rules.filter(r=>r.kind==='progress'), updates=rules.filter(r=>r.kind==='update')
  if (progress.length>1 || updates.length>1 || rules.some(r=>!['progress','update'].includes(r.kind))) return {problem:'Source variations, structural rules or ambiguous scripts require manual review.'}
  const p=progress[0], u=updates[0]
  if (u?.script!==undefined && u.summary!==undefined && u.script.trim()!==u.summary.trim()) return {problem:'Source update script and summary disagree.'}
  if (p?.script && p.summary) {
    const summary=communityScriptFromSummary(p.summary)
    if (!summary || JSON.stringify(convertCommunityScript(p.script,'lb','binding'))!==JSON.stringify(convertCommunityScript(summary,'lb','binding'))) return {problem:'Source script and summary disagree.'}
  }
  return {script:p?.script ?? (p?.summary ? communityScriptFromSummary(p.summary) : undefined),update:u?.script ?? u?.summary,
    ...(!p ? {problem:'No explicit source progression script; no rule was invented.'} : {})}
}

/** Reconstruct AMRAP success floors from the bound source, never from display text.
 * The native importer may retain `max` while losing the source's numeric minimum. */
function restoreAmrapFloors(slot: Slot, rows: Record<string,unknown>[], kind: string): string | undefined {
  const amrap=(r: Record<string,unknown>)=>r.amrap===true || r.kind==='amrap' || r.reps==='max' || r.reps==='amrap'
  const native=Array.from({length:slot.pyramid?.length ?? slot.sets},(_,i)=>slot.pyramid?.[i] ?? slot.reps)
  if (!rows.some(amrap) && !native.some(r=>r==='max' || r==='amrap')) return
  if (kind!=='linear') return 'AMRAP rows require a reviewed linear success rule; other load rules would discard AMRAP semantics.'
  const expanded=rows.flatMap(r=>{
    const count=r.count ?? 1
    return typeof count==='number' && Number.isInteger(count) && count>=1 && count<=100 ? Array.from({length:count},()=>r) : []
  })
  if (expanded.length!==native.length) return 'AMRAP source counts cannot be matched faithfully to native rows.'
  const floors=expanded.map((r,i)=>amrap(r) ? r.reps_min ?? r.reps : slot.setRepsMin?.[i] ?? null)
  for (const [i,r] of expanded.entries()) {
    if (amrap(r)) {
      const floor=floors[i]
      if (!['max','amrap'].includes(String(native[i])) || typeof floor!=='number' || !Number.isInteger(floor) || floor<1 || floor>100)
        return 'Each source AMRAP row needs an explicit numeric success minimum from 1 to 100 and a matching native AMRAP row.'
    } else {
      const expected=r.reps_max ?? (Array.isArray(r.reps) ? Math.max(...r.reps.map(Number)) : r.reps)
      if (typeof expected!=='number' || expected!==native[i]) return 'Mixed straight/AMRAP source rows do not match the native prescription.'
    }
  }
  slot.setRepsMin=floors as Slot['setRepsMin']
  if (expanded.every(amrap) && floors.every(n=>n===floors[0])) slot.repsMin=floors[0] as number
  else delete slot.repsMin
}

/** Pure, additive repair proposal. Unsupported slots block local apply, never claim Ready. */
export function planCommunityRepair(input: OpenGymProgrammeDefinition, source: CommunitySource, options: CommunityRepairOptions={}, index: ExerciseIndex=EXIDX): CommunityRepairPlan {
  const d=structuredClone(input), issues:RepairIssue[]=[], changes:string[]=[], slots:CommunityRepairPlan['slots']=[]
  const plan:CommunityRepairPlan={schema:'opengym-community-repair/1',id:d.id,beforeHash:communityHash(input),sourceHash:communityHash(source),status:'blocked',definition:d,slots,issues,changes}
  const issue=(code:string,message:string,ref?:SlotRef)=>issues.push({code,message,...(ref?{ref}: {})})
  if (/^(bbm|sbs|rp)-/i.test(source.id) || source.id==='pub-barbell-medicine-the-bridge') {issue('family.deferred','Paid/private method conversion is deferred; this tool handles community built-ins only.');return plan}
  if (source.id!==d.id) {issue('source.identity','Definition and source IDs differ.');return plan}
  if (programmeSchemaIssues(d).length) {issue('definition.invalid','Input must be a structurally valid native definition.');return plan}
  if (d.progressionRules?.length || authoredSlots(d).some(a=>a.slot.progression?.rules?.length)) {issue('rules.existing','Existing executable rules require a separate reviewed migration; they were preserved.');return plan}
  let ruleNumber=0
  const rules:CommunityRule[]=[], groups=new Map<string,{script:string;decision:ScriptConversion}>()
  const authored=authoredSlots(d), bound=authored.map(a=>bindCommunitySource(d,source,a.ref,options.bindings))
  for (const [i,a] of authored.entries()) {
    const binding=bound[i], e=binding?.exercise
    const peers=authored.flatMap((peer,j)=>peer.ref.week===a.ref.week && peer.ref.day===a.ref.day && peer.ref.session===a.ref.session ? [bound[j]] : [])
    const ordered=!!binding && peers.length===binding.total && peers.every((b,j)=>b?.key===binding.key && b.position===j+1)
    const group=e && communityHash([e.name,e.equipment,e.label]).slice(0,24)
    let decision:ScriptConversion, script:string|undefined
    if (!e || !e.name) decision=unsupported('No unique source-slot binding; provide an explicit source position.')
    else {
      const parsed=scriptFor(e);script=parsed.script
      decision=parsed.problem ? unsupported(parsed.problem) : script===undefined ? unsupported('Unrecognized or custom source script; retained for manual conversion.') : convertCommunityScript(script,d.unit,`community-${++ruleNumber}`,options.rounding,parsed.update)
      const previous=groups.get(group!)
      if (previous && previous.script!==script) decision=unsupported('Same source exercise/label has conflicting progression scripts.')
      else if (previous && decision.status==='supported') decision=previous.decision
      else if (script!==undefined) groups.set(group!,{script,decision})
    }
    // Imported example loads are never personalized defaults, even on manual candidates.
    const varyingLoads=a.slot.pyramidWeight && new Set(a.slot.pyramidWeight).size>1
    const sourceRows=Array.isArray(e?.sets) ? e.sets.map(record).filter(row=>row.kind!=='warmup') : []
    const sourceCount=sourceRows.reduce((sum,row)=>sum+(typeof row.count==='number' ? row.count : row.count==null ? 1 : NaN),0)
    delete a.slot.weight;delete a.slot.pyramidWeight;a.slot.prog='off'
    if (decision.status==='supported') {
      if (!a.slot.id || a.slot.open || a.slot.tm || a.slot.generatedRules?.length || varyingLoads || sourceCount!==(a.slot.pyramid?.length ?? a.slot.sets) || a.slot.mode && a.slot.mode!=='reps') decision=unsupported('Open, percentage, generated, varying-load, split, timed or conditional prescriptions require a separate conversion.')
      else {
        const problem=communityAdmissionProblem(a.slot,e!,decision.rules[0]!,index) ?? (!ordered ? 'Source/native exercise coverage, binding or order disagrees.' : undefined) ?? restoreAmrapFloors(a.slot,sourceRows,decision.rules[0]!.kind)
        if (problem) decision=unsupported(problem)
      }
      if (decision.status==='supported') {
        const load=decision.rules[0]!, stall=decision.rules.find(r=>r.kind==='stall')
        if (!rules.some(r=>r.id===load.id)) rules.push(...decision.rules)
        const key=`community-${group}`
        a.slot.progression={...a.slot.progression,kind:load.kind==='double'?'double':'linear',instructions:decision.reason,rules:[load.id],
          ...(stall?{onStall:stall.id}:{}),parameters:{...a.slot.progression?.parameters,continuityKey:key,...(decision.repProgression?{repProgression:decision.repProgression}:{})}}
        a.slot.prog='off'
        if (options.athleteLoads && Object.hasOwn(options.athleteLoads,key)) {
          const value=options.athleteLoads[key]
          if (typeof value!=='number' || !Number.isFinite(value) || value<=0) issue('load.invalid','Athlete starting loads must be finite positive definition-unit values.',a.ref)
          else a.slot.weight=value
        }
      }
    }
    if (decision.status==='unsupported') issue('script.unsupported',decision.reason,a.ref)
    slots.push({ref:a.ref,...(group?{continuityKey:`community-${group}`}:{ }),status:decision.status,reason:decision.reason})
  }
  d.progressionRules=rules
  const declared=source.length_weeks ?? source.weeks.filter(w=>w.repeat_of==null).length
  if (declared!==d.weeks.length) issue('metadata.length','Source length and native authored weeks disagree; no missing weeks were invented.')
  d.lengthWeeks=Math.max(...d.weeks.map(w=>w.index))
  if (source.rules?.goal) d.goal=source.rules.goal
  d.source={...source.source,...d.source,family:'community'}
  if (options.maxBasis) {
    if (!['1rm','tm','e1rm'].includes(options.maxBasis)) issue('metadata.max-basis','Use an explicitly verified 1rm, tm or e1rm basis.')
    else d.maxBasis=options.maxBasis
  }
  for (const key of Object.keys(options.athleteLoads ?? {})) if (!slots.some(s=>s.continuityKey===key)) issue('load.unknown-key','An athlete load references an unknown source continuity key.')
  const frequency=source.rules?.frequency
  if (!Number.isInteger(frequency) || frequency!<1 || frequency!>7) issue('metadata.frequency','An explicit source frequency from 1 to 7 is required.')
  else {
    d.daysPerWeek=frequency!
    if (d.weeks.some(w=>w.days.length!==frequency)) {
      if (d.weeks.length!==1 || d.weeks[0]!.days.some(day=>day.sessions.length!==1)) issue('schedule.unsupported','Only one-week, single-session rotations can be expanded automatically.')
      else {
        const original=d.weeks[0]!, rotation=options.rotation ?? original.days.map(day=>day.key)
        if (!rotation.length || rotation.some(key=>original.days.filter(day=>day.key===key).length!==1)) issue('schedule.rotation','Rotation must reference unique existing template day keys.')
        else {
          // LCM closes A/B at 3/week after two weeks: A B A / B A B.
          let count=1;while ((count*frequency!)%rotation.length!==0) count++
          if (count>64) issue('schedule.limit','Rotation exceeds the 64-week model bound.')
          else {
            d.weeks=Array.from({length:count},(_,wi)=>({...structuredClone(original),index:wi+1,days:Array.from({length:frequency!},(_,di)=>{
              const key=rotation[(wi*frequency!+di)%rotation.length]!, day=structuredClone(original.days.find(day=>day.key===key)!)
              return {...day,key:`d${di+1}`,ordinal:di+1,sessions:day.sessions.map(s=>({...s,sessionTemplateId:`rotation-${key}`,routineSnapshot:{...s.routineSnapshot,ex:s.routineSnapshot.ex.map(e=>({...e,slotId:`rotation-${key}:${e.slotId}`}))}}))}
            })})) as typeof d.weeks
            d.lengthWeeks=count
            d.source={...d.source,authoredLengthWeeks:String(declared)}
            changes.push(`Expanded ${rotation.length} source templates to ${frequency} sessions/week over ${count} repeating calendar week(s).`)
          }
        }
      }
    }
  }
  d.end='repeat';d.endPlan={...d.endPlan,kind:'repeat',instructions:'Repeat this rotation, retaining the source-slot load progression from completed sessions.'}
  // Keep original warnings and needsReview: a conversion proposal is not conformance approval.
  d.rulesSupported=false
  const validation=validateProgression(d,index)
  for (const v of validation.issues) issue(v.code,v.fix)
  try {validateProgrammeDefinition(d, [...CATALOGUE,...Object.values(index)],index)} catch (error) {issue('definition.invalid',error instanceof Error ? error.message : String(error))}
  changes.push('Attached only whitelisted executable progressionRules; legacy prog stays off.','Removed imported example loads; first load is athlete-chosen unless explicitly supplied.','Preserved extension data, private provenance, warnings and review requirements.')
  plan.status=issues.length ? 'blocked' : 'reviewable'
  return plan
}

/** Local apply guard. Callers supply the current source and definition, never just trust JSON. */
export function applyCommunityRepair(input: OpenGymProgrammeDefinition, source: CommunitySource, plan: CommunityRepairPlan, options:CommunityRepairOptions={}, index:ExerciseIndex=EXIDX): OpenGymProgrammeDefinition {
  if (plan.beforeHash!==communityHash(input) || plan.sourceHash!==communityHash(source)) throw new Error('Stale repair manifest: source or definition changed.')
  const fresh=planCommunityRepair(input,source,options,index)
  if (fresh.status!=='reviewable') throw new Error('Repair is blocked; resolve unsupported source rules and metadata first.')
  if (JSON.stringify(fresh)!==JSON.stringify(plan)) throw new Error('Repair manifest differs from the deterministic proposal; regenerate and review it.')
  return structuredClone(fresh.definition)
}
