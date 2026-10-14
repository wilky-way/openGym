import type { RoutineExercise, SetTarget } from '../../contract/domain/state-doc'
interface TargetState {
  effort?: unknown
  queue?: {label?: string; labelKind?: string; programmeCycleId?: string} | null
  programmes?: {cycles?: {id?: string}[]} | null
  [key: string]: unknown
}
import { rirOf, toScale } from '@opengym/core/effort'
import { effortOf } from '@opengym/core/history'

// Authored effort stays separate from the effort actually logged on a set.
export function validateSetTarget(target: unknown) {
  if (target == null) return
  if (typeof target !== 'object' || Array.isArray(target)) throw new Error('Invalid set target')
  for (const [key, value] of Object.entries(target)) {
    if (!['rir','rpe','pct'].includes(key) || typeof value !== 'number' || !Number.isFinite(value) ||
      (key === 'pct' ? value <= 0 : value < 0 || value > 10)) throw new Error('Invalid set target')
  }
}
export function setTargetAt(cfg: RoutineExercise, index: number) {
  const target = {...cfg.target}, authored=cfg.setTargets?.[index]
  if (authored?.rpe != null || authored?.rir != null) {delete target.rpe;delete target.rir}
  Object.assign(target,authored)
  if (cfg.tm?.percentages?.[index] != null) target.pct = cfg.tm.percentages[index]
  return Object.keys(target).length ? target : null
}
/** A display copy only: authored targets and logged ratings never change. */
export function targetForScale(target: SetTarget | null | undefined, kind = 'none') {
  if (!target) return null
  const out: SetTarget & Record<string, unknown> = { ...target }
  if (['rir', 'rpe'].includes(kind) && rirOf(target) != null) {
    delete out.rir; delete out.rpe
    out[kind] = toScale(kind, rirOf(target))
  }
  return out
}
export function targetLabel(target: SetTarget | null | undefined, t = (s: string, n: number) => s.replace('{0}', String(n)), kind = 'none') {
  const shown = targetForScale(target, kind)
  return [shown?.rpe != null && (kind === 'none' ? `@${shown.rpe}` : `RPE ${shown.rpe}`),
    shown?.rir != null && t('{0} RIR', shown.rir), shown?.pct != null && `${shown.pct}%`].filter(Boolean).join(' · ')
}

/** Range endpoints reverse when changing scale: RPE 7–8 is RIR 2–3. */
export function effortRangeLabel(authoredKind: string, min: number | null | undefined, max = min, kind = 'none') {
  if (min == null) return ''
  const shownKind = ['rir', 'rpe'].includes(kind) ? kind : authoredKind
  const values = [min, max ?? min].map(value => toScale(shownKind, rirOf({ [authoredKind]: value }))).sort((a,b) => Number(a)-Number(b))
  return `${shownKind.toUpperCase()} ${values[0]}${values[1] !== values[0] ? `–${values[1]}` : ''}`
}

// Only explicit provenance permits conversion; all unmarked prose remains opaque.
export function programmeNote(S: TargetState, cfg: RoutineExercise | null | undefined) {
  const note = cfg?.note || ''
  if (cfg?.noteKind !== 'planner' || effortOf(S) === 'none') return note
  return note.replace(/(\d+(?:\.\d+)?) RIR/g, (_,value) => targetLabel({rir:Number(value)}, undefined, effortOf(S)))
}
export function programmeQueueLabel(S: TargetState, label = S.queue?.label || '') {
  // Convert the generated suffix only, preserving effort words in the program name.
  const cycle = S.programmes?.cycles?.find(c => c.id === S.queue?.programmeCycleId)
  if ((!cycle && S.queue?.labelKind !== 'planner') || effortOf(S) === 'none') return label
  return label.replace(/( · )(\d+(?:\.\d+)?) RIR((?: \(assumed\)| deload)?)$/, (_,prefix,value,suffix) =>
    prefix + targetLabel({rir:Number(value)}, undefined, effortOf(S)) + suffix)
}
