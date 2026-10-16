import type { EvaluateResult, PrescribedSet, ProgressionRule } from '../../../contract/domain/progression'
import type { OpenGymProgrammeDefinition } from '../../../contract/domain/programme-model.generated'
import { EXIDX, isAssisted, type ExerciseIndex } from '../exercises'
import { validateProgression } from '../progression-validate'
import { programmeSchemaIssues } from '../programme-model-schema'
import { authoredSlots, cmp, sameSeries, weekDate } from './replay'
import { buildTmTimeline } from './tm'
import { authoredSets, authoredCount, parseAuthoredReps, isLoadRule, loadSets } from './rules'
import { roundLoad } from './rounding'
import { buildWhy } from './why'
import { InvalidLoadError, checkedLoad } from './units'
import { replayExposures } from './replay'
import type { EngineInput, EngineExtensions, EngineResult, RuleContext } from './types'
import type { Profile } from '../progression'
import { rpeLoad } from './rpe'
import { adaptiveTimeline } from './adaptive-tm'
import { applyStall } from './stall'
import { continuityExposures, compatibleLoadContinuity } from './continuity'
export { rpeLoad } from './rpe'
export { adaptiveTimeline } from './adaptive-tm'
export { applyStall, stallEvents } from './stall'
/** P4 can add volume/deload phases while the built-in P3 handlers remain installed. */
export const p3Extensions: EngineExtensions = { load: rpeLoad, timeline: adaptiveTimeline, stall: applyStall }
import { volumeSetCount } from './volume'
import { scheduledDeload, progressionExposures } from './deload'
export * from './types'
export { authoredSlots, replayExposures, sameSeries, weekDate } from './replay'
export { buildTmTimeline, tmAt } from './tm'
export { roundLoad, chooseLoad } from './rounding'
export { buildWhy } from './why'
export { convertWeightPrecise, LB_PER_KG } from './units'
export { exposureSuccess, replayLoad, authoredSets, parseAuthoredReps, isLoadRule } from './rules'
export { rampSlots, distributeSets, missedRepFloor, slotKey, volumeSetCount } from './volume'
export { scheduledDeload, progressionExposures } from './deload'
export { preview, type PreviewInput } from './preview'

