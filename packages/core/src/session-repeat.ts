import { buildNativeEntry } from './native-session'
import { hasNativeRelativeLoad, validateNativeRelativeRows, nativeExtraRow } from './native-relative-load'
import { sameNativeRow } from './native-prescription'
import { EXIDX, type ExerciseIndex } from './exercises'
import type { Row, Entry, Session, State } from './session-types'
// "Repeat today" (#58): a saved workout's exercises, in its order and with its supersets, as the
// entries of a new freestyle session — each row seeded from what was logged in THAT workout, not
// from the latest time the exercise was done. The source record is never touched; it stays what
// was logged that day.
//
// The exercise setup is the one "Save as routine" copies (routineFromSession: per-side, time,
// cardio, warm-up count, the superset groups renumbered, session-only fields gone). The rows are
// built the way a freestyle exercise added mid-workout builds them (Workout.jsx), with history
// narrowed to this one entry of this one workout, so "last time" is that day.
import { routineFromSession } from './session-routines'
import { buildSets, applyIntensifierPlan, modeOf, setsFromRows } from '@opengym/core/history'
import { isWarmupRow } from '@opengym/core/workout-model'
import { dropGrid } from '@opengym/core/plates'
import { weightIncrement, defaultIncrement } from '@opengym/core/progression'

const sourceEntries = (w: Session | null | undefined): Entry[] => (Array.isArray(w?.entries) ? w.entries : []).filter(entry => entry?.sets?.length)

/**
 * @returns {{ entries: object[], skipped: number }} the new session's entries (every row
 *   unchecked), and how many exercises were left out because they no longer exist (a deleted
 *   custom exercise).
 */
export function repeatSessionEntries(st: State, w: Session | null | undefined, { exists = id => !!index[id!] }: { exists?: (id: string | undefined) => boolean } = {}, index: ExerciseIndex = EXIDX) {
  const src = sourceEntries(w)
  let ex
  try { ex = routineFromSession(w, w?.name, st?.routines, index).ex }
  catch { return { entries: [], skipped: 0 } }
  const entries: Entry[] = []
  let skipped = 0
  ex.forEach((copied, i) => {
    const source = src[i]!
    if (!exists(copied.id)) { skipped++; return }
    if (source.target?.nativePrescription) {
      entries.push(repeatNativeEntry(st,source,copied,index));return
    }
    const { sg, ...setup } = copied
    // As many work sets as were logged that day, done ones — the copy for a routine takes the
    // plan's count, but repeating a day means the day: the bonus set, or the set skipped.
    // A per-side timed hold logs a left and a right row per set (setsFromRows).
    const done = setsFromRows(setup, (source?.sets || []).filter(row => row?.done && !isWarmupRow(row)).length, index)
    const cfg = { ...setup, ...(done ? { sets: done } : {}) }
    const step = modeOf(cfg, index) === 'reps' ? weightIncrement(cfg, st?.unit, index) : defaultIncrement(cfg.id!, st?.unit, index)
    // Only this entry of this workout is history here, so a later session of the same exercise,
    // or the same exercise twice in one workout, does not seed the rows.
    const only = { ...st, workouts: [{ ...w, entries: [source] }] }
    const sets = (applyIntensifierPlan(buildSets(only, cfg, { step, preferLast: true }, index), cfg, dropGrid(st, cfg, index), index) as Row[])
      .map(row => ({ ...row, done: false }))
    entries.push({ id: cfg.id, ...(sg ? { sg } : {}), target: { ...cfg }, plan: null, sets })
  })
  return { entries: regroup(entries), skipped }
}

// A superset whose other half was skipped is one exercise on its own, not a group of one.
function regroup(entries: Entry[]) {
  return entries.map((entry, i) => {
    if (!entry.sg) return entry
    const paired = entries[i - 1]?.sg === entry.sg || entries[i + 1]?.sg === entry.sg
    if (paired) return entry
    const { sg, ...rest } = entry
    return rest
  })
}

/** Native goals keep their authored identity; only the relative tranche resets actual loads. */
function repeatNativeEntry(st:State,source:Entry,copied:import('./session-types').Config,index:ExerciseIndex):Entry {
  const prescription=source.target!.nativePrescription as import('../../contract/domain/native-prescription').NativePrescription
  if(hasNativeRelativeLoad(prescription)) {
    validateNativeRelativeRows(source,index)
    const built=buildNativeEntry(st,source.target!,null,index)
    const sets=built.sets.map(row=>{
      const next:Row={...structuredClone(source.sets?.find(original=>sameNativeRow(original.nativeRowIdentity,row.nativeRowIdentity)) || {}),...row,done:false}
      for(const key of ['w','r','rpe','rir','at','failure','sec','min','km','dist','speed','planSec','sides','drops','clusters','type','phase','warmup','weightOrigin','nativeActualLoad','nativeLoadEvaluation'])delete next[key]
      return next
    })
    // Repeat the athlete's completed extra sets as ordinary manual work. Keep their
    // relative placement, even when a removed authored row is rebuilt above.
    const extras=new Map<number,Row[]>()
    let after=0
    for(const original of source.sets || []) {
      if(original.nativeRowIdentity)after=original.nativeRowIdentity.rowOrdinal
      if(!original.nativeExtraIdentity || !original.done || isWarmupRow(original))continue
      const extra=nativeExtraRow(original,crypto.randomUUID())
      for(const key of ['at','rpe','rir','failure','sec','min','km','dist','speed','planSec','sides','drops','clusters','type','phase','warmup','weightOrigin'])delete extra[key]
      extras.set(after,[...(extras.get(after) || []),extra])
    }
    const repeated=[...(extras.get(0) || []),...sets.flatMap(row=>[row,...(extras.get(row.nativeRowIdentity!.rowOrdinal) || [])])]
    return {id:source.id,...(copied.sg?{sg:copied.sg}:{}),target:structuredClone(source.target),...(source.planned?{planned:structuredClone(source.planned)}:{}),plan:null,sets:repeated}
  }
  const done=(source.sets || []).filter(row=>row.done && !isWarmupRow(row))
  const sets=done.map(row=>{const next={...structuredClone(row),done:false};delete next.at;delete next.rpe;delete next.rir;delete next.failure;return next})
  return {id:source.id,...(copied.sg?{sg:copied.sg}:{}),target:structuredClone(source.target),plan:null,sets}
}
