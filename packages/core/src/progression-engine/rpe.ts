import type { PrescribedSet, RpeLoadRule, Why } from '../../../contract/domain/progression'
import { isAssisted } from '../exercises'
import { estimate1RM, formulaOf, FORMULAS, weightedEstimate } from '../onerm'
import { buildWhy } from './why'
import { authoredSlots, finite, evaluationDate, loggedRir } from './replay'
import { adaptiveWorkingLoad } from './adaptive-load'
import { tmAt } from './tm'
import type { RuleContext } from './types'

export { loggedRir } from './replay'

/** Exact core estimator (including its measurement, rep cap and display precision). */
export function rpeLoad(context: RuleContext): PrescribedSet[] | undefined {
  if (context.rule.kind !== 'rpe-load') return undefined
  const rule: RpeLoadRule = context.rule, { input, definition, authored } = context
  const rows = rule.weeks[String(authored.ref.week)] ?? rule.weeks['*']
  if (!rows) return undefined
  const formula = formulaOf({ oneRmFormula: rule.e1rm.formula === 'profile' ? input.profile.oneRmFormula : rule.e1rm.formula })
  const ids = new Set([...(input.liftExercises?.[rule.lift] ?? []), ...authoredSlots(definition).filter(a => a.slot.tm?.key === rule.lift).map(a => a.slot.id).filter((id): id is string => typeof id === 'string')])
  // The attached slot is also a source when only tmSeeds declares the lift.
  if (authored.slot.id) ids.add(authored.slot.id)
  const date = evaluationDate(input, authored.ref.week)
  let exposures = context.allExposures.filter(e => e.exerciseId && ids.has(e.exerciseId) && !isAssisted(e.exerciseId, context.index) && (!date || authored.ref.week >= (input.cycle?.weekIndex ?? authored.ref.week) || e.date < date))
  const cutoff = input.asOf ?? input.now
  const historical = authored.ref.week < (input.cycle?.weekIndex ?? authored.ref.week)
  const end = historical && date ? cutoff && cutoff < date ? cutoff : date : cutoff ?? date ?? exposures.at(-1)?.date
  if ('sessions' in rule.e1rm.window) {
    const sessions = [...new Set(exposures.map(e => JSON.stringify([e.date, e.start, e.workoutKey])))].slice(-rule.e1rm.window.sessions)
    exposures = exposures.filter(e => sessions.includes(JSON.stringify([e.date, e.start, e.workoutKey])))
  } else if (end) {
    const first = new Date(Date.parse(end + 'T00:00:00Z') - (rule.e1rm.window.days - 1) * 86400000).toISOString().slice(0, 10)
    exposures = exposures.filter(e => e.date >= first && e.date <= end)
  }
  const sources: Why['inputs'] = {}
  let sourceIndex = 0
  const estimates = exposures.flatMap(e => (e.estimateSets ?? e.sets).flatMap(s => {
    // Core onerm accepts numeric strings from historical form fields.
    const w = finite(typeof s.w === 'string' ? Number(s.w) : s.w), reps = finite(typeof s.r === 'string' ? Number(s.r) : s.r)
    const normalizedLoad = w === undefined ? undefined : adaptiveWorkingLoad(context, e, { ...s, w })
    const estimate = estimate1RM(normalizedLoad, reps, formula, rule.e1rm.useLoggedEffort ? loggedRir(s) : null)
    if (estimate === null) return []
    const prefix = `source${sourceIndex++}`
    if (typeof s.side === 'string') sources[prefix + 'Side'] = s.side
    Object.assign(sources, { [prefix + 'Date']: e.date, [prefix + 'Workout']: e.workoutKey, [prefix + 'Exercise']: e.exerciseId ?? null, [prefix + 'Load']: w ?? null, [prefix + 'Unit']: e.unit, [prefix + 'NormalizedLoad']: normalizedLoad ?? null, [prefix + 'NormalizedUnit']: definition.unit, [prefix + 'DbLoad']: typeof e.target.dbLoad === 'string' ? e.target.dbLoad : 'as', [prefix + 'Reps']: reps ?? null, [prefix + 'Rir']: rule.e1rm.useLoggedEffort ? loggedRir(s) ?? null : null, [prefix + 'Estimate']: estimate })
    return [estimate]
  }))
  const sorted = [...estimates].sort((a, b) => a - b), n = sorted.length
  const e1rm = !n ? null : rule.e1rm.pick === 'latest' ? estimates.at(-1)! : rule.e1rm.pick === 'best' ? sorted[n - 1]! : (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2
  return rows.map((row, set) => {
    const rir = row.rir ?? 10 - row.rpe!, effectiveReps = row.reps + rir
    const multiplier = effectiveReps === 1 ? 1 : formula === 'weighted' ? weightedEstimate(1, effectiveReps) : FORMULAS[formula]!(1, effectiveReps)
    let load = e1rm === null || !Number.isFinite(multiplier) || multiplier <= 0 ? null : e1rm / multiplier
    const reference = rule.whenNoData.kind === 'percent-of-tm' ? tmAt(context.tm, rule.lift, date) : null
    if (e1rm === null && rule.whenNoData.kind === 'percent-of-tm') {
      load = reference === null ? null : reference * rule.whenNoData.pct
      if (reference === null) context.warnings.push({ code: 'tm.missing', ref: authored.ref, message: 'Set an immutable training-max seed for this lift.' })
    }
    if (e1rm !== null && load === null) context.warnings.push({ code: 'e1rm.inversion-unavailable', ref: authored.ref, message: 'The selected formula cannot represent this rep and effort target.' })
    return { reps: row.reps, load, unit: definition.unit, target: input.profile.effortScale === 'rir' ? { rir } : { rpe: 10 - rir }, why: [buildWhy(rule.id, rule.kind, {
      set, lift: rule.lift, formula, pick: rule.e1rm.pick, estimates: n, e1rm, reps: row.reps, rir, effectiveReps, multiplier: Number.isFinite(multiplier) ? multiplier : null, useLoggedEffort: rule.e1rm.useLoggedEffort,
      window: 'sessions' in rule.e1rm.window ? 'sessions' : 'days', windowSize: 'sessions' in rule.e1rm.window ? rule.e1rm.window.sessions : rule.e1rm.window.days,
      whenNoData: rule.whenNoData.kind, reference, fallbackPct: rule.whenNoData.kind === 'percent-of-tm' ? rule.whenNoData.pct : null,
      windowEnd: end ?? null, ...sources,
    })] }
  })
}
