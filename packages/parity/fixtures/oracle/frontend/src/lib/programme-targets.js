import { rirOf, toScale } from './effort.js'
import { effortOf } from './history.js'

// Authored effort stays separate from the effort actually logged on a set.
export function validateSetTarget(target) {
  if (target == null) return
  if (typeof target !== 'object' || Array.isArray(target)) throw new Error('Invalid set target')
  for (const [key, value] of Object.entries(target)) {
    if (!['rir','rpe','pct'].includes(key) || typeof value !== 'number' || !Number.isFinite(value) ||
      (key === 'pct' ? value <= 0 : value < 0 || value > 10)) throw new Error('Invalid set target')
  }
}
export function setTargetAt(cfg, index) {
  const target = {...cfg.target}, authored=cfg.setTargets?.[index]
  if (authored?.rpe != null || authored?.rir != null) {delete target.rpe;delete target.rir}
  Object.assign(target,authored)
  if (cfg.tm?.percentages?.[index] != null) target.pct = cfg.tm.percentages[index]
  return Object.keys(target).length ? target : null
}
/** A display copy only: authored targets and logged ratings never change. */
export function targetForScale(target, kind = 'none') {
  if (!target) return null
  const out = { ...target }
  if (['rir', 'rpe'].includes(kind) && rirOf(target) != null) {
    delete out.rir; delete out.rpe
    out[kind] = toScale(kind, rirOf(target))
  }
  return out
}
export function targetLabel(target, t = (s,n) => s.replace('{0}',n), kind = 'none') {
  const shown = targetForScale(target, kind)
  return [shown?.rpe != null && (kind === 'none' ? `@${shown.rpe}` : `RPE ${shown.rpe}`),
    shown?.rir != null && t('{0} RIR', shown.rir), shown?.pct != null && `${shown.pct}%`].filter(Boolean).join(' · ')
}

/** Range endpoints reverse when changing scale: RPE 7–8 is RIR 2–3. */
export function effortRangeLabel(authoredKind, min, max = min, kind = 'none') {
  if (min == null) return ''
  const shownKind = ['rir', 'rpe'].includes(kind) ? kind : authoredKind
  const values = [min, max ?? min].map(value => toScale(shownKind, rirOf({ [authoredKind]: value }))).sort((a,b) => a-b)
  return `${shownKind.toUpperCase()} ${values[0]}${values[1] !== values[0] ? `–${values[1]}` : ''}`
}

// Only explicit provenance permits conversion; all unmarked prose remains opaque.
export function programmeNote(S, cfg) {
  const note = cfg?.note || ''
  if (cfg?.noteKind !== 'planner' || effortOf(S) === 'none') return note
  return note.replace(/(\d+(?:\.\d+)?) RIR/g, (_,value) => targetLabel({rir:Number(value)}, undefined, effortOf(S)))
}
export function programmeQueueLabel(S, label = S.queue?.label || '') {
  // Convert the generated suffix only, preserving effort words in the program name.
  const cycle = S.programmes?.cycles?.find(c => c.id === S.queue?.programmeCycleId)
  if ((!cycle && S.queue?.labelKind !== 'planner') || effortOf(S) === 'none') return label
  return label.replace(/( · )(\d+(?:\.\d+)?) RIR((?: \(assumed\)| deload)?)$/, (_,prefix,value,suffix) =>
    prefix + targetLabel({rir:Number(value)}, undefined, effortOf(S)) + suffix)
}
