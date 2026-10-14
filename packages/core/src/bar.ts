// Per-exercise bar weight (issue: plate math for barbell work). Logged weights stay the
// TOTAL on the bar — history, progression and 1RM keep meaning exactly what they always
// did. The bar weight is display metadata: it feeds the "X per side" plate math and
// nothing else.
//
// Unit: stored in the profile unit (S.unit), like every other weight in state — set
// weights, exWeights, bodyweight are all written in whatever unit the profile logs and a
// unit switch re-labels them without converting. A canonical-kg bar would be the one
// number that shifts under the user on a unit switch while the totals around it stay
// put, so the override follows the same rule. The equipment *defaults* therefore exist
// per unit too: a kg profile gets the 20 kg olympic bar, a lb profile the 45 lb bar its
// gym actually racks — not a 44.1 lb conversion no bar is stamped with.

import { EXIDX, type ExerciseIndex } from '@opengym/core/exercises.js'

/** The exercise fields a bar lookup reads. */
export interface BarExercise {
  id?: string
  eq?: string | null
  [key: string]: unknown
}

/** The profile fields a bar lookup reads. */
export interface BarProfile {
  unit?: string
  barWeights?: Record<string, number | undefined>
  [key: string]: unknown
}

/** Equipment values (e.eq) that put a bar in your hands. */
export const BAR_EQ = new Set(['barbell', 'olympic barbell', 'ez barbell', 'smith machine', 'trap bar'])

/** Typical bar weights per equipment type, for a kg profile. */
export const DEFAULT_BAR_KG: Record<string, number> = { barbell: 20, 'olympic barbell': 20, 'ez barbell': 10, 'smith machine': 9, 'trap bar': 25 }
/** The same bars as a lb profile knows them — real markings, not converted kg. */
export const DEFAULT_BAR_LB: Record<string, number> = { barbell: 45, 'olympic barbell': 45, 'ez barbell': 25, 'smith machine': 20, 'trap bar': 55 }

const exOf = (exOrId: string | BarExercise | null | undefined, index: ExerciseIndex = EXIDX): BarExercise | undefined =>
  (typeof exOrId === 'string' ? index[exOrId] : exOrId ?? undefined)

const inBar = (eq: string | null | undefined): boolean => eq != null && BAR_EQ.has(eq)

/** Whether this exercise (object or id) is done with a bar. */
export const usesBar = (exOrId: string | BarExercise | null | undefined, index: ExerciseIndex = EXIDX): boolean => inBar(exOf(exOrId, index)?.eq)

/** The default bar weight for an equipment type, in the given unit. null off the list. */
export const defaultBarWeight = (eq: string, unit: 'kg' | 'lb' | string | undefined): number | null =>
  (unit === 'lb' ? DEFAULT_BAR_LB : DEFAULT_BAR_KG)[eq] ?? null

/**
 * A stored 0 is "no bar", not "unset" (issue #138). Smith machines that counterbalance their
 * carriage put nothing in your hands, so the plate math and the drop-set steps have to start
 * from the weight you logged, not from a 9 kg bar that is not there. The key being absent is
 * what means "use the default for this bar type" — which is why the editor clears the key
 * rather than writing a 0 when you ask for the default back.
 */
export const isNoBar = (S: BarProfile | null | undefined, exId: string): boolean =>
  (S?.barWeights || {})[exId] === 0

/** True when the user has set their own bar weight for this exercise — including "no bar". */
export const hasBarOverride = (S: BarProfile | null | undefined, exId: string): boolean => {
  const own = (S?.barWeights || {})[exId]
  return own === 0 || (own !== undefined && own > 0)
}

/**
 * Effective bar weight for one exercise, in the profile unit: the explicit
 * S.barWeights[exId] if set — an explicit 0 is "no bar" (a Smith machine whose carriage is
 * counterbalanced, issue #138) and stays 0 — else the default for the bar type. null for
 * anything that is not a bar exercise.
 */
export function barWeightFor(S: BarProfile | null | undefined, exOrId: string | BarExercise | null | undefined, index: ExerciseIndex = EXIDX): number | null {
  const ex = exOf(exOrId, index)
  if (!inBar(ex?.eq)) return null
  const own = (S?.barWeights || {})[String(ex?.id)]
  if (own === 0) return 0
  if (own !== undefined && own > 0) return own
  return defaultBarWeight(ex?.eq ?? '', S?.unit)
}

/**
 * Plates per side: (total − bar) / 2, rounded to 2 decimals. null when there is nothing
 * sensible to show — a missing number, or a total at or below the bar itself. A bar of 0
 * ("no bar") splits the whole total.
 */
export function plateSplit(total: number | null | undefined, bar: number | null | undefined): number | null {
  // `bar` of 0 is a real answer, not a missing one: with no bar every kilo you logged is on the
  // ends, so the split is simply half of it (issue #138).
  if (total == null || !(total > 0) || bar == null || !(bar >= 0) || total <= bar) return null
  return Math.round(((total - bar) / 2) * 100) / 100
}
