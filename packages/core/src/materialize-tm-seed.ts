import { EXIDX, type ExerciseIndex } from './exercises'
import { best1RM, formulaOf, type AnalyticsSet, type AnalyticsState } from './onerm'
import { authoredSlots } from './progression-engine/replay'
import { convertWeightPrecise } from './progression-engine/units'
import { isoOf } from './format'
import { isProgrammeDate } from './programme-calendar'
import type { OpenGymProgrammeDefinition } from '../../contract/domain/programme-model.generated'

export interface TmSeedOptions { tm?: Record<string, number>; today?: string; now?: number }
/** Normalize all authoritative weights, including persisted form strings and unilateral sides. */
function convertedSet(set: AnalyticsSet, from: 'lb'|'kg', to: 'lb'|'kg'): AnalyticsSet {
  const numeric=typeof set.w==='number' || typeof set.w==='string' && set.w.trim()!=='' ? Number(set.w) : NaN
  return {...set,w:Number.isFinite(numeric) ? convertWeightPrecise(numeric,from,to) : set.w,
    ...(set.sides ? {sides:{...(set.sides.L ? {L:convertedSet(set.sides.L,from,to)} : {}),...(set.sides.R ? {R:convertedSet(set.sides.R,from,to)} : {})}} : {})}
}
/** Activation-only resolver. Never consult a live cycle's mutable TM cache. */
export function materializeTmSeed({state: inputState, definition, options, index = EXIDX}: {
  state: {workouts?: unknown[]; [key: string]: unknown}; definition: unknown; options: TmSeedOptions; index?: ExerciseIndex
}): Readonly<Record<string, number>> {
  // Persisted state (W08) permits nullable targets; the estimator tolerates them.
  const state = inputState as AnalyticsState
  const d = definition as OpenGymProgrammeDefinition
  const cutoff=options.now ?? Date.now(), today=options.today ?? isoOf(new Date(cutoff))
  const out: Record<string, number> = {}
  const seeds = d.tmSeeds ?? {}, supplied = options.tm ?? {}
  const slots = authoredSlots(d)
  const keys = new Set([...Object.keys(seeds), ...Object.keys(supplied), ...slots.flatMap(a=>a.slot.tm?.key ? [a.slot.tm.key] : [])])
  for (const lift of keys) {
    const seed = Object.hasOwn(seeds,lift) ? seeds[lift] : undefined
    let value = Object.hasOwn(supplied,lift) ? supplied[lift] : undefined
    if (value === undefined && seed && 'value' in seed) value = convertWeightPrecise(seed.value,seed.unit,d.unit)
    if (value === undefined && seed && 'fromE1rm' in seed) {
      if (!isProgrammeDate(today) || !Number.isSafeInteger(cutoff)) throw new Error('TM activation requires today and now')
      const workouts = (state.workouts ?? []).filter(w=> {
        if (!isProgrammeDate(w.d)) return false
        return w.d <= today && typeof w.start === 'number' && w.start < cutoff && w.end !== null && (typeof w.end!=='number' || w.end<cutoff) && w.active !== true
      }).map(w=>({...w,entries:w.entries?.map(e=>({...e,sets:e.sets?.map(s=>convertedSet(s,w.unit==='kg' ? 'kg' : w.unit==='lb' ? 'lb' : state.unit==='kg' ? 'kg' : 'lb',d.unit))}))}))
      const history = {...state,unit:d.unit,workouts}
      const rules=d.progressionRules ?? []
      const ids = new Set(slots.filter(a=>a.slot.tm?.key===lift || rules.some(r=>
        a.slot.progression?.rules?.includes(r.id) && (r.kind==='percentage' && r.ref.lift===lift || r.kind==='rpe-load' && r.lift===lift) ||
        r.kind==='amrap-tm' && r.lift===lift && r.source.slot.week===a.ref.week && r.source.slot.day===a.ref.day && r.source.slot.session===a.ref.session && r.source.slot.slot===a.ref.slot
      )).flatMap(a=>a.slot.id ? [a.slot.id] : []))
      const estimates = [...ids].map(id=>best1RM(history,id,formulaOf(state),undefined,index)?.est).filter((n): n is number=>typeof n==='number')
      if (estimates.length) value = Math.max(...estimates)*seed.fromE1rm.pct
    }
    if (value !== undefined) {
      if (!Number.isFinite(value) || value<=0) throw new Error('Invalid TM seed')
      Object.defineProperty(out,lift,{value,enumerable:true})
    }
  }
  return Object.freeze(out)
}
