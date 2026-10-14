import { createExerciseIndex, exOr, type ExerciseIndex } from '@opengym/core/exercises'
import { preview, type EngineInput, type EngineResult } from '@opengym/core/progression-engine/index'
import { isProgrammeDate } from '@opengym/core/programme-calendar'
import type { PrescribedSlot, SlotRef } from '@opengym/contract/domain/progression'
import { t, exerciseNameFor } from './i18n'
import type { StoreDocument } from '../store/useStore'

const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v : {}
const list = (v: unknown): any[] => Array.isArray(v) ? v : []
const records = (v: unknown) => list(v).map(record)
const refs = (slot: unknown) => list(record(record(slot).progression).rules)
const attachedSlots = (definition: unknown) => records(record(definition).weeks).flatMap(w => records(w.days).flatMap(day =>
  records(day.sessions).flatMap((session, i) => records(record(session.routineSnapshot).ex).filter(slot => refs(slot).length)
    .map(slot => ({ref: {week: w.index, day: day.key, session: session.sessionTemplateId ?? '', slot: slot.slotId ?? ''}, slot,
      sessionName: record(session.routineSnapshot).name || t('Session {0}', i + 1)})))))

export interface PrescriptionDisplay {
  result: EngineResult
  slots: { prescription: PrescribedSlot; name: string; sessionName: string }[]
}

/** The same preview inputs as progression API, evaluated locally. Never writes or materializes a TM seed. */
export function progressionDisplay(S: StoreDocument, definition: unknown, cycle: EngineInput['cycle'] | undefined,
  weeks: number[], today: string, index: ExerciseIndex = createExerciseIndex(S.customEx)): PrescriptionDisplay | null {
  const attached = attachedSlots(definition)
  if (!attached.length) return null
  // Progression API refuses malformed cycle dates before preview; never show a load from date rollover.
  if (cycle && (!isProgrammeDate(cycle.week1StartDate) || !Number.isInteger(cycle.weekIndex))) return {
    slots: [], result: {weeks: [], tm: {}, warnings: [], error: {code: 'INVALID_DEFINITION',
      issues: [{path: 'cycle', message: 'Invalid cycle date or week'}]}},
  }
  const warnings: EngineResult['warnings'] = []
  const logs = list(S.workouts).filter((v, i) => {
    if (isProgrammeDate(record(v).d)) return true
    warnings.push({code: 'log.invalid-date', message: `Excluded log ${i}: expected a valid YYYY-MM-DD date.`})
    return false
  })
  const result = preview({definition, cycle, logs, weeks, asOf: today, now: today,
    profile: {...S, unit: S.unit === 'kg' ? 'kg' : 'lb', effortScale: S.effort === 'rpe' || S.effortScale === 'rpe' ? 'rpe' : 'rir'}}, {}, index)
  const merged = new Map([...result.warnings, ...warnings].map(w => [JSON.stringify(w), w]))
  result.warnings = [...merged].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, w]) => w)
  const slots = result.weeks.flatMap(w => w.slots).flatMap(prescription => {
    const authored = attached.find(a => sameSlot(a.ref, prescription.ref))
    if (!authored) return [] // Rule-free slots keep their existing authored display.
    const name = authored.slot.open && !prescription.exerciseId ? authored.slot.label || t('Choose exercise')
      : exerciseNameFor(exOr(prescription.exerciseId ?? '', index))
    return [{prescription, name, sessionName: authored.sessionName}]
  })
  return {result, slots}
}

export const sameSlot = (a: SlotRef, b: SlotRef) => a.week === b.week && a.day === b.day && a.session === b.session && a.slot === b.slot

// Sync store uses immutable drafts. One preview per state/cycle/week/day covers all rendered entries;
// a local edit, history pull, account change or catalogue edit creates a new state and cache.
const entryPreviews = new WeakMap<StoreDocument, Map<object, Map<string, PrescriptionDisplay | null>>>()
function cachedEntryPreview(S: StoreDocument, cycle: any, week: number, today: string) {
  let cycles = entryPreviews.get(S); if (!cycles) entryPreviews.set(S, cycles = new Map())
  let displays = cycles.get(cycle); if (!displays) cycles.set(cycle, displays = new Map())
  const key = JSON.stringify([week, today, cycle, S.customEx, S.unit, S.effort, S.effortScale, S.plates, S.barWeights, S.dumbbells, S.dbLoad])
  if (!displays.has(key)) displays.set(key, progressionDisplay(S, cycle.snapshot, cycle, [week], today))
  return displays.get(key)!
}
/** No positional/exercise-id fallback: duplicates and stale session identities must not guess a target. */
export function entryPrescription(S: StoreDocument, entry: Record<string, any>, today: string): PrescriptionDisplay | null {
  const matches = list(S.programmes?.cycles).flatMap(cycle => list(cycle.occurrences)
    .filter(o => o.instanceId === entry.occurrenceId).map(occurrence => ({cycle, occurrence})))
  if (matches.length !== 1 || !entry.target?.slotId) return null
  const {cycle, occurrence} = matches[0]!
  const ref = {week: occurrence.weekIndex, day: occurrence.dayKey, session: occurrence.sessionTemplateId ?? '', slot: entry.target.slotId}
  const authored = attachedSlots(cycle.snapshot).filter(a => sameSlot(a.ref, ref))
  if (authored.length !== 1 || authored[0]!.slot.id && authored[0]!.slot.id !== entry.id) return null
  const display = cachedEntryPreview(S, cycle, occurrence.weekIndex, today)
  if (!display) return null
  return {slots: display.slots.filter(({prescription: p}) => sameSlot(p.ref, ref)), result: {...display.result,
    warnings: display.result.warnings.filter(w => !w.ref || sameSlot(w.ref, ref)),
    ...(display.result.slotErrors ? {slotErrors: display.result.slotErrors.filter(e => sameSlot(e.slot, ref))} : {})}}
}
