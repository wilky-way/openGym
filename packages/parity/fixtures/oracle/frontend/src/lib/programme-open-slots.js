import { editProgrammeSessions } from './programme-edit.js'
import { buildPlannedEntry } from './session-start.js'
import { CATALOGUE, canonicalExId } from './exercises.js'

/** Resolve one exact active slot and remember its choice for later unresolved occurrences. */
export function chooseOpenSlot(S, index, exerciseId, expectedActiveId, expectedSlotId) {
  const active=S.active, entry=active?.entries?.[index]
  if (!active || active.id !== expectedActiveId || !entry?.target?.open || entry.target.slotId !== expectedSlotId) return false
  if (! [...CATALOGUE,...(S.customEx || [])].some(e=>e.id===canonicalExId(exerciseId))) throw new Error('Resolve unknown exercises before saving the program.')
  if (entry.sets.some(s=>s.done || Object.values(s.sides || {}).some(x=>x.done))) return false
  const routine=S.routines.find(r=>r.id===entry.rid)
  const cfg={...entry.target,id:canonicalExId(exerciseId)}
  const built=buildPlannedEntry(S,cfg,routine,{noProg:routine?.excludeFromProgression===true})
  active.entries[index]={...entry,...built,id:cfg.id}
  if (routine) editProgrammeSessions(S,routine.id,ex=>{
    const slot=ex.find(e=>e.slotId===expectedSlotId && e.open)
    if (slot) slot.id=cfg.id
  },true)
  return true
}
