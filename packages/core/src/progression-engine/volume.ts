import type { SlotRef, VolumeRampRule, Why } from '../../../contract/domain/progression'
import { EXIDX, exOr, type ExerciseIndex } from '../exercises'
import { musclesOf } from '../muscles'
import type { OpenGymProgrammeDefinition } from '../../../contract/domain/programme-model.generated'
import { authoredSlots, finite, list, record } from './replay'
import { parseAuthoredReps, authoredCount, requiredCount } from './rules'
import type { AuthoredSlot, Exposure, RuleContext } from './types'
import { buildWhy } from './why'

/** Exact authored occurrence identity. Series matching is deliberately not used for scope. */
export const slotKey = (ref: SlotRef): string => JSON.stringify([ref.week,ref.day,ref.session,ref.slot])

/** Muscle metadata determines membership, not fractional credit against an integer set budget. */
export function rampSlots(definition: OpenGymProgrammeDefinition, rule: VolumeRampRule, week: number, index: ExerciseIndex = EXIDX): AuthoredSlot[] {
  return authoredSlots(definition).filter(a=>a.ref.week===week && a.slot.progression?.rules?.includes(rule.id) && (
    'slots' in rule.scope
      ? rule.scope.slots.some(ref=>slotKey(ref)===slotKey(a.ref))
      : rule.scope.muscles.some(m=>Number(musclesOf(a.slot.id ? exOr(a.slot.id,index) : undefined)[m])>0)
  ))
}

/** Hamilton allocation preserves the exact integer budget; ties use authored order. */
export function distributeSets(slots: AuthoredSlot[], budget: number, mode: VolumeRampRule['distribute']): number[] {
  if (!slots.length) return []
  if (mode==='round-robin-by-slot-order') return slots.map((_,i)=>Math.floor(budget/slots.length)+(i<budget%slots.length?1:0))
  const total=slots.reduce((n,a)=>n+authoredCount(a),0)
  const shares=slots.map(a=>budget*authoredCount(a)/total), counts=shares.map(Math.floor)
  const order=shares.map((value,i)=>({i,remainder:value-counts[i]!})).sort((a,b)=>b.remainder-a.remainder || a.i-b.i)
  const left=budget-counts.reduce((n,c)=>n+c,0)
  for (const {i} of order.slice(0,left)) counts[i]=counts[i]!+1
  return counts
}

/** Compare done work against its logged prescription, then that exact authored week's floor. */
export function missedRepFloor(exposure: Exposure, authored: AuthoredSlot): boolean {
  const target=record(exposure.target), count=requiredCount(exposure,authored)
  const rowReps=list(target.rowReps), per=rowReps.length ? rowReps : list(target.pyramid)
  for (let i=0;i<count;i++) {
    const logged=parseAuthoredReps(per[i] ?? target.reps,true)
    const authoredReps=parseAuthoredReps(authored.slot.pyramid?.[i] ?? authored.slot.reps,true)
    const minimum=(value: unknown): number | undefined=>{
      const parsed=parseAuthoredReps(value)
      return typeof parsed?.reps==='number' ? parsed.reps : undefined
    }
    const floor=minimum(list(target.rowRepsMin ?? target.setRepsMin)[i]) ?? minimum(target.repsMin)
      ?? logged?.min ?? (typeof logged?.reps==='number' ? logged.reps : undefined)
      ?? minimum(authored.slot.setRepsMin?.[i] ?? authored.slot.repsMin)
      ?? authoredReps?.min ?? (typeof authoredReps?.reps==='number' ? authoredReps.reps : undefined)
    const actual=finite(exposure.sets.find(s=>s.workIndex===i)?.r)
    if (floor===undefined || actual===undefined || actual<floor) return true
  }
  return false
}

export function volumeSetCount(context: RuleContext, count: number): {count:number;why:Why[]} {
  const {rule,input,authored,definition,index}=context
  if (rule.kind!=='volume-ramp' || !rule.weeks.includes(authored.ref.week)) return {count,why:[]}
  const scoped=rampSlots(definition,rule,authored.ref.week,index)
  const position=scoped.findIndex(a=>slotKey(a.ref)===slotKey(authored.ref))
  if (position<0) return {count,why:[]}
  const priorWeeks=rule.weeks.filter(w=>w<authored.ref.week)
  let holds=0
  if (rule.holdIfMissedReps) for (const week of priorWeeks) {
    const sources=rampSlots(definition,rule,week,index)
    const missed=context.allExposures.some(e=>e.week===week && sources.some(a=>slotKey(a.ref)===slotKey(e.ref) && missedRepFloor(e,a)))
    if (missed) holds++
  }
  const increases=priorWeeks.length-holds
  const budget=Math.min(rule.maxSets,rule.startSets+rule.addPerWeek*increases)
  const allocated=distributeSets(scoped,budget,rule.distribute)[position]!
  return {count:allocated,why:[buildWhy(rule.id,rule.kind,{
    week:authored.ref.week,sets:budget,slotSets:allocated,startSets:rule.startSets,addPerWeek:rule.addPerWeek,maxSets:rule.maxSets,
    distribute:rule.distribute,slots:scoped.length,slotOrder:position,authoredSets:authoredCount(authored),increases,holds,
    holdIfMissedReps:rule.holdIfMissedReps,scope:'muscles' in rule.scope ? rule.scope.muscles.join(',') : 'slots',asOf:input.asOf ?? input.now ?? null,
  })]}
}
