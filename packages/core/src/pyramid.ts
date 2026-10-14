// Pyramid sets (CONTEXT.md): one rep target per set, in order — a number, or PYRAMID_MAX for
// "as many reps as you can". A set may carry its own planned weight (pyramidWeight); the
// exercise is never progressed.
// Imports nothing from history.js, which imports this module.
import { t } from '@opengym/core/i18n-core.js'
import { isWarmupRow } from '@opengym/core/workout-model.js'

export const PYRAMID_MAX = 'max'
export const MAX_PYRAMID_SETS = 10

export type PyramidTarget = number | typeof PYRAMID_MAX

/** The plan fields a pyramid reads. Anything else on the exercise passes through untouched. */
export interface PyramidCfg {
  id?: string
  mode?: string
  sets?: unknown
  reps?: unknown
  pyramid?: unknown[]
  pyramidRest?: unknown[]
  pyramidWeight?: unknown[]
  [key: string]: unknown
}

/** A logged set as history stores it. */
export interface PyramidRow {
  w?: unknown
  r?: unknown
  done?: boolean
  max?: boolean
  [key: string]: unknown
}

/** A logged exercise inside a workout. */
export interface PyramidEntry {
  id?: string
  sets?: PyramidRow[]
  [key: string]: unknown
}

/** A workout as history stores it. */
export interface PyramidWorkout {
  d?: unknown
  start?: unknown
  entries?: PyramidEntry[]
  [key: string]: unknown
}

// One tap in the editor replaces the list with one of these.
export const PYRAMID_PRESETS: PyramidTarget[][] = [
  [12, 10, 8, 6],
  [6, 8, 10, 12],
  [12, 10, 8, 10, 12],
  [12, 8, 6, PYRAMID_MAX, 12],
]

export function isPyramid(cfg: PyramidCfg | null | undefined): boolean {
  return !!cfg && Array.isArray(cfg.pyramid) && cfg.pyramid.length > 0 && (cfg.mode || 'reps') === 'reps'
}

// What the editor and a hand-edited plan file can hold, kept to what the session can train:
// whole targets of at least one rep, "max", and no more than MAX_PYRAMID_SETS sets. `stride` 2
// is a per-side exercise: each target is rounded up to even, so it splits evenly between L and R.
export function normalizePyramid(list: unknown, stride = 1): PyramidTarget[] {
  if (!Array.isArray(list)) return []
  const out: PyramidTarget[] = []
  for (const v of list as unknown[]) {
    if (v === PYRAMID_MAX) out.push(PYRAMID_MAX)
    else if (v != null && v !== '' && Number.isFinite(Number(v))) {
      const n = Math.max(1, Math.round(Number(v)))
      out.push(Math.ceil(n / stride) * stride)
    }
  }
  return out.slice(0, MAX_PYRAMID_SETS)
}

// Turning the toggle on starts from the flat "sets × reps" already there.
export function pyramidFromFlat(cfg: PyramidCfg): unknown[] {
  const n = Math.max(1, Math.min(MAX_PYRAMID_SETS, Math.round(cfg.sets as number) || 1))
  return Array<unknown>(n).fill(cfg.reps || 10)
}

// Turning it off goes back to "sets × reps": the set count and the first numeric target.
export function flatFromPyramid(list: unknown[]): { sets: number; reps: unknown } {
  const first = list.find((v): v is number => typeof v === 'number')
  return { sets: list.length, reps: first || 10 }
}

/** "12 · 8 · 6 · Max · 12" */
export function pyramidLabel(list: PyramidTarget[]): string {
  return list.map(v => (v === PYRAMID_MAX ? t('Max') : String(v))).join(' · ')
}

// An extra set added mid-session copies the last target.
export function pyramidTargetAt<T>(list: T[], i: number): T | undefined {
  return i < list.length ? list[i] : list[list.length - 1]
}

