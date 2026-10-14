import { editProgrammeSessions } from './programme-edit'
import { buildPlannedEntry } from './session-start'
import { canonicalExId, type ExerciseIndex } from './exercises'
import type { State, Session } from './session-types'
import type { SchedulingState } from './programme-sync'

export type OpenSlotState = State & SchedulingState & { active?: Session | null }

/** Resolve one exact active slot using the caller's catalogue and preserve later slot identity. */
export function chooseOpenSlot(S: OpenSlotState, index: number, exerciseId: string,
  expectedActiveId: unknown, expectedSlotId: unknown, exerciseIndex: ExerciseIndex): boolean {
  const active = S.active, entry = active?.entries?.[index]
  if (!active || active.id !== expectedActiveId || !entry?.target?.open || entry.target.slotId !== expectedSlotId) return false
  if (!exerciseIndex) throw new TypeError('chooseOpenSlot requires an explicit exercise index')
  const id = canonicalExId(exerciseId, exerciseIndex)
  if (!Object.hasOwn(exerciseIndex, id)) throw new Error('Resolve unknown exercises before saving the program.')
  if (entry.sets!.some(s => s.done || Object.values(s.sides || {}).some(side => side.done))) return false
  const routine = S.routines.find(r => r.id === entry.rid)
  const cfg = { ...entry.target, id }
  const built = buildPlannedEntry(S, cfg, routine, { noProg: routine?.excludeFromProgression === true }, exerciseIndex)
  active.entries![index] = { ...entry, ...built, id }
  if (routine) editProgrammeSessions(S, routine.id, ex => {
    const slot = ex.find(e => e.slotId === expectedSlotId && e.open)
    if (slot) slot.id = id
  }, true)
  return true
}
