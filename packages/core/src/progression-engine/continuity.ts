import type { AuthoredSlot, EngineInput, Exposure } from './types'
import { authoredSlots, cmp, record, list, replayExposures, sameSeries } from './replay'
import { progressionExposures } from './deload'
import type { OpenGymProgrammeDefinition } from '../../../contract/domain/programme-model.generated'
import { programmeSchemaIssues } from '../programme-model-schema'

/** Explicit opt-in for identical load rules on repeated source slots. No TM continuity. */
export function continuityKey(a: AuthoredSlot): string | undefined {
  const key = record(a.slot.progression?.parameters).continuityKey
  return typeof key === 'string' && key.length > 0 && key.length <= 200 ? key : undefined
}
export function hasLoadContinuity(definition: unknown): boolean {
  return list(record(definition).weeks).some(w=>list(record(w).days).some(d=>list(record(d).sessions).some(s=>
    list(record(record(s).routineSnapshot).ex).some(e=>typeof record(record(record(e).progression).parameters).continuityKey==='string'))))
}
function signature(d: OpenGymProgrammeDefinition, a: AuthoredSlot): string | undefined {
  const rules = a.slot.progression?.rules?.map(id => d.progressionRules?.find(r => r.id === id)) ?? []
  if (rules.length !== 1 || !rules[0] || !['linear', 'double'].includes(rules[0].kind)) return
  const stall = d.progressionRules?.find(r => r.id === a.slot.progression?.onStall)
  if (stall && (stall.kind !== 'stall' || stall.appliesTo !== 'load')) return
  // Rule IDs may differ between equivalent source slots. Other parameters must agree.
  const shape = (r: object) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id').sort(([a], [b]) => cmp(a, b)))
  return JSON.stringify([a.slot.id, d.unit, a.slot.progression?.parameters?.repProgression ?? null, shape(rules[0]), stall ? shape(stall) : null])
}

/** A key alone cannot opt TM, volume or unsupported rule combinations into live history. */
export function compatibleLoadContinuity(d: OpenGymProgrammeDefinition, a: AuthoredSlot): boolean {
  return !!continuityKey(a) && !!signature(d,a)
}

/** Only explicit, unambiguous repeat/restart ancestors can contribute history. */
export function continuityExposures(input: EngineInput, target: AuthoredSlot, current: Exposure[]): Exposure[] {
  const definition = input.definition as OpenGymProgrammeDefinition
  const key = continuityKey(target), expected = signature(definition, target)
  if (!key || !expected || !input.cycle) return current.filter(e => sameSeries(e.ref, target.ref))
  const accepts = (d: OpenGymProgrammeDefinition, a: AuthoredSlot) => continuityKey(a) === key && signature(d, a) === expected
  const collect = (d: OpenGymProgrammeDefinition, exposures: Exposure[]) => {
    const slots = authoredSlots(d)
    return exposures.filter(e => {
      const matches = slots.filter(a => a.ref.week === e.ref.week && sameSeries(a.ref, e.ref))
      return matches.length === 1 && accepts(d, matches[0]!) && (!e.exerciseId || e.exerciseId === target.slot.id)
    })
  }
  const history = collect(definition, current)
  const cycles = (input.historyCycles ?? []).map(record)
  const matching = cycles.filter(c => c.id === input.cycle!.id)
  let child = matching.length === 1 ? matching[0] : undefined
  const seen = new Set([input.cycle.id])
  let anchor = input.cycle.week1StartDate
  while (child) {
    const candidates = cycles.filter(c => (c.repeatedAs === child!.id || c.restartedAs === child!.id) &&
      c.programmeId === child!.programmeId && (c.seriesId || c.id) === (child!.seriesId || child!.id) &&
      (c.status === 'archived' || c.status === 'finished') && typeof c.id === 'string' && !seen.has(c.id) &&
      typeof c.week1StartDate === 'string' && c.week1StartDate <= String(child!.week1StartDate))
    if (candidates.length !== 1) break
    const parent = candidates[0]!
    seen.add(String(parent.id))
    if (programmeSchemaIssues(parent.snapshot).length || !Array.isArray(parent.occurrences)) break
    const d = parent.snapshot as OpenGymProgrammeDefinition
    if (d.id !== definition.id) break
    const parentInput = {...input, definition: d, cycle: parent as unknown as NonNullable<EngineInput['cycle']>}
    history.push(...collect(d, progressionExposures(d, replayExposures(parentInput, authoredSlots(d)))))
    anchor = String(parent.week1StartDate)
    child = parent
  }
  const unique = new Map<string, Exposure>()
  for (const e of history) unique.set(JSON.stringify([e.workoutKey, e.occurrenceId, e.ref.slot]), {
    ...e, ref: target.ref, week: target.ref.week,
    calendarWeek: Math.max(1, 1 + Math.floor((Date.parse(e.date) - Date.parse(anchor)) / 604800000)),
  })
  return [...unique.values()].sort((a,b) => cmp(a.date,b.date) || a.start-b.start || cmp(a.workoutKey,b.workoutKey) || cmp(a.occurrenceId,b.occurrenceId))
}
