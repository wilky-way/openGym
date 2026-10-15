import type { Session, State } from './session-types'
import type { HistoryRecord, HistoryState } from './backfill'
import type { Workout } from '../../contract/domain/state-doc'
import { backfillStart, backfillEnd, historyAsOf, completeBackfill } from './backfill'
import { buildCombinedEntries, deriveSessionName } from './session-merge'
import { programmeInstanceFor } from './session-start'
import { buildCompletedWorkout } from './finish-workout'
import { workoutVolume } from './history'
import { exerciseMuscleSnapshot } from './muscles'
import { isCustomEx, type ExerciseIndex } from './exercises'
import { stampWorkout } from './sync-merge'
import { rebuildPrHistory } from './workout-date'

/** Shared UI/MCP backfill draft; historical plans read only history before this session. */
export function buildBackfillSession(st: State, options: {
  id: string; iso: string; time?: string; durationMin: number; routineIds: string[]; replaceId?: string | null
}, index: ExerciseIndex) {
  const { id, iso, time, durationMin, routineIds, replaceId = null } = options
  const start = backfillStart(iso, time)
  const past = historyAsOf(st as unknown as HistoryState, { d: iso, start, replaceId })
  const { entries, routineIds: rids, routines } = buildCombinedEntries(past as unknown as State, routineIds, index)
  const instance = programmeInstanceFor(routines)
  return {
    id, d: iso, start, routineIds: rids,
    ...(instance ? { programmeInstance: instance } : {}),
    name: routines.length ? deriveSessionName(routines.map(r => r.name || ''))! : 'Freestyle',
    bw: null, cur: 0, entries,
    backfill: { durationMin, replaceId: replaceId || null }, workoutView: st.workoutView || 'cards',
  }
}

/** The exact historical finish path, including snapshots, volume, filing and PR corrections. */
export function fileBackfillWorkout(workouts: HistoryRecord[], active: Session & {
  start: number; backfill: { durationMin: number; replaceId?: string | null }
}, index: ExerciseIndex, now = Date.now()) {
  const w = buildCompletedWorkout(active, {
    end: backfillEnd(active), prs: [],
    snapshotFor: e => isCustomEx(index[e.id!], index) ? exerciseMuscleSnapshot(index[e.id!]) : null,
  }, index)
  // Legacy session views are wider than the persisted workout contract. This is the
  // same whitelist boundary used by the UI before extracting this helper.
  const workout = { ...w, vol: workoutVolume(w, index), ...(active.loggedBy === 'agent' ? { loggedBy: 'agent' } : {}) } as unknown as Workout
  stampWorkout(workout, now)
  const replaced = workouts.find(x => x.id === active.backfill.replaceId)
  const touched = [...new Set([...(replaced?.entries || []), ...workout.entries].map(e => e?.id).filter((id): id is string => id != null))]
  const filed = rebuildPrHistory(completeBackfill(workouts, active, workout, now), touched, workout, index)
  return { workouts: filed, workout: (filed.find(x => x === workout || (workout.id != null && x.id === workout.id)) || workout) as Workout }
}