/** Pure evaluation; extensions implement P3/P4 phases, every load rounds exactly once last. */
export function evaluate(input: EngineInput, extensions: EngineExtensions = {}, index: ExerciseIndex = EXIDX): EngineResult {
  extensions={...p3Extensions,...extensions}
  try { return evaluateChecked(input,extensions,index) } catch (error) {
    if (!(error instanceof InvalidLoadError)) throw error
    return {weeks:[],tm:{},warnings:[{code:'load.invalid',message:error.message}],error:{code:'INVALID_LOAD',message:error.message}}
  }
}
function evaluateChecked(input: EngineInput, extensions: EngineExtensions, index: ExerciseIndex): EngineResult {
  const result: EngineResult={weeks:[],tm:{},warnings:[]}
  const structural=programmeSchemaIssues(input.definition)
  if (structural.length) {
    result.error={code:'INVALID_DEFINITION',issues:structural}
    result.warnings=structural.map(i=>({code:'definition.invalid',message:`${i.path}: ${i.message}`}))
    return result
  }
  const validation=validateProgression(input.definition,index)
  const unsupportedRefs=validation.issues.filter(i=>i.code==='rule.reps-unsupported').map(i=>i.ref)
  const blockingIssues=validation.issues.filter(i=>i.code!=='rule.reps-unsupported')
  if (blockingIssues.length) {
    result.error={code:'INVALID_RULES',issues:validation.issues}
    result.warnings=validation.issues.map(i=>({code:i.code,message:i.fix,...(i.ref && i.ref.week !== undefined && i.ref.day && i.ref.session && i.ref.slot ? {ref:i.ref as Required<typeof i.ref>} : {})})).sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)))
    return result
  }
  const d=input.definition as OpenGymProgrammeDefinition, slots=authoredSlots(d), exposures=progressionExposures(d,replayExposures(input,slots,result.warnings))
  const rules=new Map<string,ProgressionRule>((d.progressionRules ?? []).map(r=>[r.id,r as ProgressionRule]))
  const unsupportedAmrap=[...rules.values()].filter(r=>r.kind==='amrap-tm' && slots.some(s=>s.ref.week===r.source.slot.week && sameSeries(s.ref,r.source.slot) && isAssisted(s.slot.id,index)))
  // An undefined assisted AMRAP source must not change any shared TM, even if its
  // source slot has no attached load rule. Other timeline rules still execute.
  const timelineInput=unsupportedAmrap.length ? {...input,definition:{...d,progressionRules:(d.progressionRules ?? []).filter(r=>!unsupportedAmrap.some(u=>u.id===r.id))}} : input
  result.tm=buildTmTimeline(input,slots,exposures,result.warnings)
  if (extensions.timeline) result.tm=extensions.timeline(timelineInput,slots,exposures,result.tm,index)
  else if ((timelineInput.definition as OpenGymProgrammeDefinition).progressionRules?.some(r=>r.kind==='amrap-tm' || r.kind==='stall' && r.appliesTo==='tm')) result.warnings.push({code:'rule.unsupported',message:'Install the TM timeline evaluator before applying AMRAP or TM stall rules.'})
  let liveHistory: {input: EngineInput; exposures: typeof exposures; warnings: EngineResult['warnings']} | undefined
  for (const week of [...new Set(input.weeks)].sort((a,b)=>a-b)) {
    const out: EvaluateResult['weeks'][number]={index:week,slots:[]}
    for (const authored of slots.filter(s=>s.ref.week===week)) {
      const attached=(authored.slot.progression?.rules ?? []).map(id=>rules.get(id)!).filter(Boolean)
      const loadRule=attached.find(isLoadRule), date=weekDate(input,week)
      if (isAssisted(authored.slot.id,index) && (loadRule?.kind==='percentage' || loadRule?.kind==='rpe-load' || unsupportedAmrap.some(r=>r.kind==='amrap-tm' && sameSeries(r.source.slot,authored.ref)))) {
        (result.slotErrors ??= []).push({code:'UNSUPPORTED_ASSISTED',slot:authored.ref})
        result.warnings.push({code:'rule.assisted-unsupported',ref:authored.ref,message:'Percentage, RPE-load and AMRAP-TM rules have no defined assisted-load semantics; choose linear or double progression.'})
        continue
      }
      if (!attached.length) continue // No computed prescription; authored text stays with the caller.
      if (unsupportedRefs.some(r=>r?.week===authored.ref.week && r.day===authored.ref.day && r.session===authored.ref.session && r.slot===authored.ref.slot) || Array.from({length:authoredCount(authored)},(_,i)=>authored.slot.pyramid?.[i] ?? authored.slot.reps).some(r=>!parseAuthoredReps(r,loadRule?.kind==='double'))) {
        (result.slotErrors ??= []).push({code:'UNSUPPORTED_REPS',slot:authored.ref})
        continue
      }
      // W29's separate prescriptionAsOf remains on the spread input. Only the
      // opted-in compatible load context gets the wider exposure date; shared TM
      // replay and ordinary slots retain the historical preview cutoff.
      const live=input.communityPreviewHistory && week===input.cycle?.weekIndex && compatibleLoadContinuity(d,authored)
      if (live && !liveHistory) {
        const widerInput={...input,...input.communityPreviewHistory}, warnings: EngineResult['warnings']=[]
        liveHistory={input:widerInput,exposures:progressionExposures(d,replayExposures(widerInput,slots,warnings)),warnings}
      }
      const historyInput=live ? liveHistory!.input : input, historyExposures=live ? liveHistory!.exposures : exposures
      if (live) result.warnings.push(...liveHistory!.warnings.filter(w=>w.ref && w.ref.week===authored.ref.week && sameSeries(w.ref,authored.ref)))
      const prior=continuityExposures(historyInput,authored,historyExposures).filter(e=>(!date || week >= (input.cycle?.weekIndex ?? week) || e.date<date))
      const context=(rule:ProgressionRule): RuleContext=>({input:historyInput,definition:d,authored,rule,exposures:prior,allExposures:historyExposures,tm:result.tm,index,warnings:result.warnings})
      let count=authoredCount(authored)
      const slotWhy: EvaluateResult['weeks'][number]['slots'][number]['why']=[]
      for (const r of attached.filter(r=>r.kind==='volume-ramp' || r.kind==='scheduled-deload')) {
        const change=(extensions.setCount ?? volumeSetCount)(context(r),count); count=checkedLoad(change.count);slotWhy.push(...change.why)
      }
      let sets: PrescribedSet[]=authoredSets(authored,d.unit,input.profile.effortScale,authoredCount(authored),loadRule?.kind==='double')
      let applied=false
      if (loadRule) {
        const loaded=loadSets(context(loadRule)) ?? extensions.load?.(context(loadRule))
        if (loaded) {sets=loaded;applied=true}
        else if (loadRule.kind==='rpe-load') result.warnings.push({code:'rule.unsupported',ref:authored.ref,message:'Install the rpe-load evaluator before applying this rule.'})
      }
      // Repeat the last valid authored/load row, including pyramid-only target prescriptions.
      if (count !== authoredCount(authored) && sets.length) sets=Array.from({length:Math.max(0,Math.min(100,count))},(_,i)=>structuredClone(sets[Math.min(i,sets.length-1)]!))
      const stallId=authored.slot.progression?.onStall, stall=stallId ? rules.get(stallId) : undefined
      if (applied && stall) {
        if (extensions.stall) sets=extensionLoads(context(stall),sets,extensions.stall)
        else result.warnings.push({code:'rule.unsupported',ref:authored.ref,message:'Install the stall evaluator before applying this rule.'})
      }
      for (const r of attached.filter(r=>r.kind==='scheduled-deload')) sets=extensionLoads(context(r),sets,extensions.deload ?? scheduledDeload)
      sets=sets.map(s=>{
        if (s.load === null) return {...s,unit:input.profile.unit}
        if (!loadRule || !('rounding' in loadRule)) return {...s,load:null,unit:input.profile.unit}
        const rounded=roundLoad(s.load,d.unit,loadRule.rounding,input.profile as Profile & {unit:'lb'|'kg'},{...authored.slot,id:authored.slot.id ?? undefined} as import('../progression').Config,index)
        if (rounded.inputs.inventoryWarning) result.warnings.push({code:'rounding.large-adjustment',ref:authored.ref,message:'Owned inventory moves the load beyond the rounding tolerance; review the prescribed load.'})
        if (rounded.load===null) result.warnings.push({code:'rounding.unavailable',ref:authored.ref,message:'No owned load is available in the requested rounding direction.'})
        return {...s,load:rounded.load,unit:input.profile.unit,why:[...s.why,buildWhy(loadRule.id,loadRule.kind,rounded.inputs)]}
      })
      out.slots.push({ref:authored.ref,...(authored.slot.id?{exerciseId:authored.slot.id}:{}),sets,why:slotWhy})
    }
    if (d.weeks.some(w=>w.index===week)) result.weeks.push(out)
    else result.warnings.push({code:'week.missing',message:`Week ${week} is not authored.`})
  }
  // Canonical scalar/map ordering also applies to third-party extension output.
  assertFinite(result)
  return canonical(result) as EngineResult
}
/** P3/P4 return ordinary-direction loads; P2 reflects their deltas for assistance. */
function extensionLoads(context: RuleContext, sets: PrescribedSet[], handler: NonNullable<EngineExtensions['stall']>): PrescribedSet[] {
  const before=sets.map(s=>s.load)
  const changed=handler(context,sets)
  if (!isAssisted(context.authored.slot.id,context.index)) return changed
  return changed.map((s,i)=>{
    // Repeat/reset can be anchored to a prior actual load instead of the
    // progressed prescription. Reflect around that same anchor exactly once.
    const actual=context.rule.kind==='stall' ? s.why.findLast(w=>w.ruleId===context.rule.id && w.kind==='stall' && typeof w.inputs.actualLoad==='number')?.inputs.actualLoad : undefined
    const base=typeof actual==='number' ? actual : i<before.length ? before[i] : before.at(-1)
    if (base == null || s.load === null) return s
    const delta=checkedLoad(checkedLoad(s.load)-checkedLoad(base))
    const load=Math.max(0,checkedLoad(base-delta))
    if (delta===0) return s
    return {...s,load,why:[...s.why,buildWhy(context.rule.id,context.rule.kind,{assisted:true,loadBefore:base,loadAfter:load})]}
  })
}
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>cmp(a,b)).map(([k,v])=>[k,canonical(v)]))
  return value
}

function assertFinite(value: unknown): void {
  if (typeof value === 'number') checkedLoad(value)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) assertFinite(item)
}
