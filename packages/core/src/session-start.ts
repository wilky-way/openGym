import { EXIDX, type ExerciseIndex } from './exercises'
export interface BuiltEntry extends Entry { target: Config; plan: Plan; sets: Row[]; planned: Config }
import type { Config, Row, Entry, Routine, State, ReadSession, Plan } from './session-types'
// How a session's exercise entries are built from a routine. Shared by the live start and by
// "log a past workout", which is the same screen pointed at another day — both must walk up
// to identical entries, or the two paths drift apart the first time a prescription rule changes.
// Imports both history.js and progression.js (which itself imports history.js); nothing in
// either imports this file, so there is no cycle.
import { setTargetAt } from '@opengym/core/programme-targets'
import { programmeTMConfig } from '@opengym/core/programme-tm'
import { buildSets, barFloor, applyIntensifierPlan, modeOf } from '@opengym/core/history'
import { isWarmupRow, isSideSet } from '@opengym/core/workout-model'
import { nextPrescription, applyPrescription, defaultIncrement, weightIncrement, plannedOf, sessionsFor, snapWeight } from '@opengym/core/progression'
import { dropGrid } from '@opengym/core/plates'
import { backoffStepOf, applyBackoff } from '@opengym/core/backoff'
import { dbLoadFor, historyAs, ownedWeightsFor } from '@opengym/core/dumbbells'

/**
 * Where a planned session's reps come from (Settings → During a workout). 'plan', the default:
 * the routine's own sets × reps, with history and the progression policy deciding the weight —
 * and a policy that moves reps (double progression, bodyweight, a timed hold) still moving them
 * from there. 'last': the reps you logged last time, the way every planned session opened before
 * this setting existed. A profile saved before it, or one that never chose, reads as 'plan'.
 */
export const startsFromLast = (st: State | null | undefined) => st?.startFrom === 'last'

/** A deload uses working history of this series, with a visible seed fallback when absent. */
export function programmeDeloadConfig(st: State, cfg: Config, routine: Routine | null | undefined, index: ExerciseIndex = EXIDX) {
  const deload = routine?.deload
  if (cfg.enginePrescription===true || !deload || deload.authored || !routine?.programme?.series) return null
  const fromWeek = routine.programme.fromWeekIndex ?? routine.programme.weekIndex! - 1
  const own = (sessionsFor(st, cfg.id, cfg, routine.id, index) as ReadSession[]).filter(s => s.series === routine.programme!.series &&
    s.mode === modeOf(cfg, index) && s.weight > 0 && (s.weekIndex == null || s.weekIndex <= fromWeek))
    .sort((a, b) => String(a.d).localeCompare(String(b.d)) || (a.start || 0) - (b.start || 0))
  const last = own.at(-1)
  const fallback = !last || (last.weekIndex != null && last.weekIndex < fromWeek)
  const base = last ? last.weight : Math.max(0, Number(cfg.weight) || 0)
  const maximum = last ? Math.max(...own.map(s => s.weight)) : base
  const factor = Number.isFinite(deload.loadFactor) ? Math.max(0, deload.loadFactor!) : .7
  const raw = base * factor
  const step = modeOf(cfg, index) === 'reps' ? weightIncrement(cfg, st.unit, index) : defaultIncrement(cfg.id!, st.unit, index)
  const grid = dropGrid(st, cfg, index)
  const weight = base > 0 ? Math.min(maximum, Math.max(barFloor(st, cfg.id, index), typeof grid === 'function' ? grid(raw) : snapWeight(raw, step))) : 0
  const setsFactor = Number.isFinite(deload.setsFactor) ? Math.max(0, deload.setsFactor!) : .5
  const sets=Math.max(1,Math.floor((cfg.sets || 1)*setsFactor))
  return { cfg: { ...cfg, prog: 'off', weight, sets, ...(cfg.pyramid ? {pyramid:cfg.pyramid.slice(0,sets),pyramidWeight:Array(Math.min(sets,cfg.pyramid.length)).fill(weight)} : {}) },
    deload: { ...deload, baseline: last ? 'series-last' : 'seed', fallback, ...(last ? { lastDate: last.d, lastWeekIndex: last.weekIndex } : {}) } }
}

/** Singular upstream stamp identifies the first occurrence; each entry freezes its own id. */
export function programmeInstanceFor(routines: Routine[] | null | undefined) {
  const stamps = (routines || []).map(r => r?.programme).filter((stamp): stamp is NonNullable<Routine["programme"]> => Boolean(stamp))
  if (!stamps.length) return null
  const { cycleId, instanceId, weekIndex, ordinal } = stamps[0]!
  return { cycleId, instanceId, weekIndex, ordinal }
}

