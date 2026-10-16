import type { MaxBasis, MaxAdjustment, ProgrammeCycle, ProgrammeDefinition, Unit } from '../../contract/domain/state-doc'
import type { ProgrammeState } from './programme-engine-types'
import { uid } from './format'
import { isProgrammeDate } from './programme-calendar'
import { convertWeightPrecise } from './progression-engine/units'
import { evaluate, tmAt } from './progression-engine/index'
import { cmp } from './progression-engine/replay'
import { EXIDX, type ExerciseIndex } from './exercises'

/** Never infer max semantics from a family name, load unit or sample value. */
export function programmeMaxBasis(definition: ProgrammeDefinition): MaxBasis | undefined {
  if (['1rm','tm','e1rm'].includes(definition.maxBasis ?? '')) return definition.maxBasis
  const refs = new Set(definition.weeks.flatMap(w=>w.days.flatMap(d=>d.sessions.flatMap(s=>s.routineSnapshot.ex.flatMap(e=>e.tm?.reference ? [e.tm.reference.toLowerCase()] : [])))))
  return refs.size === 1 && ['1rm','tm','e1rm'].includes([...refs][0]!) ? [...refs][0] as MaxBasis : undefined
}
export const maxBasisLabel = (d: ProgrammeDefinition) => (programmeMaxBasis(d) === '1rm' ? '1RM' : programmeMaxBasis(d) === 'tm' ? 'TM' : programmeMaxBasis(d) === 'e1rm' ? 'e1RM' : 'Reference max (basis unspecified)')
export function programmeMaxKeys(d: ProgrammeDefinition, c?: ProgrammeCycle): string[] {
  return [...new Set([...d.weeks.flatMap(w=>w.days.flatMap(day=>day.sessions.flatMap(s=>s.routineSnapshot.ex.flatMap(e=>e.nativePrescription?.sets.flatMap(row=>row.percentage?.role==='prescribed'?[row.percentage.key]:[]) ?? [])))), ...Object.keys(d.tmSeeds as object ?? {}), ...Object.keys(c?.tmSeed ?? {}), ...Object.keys(c?.tm ?? {}),
    ...d.weeks.flatMap(w=>w.days.flatMap(day=>day.sessions.flatMap(s=>s.routineSnapshot.ex.flatMap(e=>e.tm ? [e.tm.key || e.id || ''] : []))))])].filter(Boolean)
}
export function effectiveProgrammeMax(S: ProgrammeState, c: ProgrammeCycle, lift: string, today: string, unit: Unit, index: ExerciseIndex = EXIDX): number | null {
  const result = evaluate({definition:c.snapshot,cycle:c,logs:S.workouts ?? [],weeks:[],asOf:today,profile:{...S,unit:S.unit ?? 'lb',effortScale:'rir'}}, {}, index)
  if (result.error) throw new Error('The program rules are invalid. Repair them before adjusting maxes.')
  const value = tmAt(result.tm,lift,today)
  if (value !== null) return convertWeightPrecise(value,c.snapshot.unit,unit)
  // A legacy cache is overwritten on append. Before its first dated decision,
  // only that decision's prior value can describe the baseline (including unknown).
  const first = c.maxAdjustments?.filter(event=>event.lift===lift)
    .sort((a,b)=>cmp(a.effectiveOn,b.effectiveOn) || a.recordedAt-b.recordedAt || cmp(a.id,b.id))[0]
  if (first) return typeof first.previous === 'number' && Number.isFinite(first.previous) && first.previous > 0
    ? convertWeightPrecise(first.previous,first.unit,unit) : null
  const cached = Object.hasOwn(c.tm ?? {},lift) ? c.tm![lift] : undefined
  return typeof cached === 'number' && Number.isFinite(cached) && cached > 0 ? convertWeightPrecise(cached,c.tmUnit ?? S.unit ?? 'lb',unit) : null
}
export interface SetTrainingMaxOptions { lift: string; value: number; unit: Unit; today: string; reason?: string; now?: number }
/** Caller owns the draft and transport guard. Does not touch routines, active rows, seed or logs. */
export function setTrainingMax(S: ProgrammeState, cycleId: string, options: SetTrainingMaxOptions, index: ExerciseIndex = EXIDX): MaxAdjustment {
  const c = S.programmes?.cycles.find(c=>c.id===cycleId)
  if (!c || !['active','paused'].includes(c.status)) throw new Error('Only an active or paused cycle can adjust maxes.')
  if (!isProgrammeDate(options.today) || !['lb','kg'].includes(options.unit) || typeof options.value !== 'number' || !Number.isFinite(options.value) || options.value <= 0) throw new Error('Enter a positive finite max and a valid date/unit.')
  if (!programmeMaxKeys(c.snapshot,c).includes(options.lift)) throw new Error('Unknown program lift.')
  if (options.reason !== undefined && (typeof options.reason !== 'string' || options.reason.length > 1000)) throw new Error('Max adjustment reason must be at most 1000 characters.')
  const history = c.maxAdjustments ?? [], last = history.at(-1)
  const now = Math.max(options.now ?? Date.now(), history.reduce((at,event)=>Math.max(at,event.recordedAt),0) + 1)
  if (!Number.isSafeInteger(now) || now < 0 || last && options.today < last.effectiveOn) throw new Error('Max adjustment date/clock must follow its history.')
  const value = convertWeightPrecise(options.value,options.unit,c.snapshot.unit)
  const cachedValue = convertWeightPrecise(value,c.snapshot.unit,c.tmUnit ?? S.unit ?? 'lb')
  if (value <= 0 || cachedValue <= 0) throw new Error('The max is too small after unit conversion.')
  const previous = effectiveProgrammeMax(S,c,options.lift,options.today,c.snapshot.unit,index)
  const basis = programmeMaxBasis(c.snapshot)
  const event: MaxAdjustment = {id:`${c.id}:max:${now}:${uid()}`,lift:options.lift,recordedAt:now,effectiveOn:options.today,previous,value,unit:c.snapshot.unit,...(basis ? {basis} : {}),reason:options.reason ?? ''}
  c.maxAdjustments = [...history,event]
  c.tm = {...c.tm,[options.lift]:cachedValue}
  return event
}
