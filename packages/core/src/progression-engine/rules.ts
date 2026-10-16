import type { DoubleRule, LinearRule, PrescribedSet, ProgressionRule } from '../../../contract/domain/progression'
import type { AuthoredSlot, Exposure, RuleContext } from './types'
import { convertWeightPrecise, checkedLoad } from './units'
import { dbLoadFor, dbLoadOf, meaningFactor } from '../dumbbells'
import { authoredSlots, finite, sameSeries, evaluationDate, loggedRir } from './replay'
import { buildWhy } from './why'
import { tmAt } from './tm'
import { isAssisted } from '../exercises'

export const isLoadRule = (r: ProgressionRule): boolean => ['percentage','rpe-load','linear','double'].includes(r.kind)
export function parseAuthoredReps(value: unknown, allowRange = false): {reps:number|'amrap';min?:number;max?:number} | null {
  if (value === 'max' || value === 'amrap') return {reps:'amrap'}
  const number=typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined
  if (number !== undefined && Number.isInteger(number) && number >= 1 && number <= 100) return {reps:number}
  if (allowRange && typeof value === 'string') {
    const range=/^(\d+)\s*-\s*(\d+)$/.exec(value)
    if (range) {const min=Number(range[1]),max=Number(range[2]);if (min>=1 && max<=100 && min<=max) return {reps:min,min,max}}
  }
  return null
}
const repFloor = (value: unknown): number | undefined => {
  const parsed=parseAuthoredReps(value)
  return parsed && typeof parsed.reps === 'number' ? parsed.reps : undefined
}
export const authoredCount = (a: AuthoredSlot): number => a.slot.pyramid?.length ?? a.slot.sets
export function authoredSets(a: AuthoredSlot, unit: 'lb'|'kg', effortScale: 'rir'|'rpe', count = authoredCount(a), allowRange=false): PrescribedSet[] {
  return Array.from({length:count}, (_,i): PrescribedSet | null => {
    const rawReps = a.slot.pyramid?.[i] ?? a.slot.reps
    const parsed=parseAuthoredReps(rawReps,allowRange)
    if (!parsed) return null
    const reps=parsed.reps
    const min = repFloor(a.slot.setRepsMin?.[i]) ?? repFloor(a.slot.repsMin) ?? parsed.min
    const rawTarget = a.slot.setTargets?.[i] ?? a.slot.target
    const target = rawTarget ? {
      ...(rawTarget.pct === undefined ? {} : {pct:rawTarget.pct}),
      ...(effortScale === 'rir' ? rawTarget.rir !== undefined ? {rir:rawTarget.rir} : rawTarget.rpe !== undefined ? {rir:10-rawTarget.rpe} : {} : rawTarget.rpe !== undefined ? {rpe:rawTarget.rpe} : rawTarget.rir !== undefined ? {rpe:10-rawTarget.rir} : {}),
    } : undefined
    return {reps,...(min === undefined ? {} : {repsMin:min}),load:null,unit,...(target ? {target} : {}),why:[buildWhy('authored','authored',{set:i,sets:count,reps,repsMin:min ?? null,...(parsed.max === undefined ? {} : {repsMax:parsed.max}),...target})]}
  }).filter((s): s is PrescribedSet => s !== null)
}
const goal = (e: Exposure, a: AuthoredSlot, index: number): number => {
  const t=e.target, per=historicalReps(t)
  const x=per[index] ?? t.reps ?? a.slot.pyramid?.[index] ?? a.slot.reps
  const parsed=parseAuthoredReps(x)
  return parsed && typeof parsed.reps === 'number' ? parsed.reps : repFloor(listNumbers(t.setRepsMin)[index]) ?? repFloor(t.repsMin) ?? repFloor(a.slot.setRepsMin?.[index]) ?? repFloor(a.slot.repsMin) ?? Infinity
}
const listNumbers = (x: unknown): unknown[] => Array.isArray(x) ? x : []
const historicalReps = (target: Exposure['target']): unknown[] => {
  const rows=listNumbers(target.rowReps)
  return rows.length ? rows : listNumbers(target.pyramid)
}
export const requiredCount = (e: Exposure, a: AuthoredSlot) => {
  const per=historicalReps(e.target)
  if (per.length) return per.length
  const count=finite(e.target.sets)
  return count !== undefined && Number.isInteger(count) && count>=1 && count<=100 ? count : authoredCount(a)
}
export function exposureSuccess(rule: ProgressionRule, exposure: Exposure, authored: AuthoredSlot): boolean {
  const e=exposure, sets=e.sets, count=requiredCount(e,authored)
  if (rule.kind === 'double') {
    if (rule.condition === 'total-reps') return sets.reduce((n,s)=>n+(finite(s.r) ?? 0),0) >= (rule.totalThreshold ?? count*rule.repsHigh)
    if (rule.condition === 'first-set') return (finite(sets.find(s => s.workIndex === 0)?.r) ?? 0) >= rule.repsHigh
    return sets.length >= count && Array.from({length:count},(_,i)=>sets.find(s=>s.workIndex===i)).every(s => !!s && (finite(s.r) ?? 0)>=rule.repsHigh)
  }
  if (rule.kind === 'linear') {
    if (rule.success === 'last-set-reps') return (finite(sets.find(s=>s.workIndex===count-1)?.r) ?? 0) >= goal(e,authored,count-1)
    return Array.from({length:count},(_,i)=>sets.find(s=>s.workIndex===i)).every((s,i)=>!!s && (finite(s.r) ?? 0)>=goal(e,authored,i))
  }
  if (rule.kind === 'percentage') {
    const rows=rule.weeks[String(e.week)]
    return !!rows?.length && Array.from({length:count},(_,i)=>rows[Math.min(i,rows.length-1)]!).every((p,i) => (finite(sets.find(s=>s.workIndex===i)?.r) ?? 0) >= (p.repsMin ?? (typeof p.reps === 'number' ? p.reps : 1)))
  }
  if (rule.kind === 'rpe-load') {
    const rows=rule.weeks[String(e.week)] ?? rule.weeks['*']
    return !!rows?.length && Array.from({length:count},(_,i)=>rows[Math.min(i,rows.length-1)]!).every((p,i) => {
      const s=sets.find(s=>s.workIndex===i)
      if (!s || (finite(s.r) ?? 0)<p.reps) return false
      const rir=loggedRir(s)
      return rir === undefined || rir >= (p.rir ?? 10-p.rpe!)-1
    })
  }
  return false
}
export function replayLoad(context: RuleContext, rule: LinearRule | DoubleRule) {
  const a=context.authored
  const assisted=isAssisted(a.slot.id,context.index)
  const increment=assisted ? -rule.increment : rule.increment
  const increase=(value: number)=>Math.max(0,checkedLoad(value+increment))
  const numeric=typeof a.slot.weight === 'string' && a.slot.weight.trim() ? Number(a.slot.weight) : undefined
  const seed=typeof a.slot.weight === 'string' ? Number.isNaN(numeric) ? undefined : numeric : a.slot.weight
  let load=typeof seed === 'number' ? checkedLoad(seed) : null
  if (!(load !== null && (load>0 || assisted && load===0))) load=null
  let streak=0, bumps=0, failures=0
  const successWeeks = new Set<number>()
  let latestSuccessfulWeek: number | undefined
  let reps=rule.kind === 'double' ? rule.repsLow : undefined
  const history=context.exposures.filter(e=>sameSeries(e.ref,a.ref))
  const sources=authoredSlots(context.definition)
  for (const e of history) {
    const actual=e.sets.map(s=>typeof s.w === 'number' ? checkedLoad(s.w) : undefined).find(w=>w !== undefined && (w>0 || assisted && w===0))
    // The athlete's actual logged working weight supersedes a suggestion.
    if (actual !== undefined) {
      const cfg={...a.slot,id:a.slot.id ?? undefined}
      const factor=meaningFactor(dbLoadOf(e.target.dbLoad) ?? 'as',dbLoadFor(context.input.profile as import('../dumbbells').BellProfile,cfg,context.index),{...e.target,id:e.exerciseId ?? cfg.id},context.index)
      load=convertWeightPrecise(checkedLoad(actual*factor),e.unit,context.definition.unit)
    }
    const source=sources.find(s=>sameSeries(s.ref,e.ref) && s.ref.week===e.ref.week) ?? a
    const success=exposureSuccess(rule,e,source)
    failures=success ? 0 : failures+1
    if (rule.kind === 'double') {
      if (success && load !== null) { load=increase(load); bumps++; reps=rule.repsLow }
      else if (a.slot.progression?.parameters?.repProgression === 'step' && e.sets.length >= requiredCount(e, source)) {
        const achieved = Math.min(...Array.from({length:requiredCount(e, source)}, (_, i) => finite(e.sets.find(s=>s.workIndex===i)?.r) ?? 0))
        if (achieved >= reps!) reps=Math.min(rule.repsHigh, achieved+1)
      }
    } else if ('sessions' in rule.every) {
      streak=success ? streak+1 : 0
      if (streak === rule.every.sessions) { if (load !== null) {load=increase(load);bumps++} streak=0 }
    } else if (success && !successWeeks.has(e.calendarWeek)) {
      successWeeks.add(e.calendarWeek)
      latestSuccessfulWeek=e.calendarWeek
    }
  }
  if (rule.kind === 'linear' && 'weeks' in rule.every) {
    bumps=Math.floor(successWeeks.size/rule.every.weeks)
    // Award the final completed successful week only once, after all its sessions.
    // Older earned changes are reflected in the athlete's logged working weight.
    if (successWeeks.size > 0 && successWeeks.size % rule.every.weeks === 0 && latestSuccessfulWeek === history.at(-1)?.calendarWeek && load !== null) load=increase(load)
  }
  return {load,reps,streak,bumps,failures,exposures:history.length,successfulWeeks:successWeeks.size,assisted}
}
export function loadSets(context: RuleContext): PrescribedSet[] | undefined {
  const {rule:r,authored:a,input,definition:d}=context
  if (r.kind === 'percentage') {
    const rows=r.weeks[String(a.ref.week)]
    if (!rows) return undefined
    const reference=tmAt(context.tm,r.ref.lift,evaluationDate(input,a.ref.week))
    if (reference === null) context.warnings.push({code:'tm.missing',ref:a.ref,message:'Set an immutable training-max seed for this lift.'})
    const baseline=authoredSets(a,d.unit,input.profile.effortScale)
    return rows.map((p,i)=>({reps:p.reps,...(p.repsMin === undefined ? {} : {repsMin:p.repsMin}),load:reference===null?null:checkedLoad(reference*p.pct),unit:d.unit,target:{...baseline[i]?.target,pct:p.pct},why:[buildWhy(r.id,r.kind,{basis:r.ref.basis,lift:r.ref.lift,reference,pct:p.pct,reps:p.reps,repsMin:p.repsMin ?? null})]}))
  }
  if (r.kind !== 'linear' && r.kind !== 'double') return undefined
  const state=replayLoad(context,r)
  return authoredSets(a,d.unit,input.profile.effortScale,authoredCount(a),r.kind==='double').map(s=>({ ...s, ...(r.kind === 'double' ? {reps:state.reps!} : {}), load:state.load,
    why: state.load === null ? [buildWhy('authored','authored',{reason:'no-seed',reps:s.reps})] : [buildWhy(r.id,r.kind,{load:state.load,bumps:state.bumps,streak:state.streak,failures:state.failures,exposures:state.exposures,successfulWeeks:state.successfulWeeks,increment:r.increment,...(state.assisted ? {assisted:true} : {}),...(r.kind === 'linear' ? {every:'sessions' in r.every ? r.every.sessions : r.every.weeks,period:'sessions' in r.every ? 'sessions' : 'weeks'} : {condition:r.condition,repsLow:r.repsLow,repsHigh:r.repsHigh})})] }))
}