/**
 * One planned exercise, built the way a session builds it: the prescription, the rows it opens
 * with and the target it is judged against. The session start, a mid-session edit of the
 * exercise, and an exercise added to or swapped into a planned session all build through here,
 * so an entry cannot come out differently depending on where it was made. `routine` is the one
 * the exercise is planned in: its own history comes first (#216) and its policy applies.
 * `noProg` builds the routine's own numbers with no prescription, as an excluded routine does.
 */
export function buildPlannedEntry(stored: State, cfg: Config, routine: Routine | null | undefined, { noProg = false }: { noProg?: boolean } = {}, index: ExerciseIndex = EXIDX): BuiltEntry {
  // Evaluated slots retain their identity at zero volume without inventing a working row.
  if (cfg.enginePrescription===true && cfg.sets===0) return {target:{...cfg},planned:{...cfg},plan:{policy:'off',kind:'off'},sets:[],
    ...(routine?.programme?.series ? {series:routine.programme.series,occurrenceId:routine.programme.instanceId,weekIndex:routine.programme.weekIndex} : {})}
  // What a dumbbell weight means for this exercise today (lib/dumbbells.js): the history it
  // progresses from is read in that meaning, so a switch from "40 total" to per bell opens at
  // 20, not at 40 a hand. Only a switch between the two explicit meanings converts anything.
  if (cfg.open && !cfg.id) return {target:{...cfg}, planned:{...cfg}, plan:{policy:'off',kind:'off'}, sets:[],
    ...(routine?.programme?.series ? {series:routine.programme.series, occurrenceId:routine.programme.instanceId, weekIndex:routine.programme.weekIndex} : {})}
  cfg = programmeTMConfig(stored, cfg, routine, index) as Config
  const meaning = dbLoadFor(stored, cfg, index)
  const st = historyAs(stored, cfg.id, meaning, index) as State
  const planned = plannedOf(cfg, index) as Config
  const deload = programmeDeloadConfig(st, cfg, routine, index)
  if (deload) { cfg = deload.cfg; noProg = true }
  // `plan` is kept on the entry purely so the workout can explain the number it chose.
  const plan: Plan = noProg ? { policy: 'off', kind: 'off' } : nextPrescription(st, cfg, routine, index)
  // The warm-up ramp and the prescription snap to the exercise's own increment (1.25 kg
  // plates exist), not the unit default; a timed exercise's `inc` is seconds, so it keeps the
  // default for its optional load.
  const step = modeOf(cfg, index) === 'reps' ? weightIncrement(cfg, st.unit, index) : defaultIncrement(cfg.id!, st.unit, index)
  const planReps = !startsFromLast(st)
  // Warm-ups ramp over the dumbbells you own when the profile lists them (issue #376): a rung
  // lands on the heaviest bell under it, never on a weight in between that no rack holds.
  const ramp = (modeOf(cfg, index) === 'reps' && ownedWeightsFor(st, cfg, index)) || step
  // Back-off sets step down from the top set by the exercise's own step (lib/backoff.js).
  const backoffStep = modeOf(cfg, index) === 'reps' && backoffStepOf(cfg, st.unit, index) ? step : 0
  const built = applyPrescription(buildSets(st, cfg, { step: ramp, rid: routine?.id, useTarget: plan.kind === 'off', planReps }, index), plan, ramp, barFloor(st, cfg.id, index))
  const rows = (backoffStep ? applyBackoff(built, backoffStep) : built) as Row[]
  const sets = applyIntensifierPlan(rows, cfg, dropGrid(st, cfg, index), index) as Row[]
  let workIndex = 0
  for (const row of sets) {
    if (isWarmupRow(row)) continue
    // Evaluated zero assistance and unavailable loads are authoritative too;
    // legacy history fallback must not replace them with a prior working load.
    if (cfg.enginePrescription===true && Array.isArray(cfg.pyramidWeight)) {
      const load: unknown=cfg.pyramidWeight[workIndex]
      if (typeof load==='number') row.w=load
      else delete row.w
      if (row.sides && isSideSet(row)) for (const side of [row.sides.L,row.sides.R]) {
        if (typeof load==='number') side.w=load
        else delete side.w
      }
    }
    const aim = setTargetAt(cfg, workIndex)
    if (aim) row.target = structuredClone(aim)
    const min=cfg.setRepsMin?.[workIndex] ?? cfg.repsMin, max=cfg.pyramid?.[workIndex] ?? cfg.reps
    if (min != null && max !== 'max' && (routine?.programme || cfg.setRepsMin || cfg.open)) row.repTarget={min:Number(min),max:Number(max)}
    if (row.side !== 'L') workIndex++
  }
  const target = { ...cfg }
  // Stamped on the session, so the meaning it was logged with stays with it (dumbbells.js).
  if (meaning !== 'as') target.dbLoad = meaning
  if (plan.weight != null) target.weight = plan.weight
  if (plan.reps != null) target.reps = plan.reps
  if (plan.sec != null) target.sec = plan.sec
  if (plan.sets != null) target.sets = plan.sets
  // Triple progression's per-set aim (progression.js readSession grades by it). Only a session
  // whose prescription set it carries one: a config that picked one up from a copied target
  // must not have a later session graded against an old day's aims.
  if (Array.isArray(plan.rowReps)) target.rowReps = plan.rowReps
  else delete target.rowReps
  // The step the back-off sets were built with, kept on the session so reading it back
  // (progression.js readSession) holds each set to its own weight even after the plan changes.
  if (backoffStep) target.backoffStep = backoffStep
  else delete target.backoffStep
  // Rows that opened at last session's reps rather than the plan's ("Your last session", and no
  // policy that decided reps), so the workout card can say where the number came from. Written
  // only when true, and never saved with the finished workout.
  const carried = !planReps && plan.kind !== 'off' && plan.reps == null && modeOf(cfg, index) === 'reps'
    && rows.some(s => !isWarmupRow(s) && s.r !== cfg.reps)
  // `planned` is what the routine asked for, kept apart from the target the prescription moved,
  // so the next session can tell an edited plan from a progressed one (nextPrescription).
  return { target, plan, sets, planned, ...(routine?.programme?.series ? { series: routine.programme.series, occurrenceId: routine.programme.instanceId, weekIndex: routine.programme.weekIndex } : {}), ...(deload ? { deload: deload.deload } : {}), ...(carried ? { carried: true } : {}) }
}

