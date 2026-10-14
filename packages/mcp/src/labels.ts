// Formatting glue between lib helpers (which speak {0}/{1} templates) and the JSON returned
// to the LLM.
import { MUSCLE_NAME, MUSCLES } from '@opengym/core/muscles'
import { EXIDX, type ExerciseIndex } from '@opengym/core/exercises'
import { modeOf, fmtSec, setLabel } from '@opengym/core/history'
import { POLICY_NAME } from '@opengym/core/progression'
import { isPyramid, pyramidLabel } from '@opengym/core/pyramid'
import { fmtDate, fmtNum, fmtDur } from '@opengym/core/format'

// Apply {0},{1},… substitutions to the template strings the lib returns.
export function fmt(template: any, args: any) {
  let v = template
  for (let i = 0; i < (args || []).length; i++) v = v.replaceAll('{' + i + '}', String(args[i]))
  return v
}

export { setLabel }

export function exLine(cfg: any, unit: any, index: ExerciseIndex = EXIDX) {
  const mode = modeOf(cfg, index)
  const n = cfg.sets || 1
  const load = cfg.weight ? ' · ' + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`
  // Pyramid sets read as their per-set targets, the way the app shows them ("12 · 8 · 6 · Max · 12").
  if (isPyramid(cfg)) return pyramidLabel(cfg.pyramid)
  // A double-progression range is stored as its top (`reps`) and bottom (`repsMin`); it reads
  // as the range, the way the app's routine editor shows it ("3 × 8–12").
  const reps = cfg.repsMin > 0 && cfg.repsMin < cfg.reps ? `${cfg.repsMin}–${cfg.reps}` : `${cfg.reps}`
  // Triple progression's set range reads the same way ("3–5 × 8–12").
  const sets = cfg.setsMax > n ? `${n}–${cfg.setsMax}` : n
  return `${sets} × ${reps}${load}`
}

export function muscleName(slug: any) {
  return (MUSCLE_NAME as Record<string,string>)[slug] || slug
}

export function policyName(policy: any) {
  return (POLICY_NAME as Record<string,string>)[policy] || policy
}

export function friendlyDate(iso: any) {
  if (!iso) return null
  return fmtDate(iso, false)
}

export function friendlyDuration(ms: any) {
  return ms ? fmtDur(ms) : null
}

export function ratio(done: any, total: any) {
  return `${done}/${total}`
}

export function muscleOrder() { return MUSCLES.slice() }