// Each set's own rest in seconds, beside the targets (`pyramidRest[i]` for `pyramid[i]`). 0 is
// "the exercise's rest". Sized to the list; all zeros is no field at all, so a pyramid that
// never set a rest stays the shape it was.
export function normalizePyramidRest(rest: unknown, length: number): number[] {
  const src: unknown[] = Array.isArray(rest) ? (rest as unknown[]) : []
  const out = Array.from({ length }, (_, i) => Math.max(0, Math.round(Number(src[i])) || 0))
  return out.some(v => v > 0) ? out : []
}

// Each set's own planned weight, beside the targets (`pyramidWeight[i]` for `pyramid[i]`), in
// the plan's unit. 0 is "no plan": the set starts from what that same set lifted last time.
// Sized to the list; all zeros is no field at all, like pyramidRest.
export function normalizePyramidWeight(weights: unknown, length: number): number[] {
  const src: unknown[] = Array.isArray(weights) ? (weights as unknown[]) : []
  const out = Array.from({ length }, (_, i) => {
    const w = Number(src[i])
    return Number.isFinite(w) && w > 0 ? Math.round(w * 100) / 100 : 0
  })
  return out.some(v => v > 0) ? out : []
}

/** The weight planned for work set `i` of a pyramid, or 0 when that set has none. An extra set
 *  added mid-session copies the last one's, like its target. */
export function pyramidWeightAt(cfg: PyramidCfg | null | undefined, i: number): number {
  const pw = cfg?.pyramidWeight
  if (!isPyramid(cfg) || !Array.isArray(pw) || !pw.length) return 0
  return Math.max(0, Number(pyramidTargetAt(pw, i)) || 0)
}

/** The rest a ticked work row of a pyramid earns, or 0 to fall back to the exercise's rest.
 *  `i` indexes `rows`, warm-ups included; the pyramid counts work sets only. */
export function pyramidRestFor(target: PyramidCfg | null | undefined, rows: PyramidRow[] | null | undefined, i: number): number {
  const pr = target?.pyramidRest
  if (!isPyramid(target) || !Array.isArray(pr) || !pr.length) return 0
  const row = rows?.[i]
  if (!row || isWarmupRow(row)) return 0
  const k = (rows ?? []).slice(0, i).filter(r => !isWarmupRow(r)).length
  return Math.max(0, Number(pyramidTargetAt(pr, k)) || 0)
}

// ---- Max sets read back from history ----

interface MaxSet {
  w: number
  r: number
  d: unknown
  t: unknown
}

// Every completed Max set of an exercise, oldest first: { w, r, d, t }.
function maxSetsOf(workouts: PyramidWorkout[] | null | undefined, exId: string | undefined): MaxSet[] {
  const out: MaxSet[] = []
  for (const w of workouts || []) {
    for (const en of w.entries || []) {
      if (en.id !== exId) continue
      for (const s of en.sets || []) {
        if (s.max && s.done && Number(s.r) > 0 && !isWarmupRow(s)) out.push({ w: Number(s.w) || 0, r: s.r as number, d: w.d, t: w.start })
      }
    }
  }
  return out
}

/** The record a Max set at weight `w` is up against: the most reps any Max set of this exercise
 *  did at `w` or heavier (more reps on less weight is not a record). Ties: heavier, then first. */
export function maxRecordAt(workouts: PyramidWorkout[] | null | undefined, exId: string | undefined, w: unknown): MaxSet | null {
  let best: MaxSet | null = null
  for (const s of maxSetsOf(workouts, exId)) {
    if (s.w < (Number(w) || 0)) continue
    if (!best || s.r > best.r || (s.r === best.r && s.w > best.w)) best = s
  }
  return best
}

/** Most reps in a Max set, per workout, for the Stats chart: [{ t, y, d, w }]. */
export function maxRepsSeries(workouts: PyramidWorkout[] | null | undefined, exId: string | undefined): { t: unknown; y: number; d: unknown; w: number }[] {
  const byWorkout = new Map<string, { t: unknown; y: number; d: unknown; w: number }>()
  for (const s of maxSetsOf(workouts, exId)) {
    const key = `${String(s.t)}|${String(s.d)}`
    const cur = byWorkout.get(key)
    if (!cur || s.r > cur.y) byWorkout.set(key, { t: s.t, y: s.r, d: s.d, w: s.w })
  }
  return [...byWorkout.values()]
}