/**
 * What an exercise's settings sheet opens with in a running session: the entry's target with the
 * sets and reps (the range, the seconds) its routine planned put back in place of today's.
 *
 * The sheet edits the plan. Today's target is the prescription, and a double-progression aim, a
 * bodyweight climb or a set the rep ceiling added has moved it off the plan. Opened at those
 * numbers, a save that changed nothing stamped them as the plan, and the next build read that as
 * an edit: "Plan changed", the raise undone within the session, the climb started again the next
 * time (#275). The weight stays today's, the one on the bar. An entry built before plans were
 * stamped has only its target.
 */
export function plannedConfigOf(entry: Entry | null | undefined) {
  const out = { ...(entry?.target || {}) }
  const planned = entry?.planned
  if (entry?.deload && planned?.weight != null) out.weight = planned.weight
  if (!planned) return out
  for (const key of ['sets', 'reps', 'repsMin', 'sec']) {
    if (planned[key] != null) out[key] = planned[key]
    // A plan with no range has no bottom to keep.
    else if (key === 'repsMin') delete out.repsMin
  }
  return out
}

/**
 * Whether an entry is rebuilt the way an excluded routine builds its exercises: at the routine's
 * own numbers, with no prescription (buildPlannedEntry's `noProg`).
 *
 * `entry.noProg` comes from two places. A deload or rehab routine freezes it onto every exercise
 * it starts, and those are built without a prescription. An exercise's ⋯ menu sets it by hand for
 * one session, and that only stops the session from counting: its rows stay at the prescription.
 * Read as the first kind, a hand-set flag made a rebuild (Progression settings saved, a swap) drop
 * today's 102.5 to the routine's own 60, and its Undo then let those 60 count as progress. So only
 * an entry whose routine is itself kept out is built that way.
 */
export const builtOutOfProgression = (entry: Entry | null | undefined, routine: Pick<Routine, 'excludeFromProgression'> & { id?: string } | null | undefined) => entry?.noProg === true && routine?.excludeFromProgression === true

// Returns a bare array of session entries. "Excluded from progression" is per-entry now
// (`entry.noProg`, written only when true) rather than a wrapper flag — a rehab routine merged
// into real work must exclude only its own exercises. The merge helper (lib/session-merge.js)
// stamps `entry.rid`, so the single-routine and combined paths share this builder unchanged; it
// only reads the routine's id, to start each exercise from that routine's own history (#216).
export function buildSessionEntries(st: State, r: Routine | null | undefined, index: ExerciseIndex = EXIDX) {
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards.
  const noProg = r?.excludeFromProgression === true
  return (r ? r.ex : []).map(cfg => {
    const built = buildPlannedEntry(st, cfg, r, { noProg }, index)
    return { id: cfg.id, sg: cfg.sg, ...built, ...(noProg ? { noProg: true } : {}) }
  })
}
