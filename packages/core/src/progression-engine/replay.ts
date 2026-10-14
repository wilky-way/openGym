import { isSideSet, isWarmupRow } from '@opengym/core/workout-model'
import { metricRowsForEntry } from '@opengym/core/history'
import type { OpenGymProgrammeDefinition } from '../../../contract/domain/programme-model.generated'
import type { EvaluateResult } from '../../../contract/domain/progression'
import type { AuthoredSlot, EngineInput, Exposure, WorkingSet } from './types'

export const record = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {}
export const list = (x: unknown): unknown[] => Array.isArray(x) ? x : []
export const finite = (x: unknown): number | undefined => typeof x === 'number' && Number.isFinite(x) ? x : undefined
/** Prescription effort is stricter than the permissive display estimator. */
export function loggedRir(set: WorkingSet): number | undefined {
  const rir = finite(set.rir), rpe = finite(set.rpe)
  return rir !== undefined && rir >= 0 && rir <= 10 ? rir : rpe !== undefined && rpe >= 1 && rpe <= 10 ? 10 - rpe : undefined
}
function prescriptionEffort(set: WorkingSet, ref: AuthoredSlot['ref'], warnings: EvaluateResult['warnings']): WorkingSet {
  const out = { ...set }
  for (const key of ['rir', 'rpe'] as const) {
    const value = set[key], number = finite(value)
    if (value != null && (number === undefined || number < (key === 'rpe' ? 1 : 0) || number > 10)) {
      delete out[key]
      warnings.push({ code: 'log.effort-invalid', ref, message: 'Treat invalid logged effort as missing; use RPE 1–10 or RIR 0–10.' })
    }
  }
  return out
}
export const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export function authoredSlots(d: OpenGymProgrammeDefinition): AuthoredSlot[] {
  const out: AuthoredSlot[] = []
  for (const w of [...d.weeks].sort((a,b) => a.index-b.index)) for (const day of w.days) for (const s of day.sessions) for (const slot of s.routineSnapshot.ex) {
    out.push({ ref: { week: w.index, day: day.key, session: s.sessionTemplateId ?? '', slot: slot.slotId ?? '' }, slot, order: out.length })
  }
  return out
}
export const sameSeries = (a: AuthoredSlot['ref'], b: AuthoredSlot['ref']) => a.day === b.day && a.session === b.session && a.slot === b.slot
const stamp = (d: string) => Date.parse(`${d}T00:00:00Z`)
const validDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(stamp(d)) && new Date(stamp(d)).toISOString().slice(0,10) === d
export function weekDate(input: EngineInput, week: number): string | undefined {
  const start = input.cycle?.week1StartDate
  if (!start || !Number.isFinite(stamp(start))) return undefined
  return new Date(stamp(start) + (week - 1) * 604800000).toISOString().slice(0,10)
}
/** A current-week preview can observe events effective after that week's start. */
export function evaluationDate(input: EngineInput, week: number): string | undefined {
  const date = weekDate(input, week), cutoff = input.asOf ?? input.now
  return date && cutoff && week === input.cycle?.weekIndex && cutoff > date ? cutoff : date
}
/** Same precedence as resolveOccurrences: surviving entry IDs, then instance, then legacy routine. */
export function replayExposures(input: EngineInput, slots: AuthoredSlot[], warnings: EvaluateResult['warnings'] = []): Exposure[] {
  const cycle = input.cycle
  if (!cycle) return []
  // First identity wins, matching the shared occurrence resolver's identity map.
  const seen = new Set<string>()
  const occurrences = (cycle.occurrences ?? []).filter(o=>typeof o.instanceId === 'string' && !!o.instanceId && !seen.has(o.instanceId) && !!seen.add(o.instanceId))
  const cutoff = input.asOf ?? input.now
  const out: Exposure[] = []
  const seenWorkouts = new Set<string>()
  for (const raw of input.logs) {
    const w = record(raw)
    const identity = typeof w.id === 'string' && w.id ? w.id : typeof w.key === 'string' && w.key ? w.key : undefined
    if (identity) { if (seenWorkouts.has(identity)) continue; seenWorkouts.add(identity) }
    const date = typeof w.d === 'string' ? w.d : ''
    if (date && !validDate(date)) {
      warnings.push({code:'log.date-invalid',message:'Exclude a workout with an invalid log date; use a real YYYY-MM-DD calendar date.'})
      continue
    }
    if (!date || (cutoff && date > cutoff) || w.end === null || w.active === true) continue
    const entries = list(w.entries).map(record), ids = entries.map(e => e.occurrenceId).filter(x => typeof x === 'string' && x)
    const instance = record(w.programmeInstance), start = finite(w.start) ?? 0
    const matched = occurrences.filter(o => {
      if (o.status === 'skipped') return false
      if (ids.length) return ids.includes(o.instanceId)
      if (instance.cycleId === cycle.id && instance.instanceId === o.instanceId) return true
      if (w.programmeInstance || ids.length || !Number.isFinite(cycle.since)) return false
      const rids = Array.isArray(w.routineIds) ? w.routineIds : w.routineId ? [w.routineId] : []
      return rids.includes(o.routineId) && (start >= Number(cycle.since) || cycle.strict !== true && typeof cycle.startsOn === 'string' && date >= cycle.startsOn && !!o.routineName && String(w.name ?? '').split(' + ').includes(o.routineName))
    })
    for (const o of matched) {
      const candidates = slots.filter(s => s.ref.week === o.weekIndex && s.ref.day === o.dayKey && (!o.sessionTemplateId || s.ref.session === o.sessionTemplateId))
      const claimed = new Set<unknown>()
      for (const a of candidates) {
        const entry = entries.find(e => !claimed.has(e) && (!ids.length || e.occurrenceId === o.instanceId) && (ids.length || !e.rid || e.rid===o.routineId) &&
          (record(e.target).slotId ? record(e.target).slotId === a.ref.slot : e.slotId ? e.slotId === a.ref.slot : e.id === a.slot.id))
        if (!entry) continue
        claimed.add(entry)
        const work = list(entry.sets).map(record).filter(s => !isWarmupRow(s)).map((s, workIndex) => prescriptionEffort({ ...s, workIndex } as WorkingSet, a.ref, warnings))
        const sets = work.filter(s => s.done === true)
        // The parent w/r of a side row is a summary, never an estimator input.
        // A completed limb still counts when the other limb is unchecked.
        const estimateSets = (metricRowsForEntry({ ...entry, sets: work }, 'reps') as WorkingSet[]).flatMap(s => isSideSet(s)
          ? ['L', 'R'].flatMap(side => {
            const limb = record(record(s.sides)[side])
            return limb.done === true ? [prescriptionEffort({ ...limb, workIndex: s.workIndex, side } as WorkingSet, a.ref, warnings)] : []
          })
          : s.done === true ? [s] : [])
        // A logged entry with no done work is a failure; an absent entry is not an exposure.
        out.push({ ref: a.ref, occurrenceId: o.instanceId, date, start, workoutKey: String(w.id ?? w.key ?? ''), week: o.weekIndex,
          calendarWeek: Math.max(1, 1 + Math.floor((stamp(date)-stamp(cycle.week1StartDate))/604800000)),
          sets, estimateSets, target: record(entry.target), exerciseId: typeof entry.id === 'string' ? entry.id : undefined,
          unit: w.unit === 'lb' || w.unit === 'kg' ? w.unit : input.profile.unit })
      }
    }
  }
  return out.sort((a,b) => cmp(a.date,b.date) || a.start-b.start || cmp(a.workoutKey,b.workoutKey) || cmp(a.occurrenceId,b.occurrenceId) || cmp(a.ref.slot,b.ref.slot))
}
