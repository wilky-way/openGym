import { resolveOccurrences } from './programme-sync.js'
import { occurrenceOrder } from './programme-calendar.js'
import { uid } from './format.js'

const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x))
// Distinct legacy lifts share an identity. Unidentified twins stay local to the session.
export function programmeSlotIds(ex, namespace = 'legacy') {
  const counts = new Map()
  for (const e of ex) counts.set(e.id, (counts.get(e.id) || 0) + 1)
  const ambiguous = new Set(ex.filter(e => counts.get(e.id) > 1 && (!e.slotId || e.slotId.startsWith('exercise:'))).map(e => e.id))
  for (const e of ex) {
    if (ambiguous.has(e.id)) { e.slotId ||= `${namespace}:${uid()}`; e.slotScope = 'session' }
    else e.slotId ||= `exercise:${e.id}:1`
  }
  return ex
}
export const programmeSessionKey = (cycle, o) => o.sessionTemplateId || cycle.occurrences.filter(x => x.weekIndex === o.weekIndex && x.dayKey === o.dayKey && x.weekId === o.weekId).findIndex(x => x.instanceId === o.instanceId)

export function programmeSnapshotSession(cycle,o) {
  const week=cycle.snapshot?.weeks.find(w=>(w.weekId || String(w.index))===(o.weekId || String(o.weekIndex)))
  const day=week?.days.find(d=>d.key===o.dayKey)
  return o.sessionTemplateId ? day?.sessions.find(s=>s.sessionTemplateId===o.sessionTemplateId) : day?.sessions[Number(programmeSessionKey(cycle,o)) || 0]
}
const scopedOccurrences = (S, routine) => {
  const cycle = S.programmes?.cycles.find(c => c.id === routine?.programme?.cycleId)
  const current = cycle?.occurrences.find(o => o.instanceId === routine.programme.instanceId)
  return current ? resolveOccurrences(cycle, S.workouts).filter(o => o.status === 'pending' && o.dayKey === current.dayKey && programmeSessionKey(cycle,o) === programmeSessionKey(cycle,current) && occurrenceOrder(o) >= occurrenceOrder(current)) : []
}
export function canScopeProgrammeSessions(S, routineId) {
  const routine = S.routines.find(r => r.id === routineId)
  const targets = [routine, ...scopedOccurrences(S,routine).map(o => S.routines.find(r => r.id === o.routineId))].filter(Boolean)
  return !targets.some(r => r.ex.some(e => e.slotScope === 'session' || (r.ex.filter(x => x.id === e.id).length > 1 && (!e.slotId || e.slotId.startsWith('exercise:')))))
}

/** Derive intent once, then match stable slots in the same session of unresolved later stages. */
export function editProgrammeSessions(S, routineId, edit, later = false) {
  const routine = S.routines.find(r => r.id === routineId)
  if (!routine) return
  if (!routine.programme) { edit(routine.ex); return }
  const cycle = S.programmes?.cycles.find(c => c.id === routine.programme.cycleId)
  const current = cycle?.occurrences.find(o => o.instanceId === routine.programme.instanceId)
  const scoped = later && canScopeProgrammeSessions(S, routineId)
  const before = clone(programmeSlotIds(routine.ex))
  edit(routine.ex)
  for (const e of routine.ex) e.slotId ||= `added:${uid()}`
  const after = clone(routine.ex), old = new Map(before.map(e => [e.slotId, e]))
  const removed = new Set(before.filter(e => !after.some(a => a.slotId === e.slotId)).map(e => e.slotId))
  const reordered = before.filter(e => !removed.has(e.slotId)).map(e => e.slotId).join('|') !== after.filter(e => old.has(e.slotId)).map(e => e.slotId).join('|')
  const targets = scoped && current ? scopedOccurrences(S,routine) : [current].filter(Boolean)
  for (const o of targets) {
    const r = S.routines.find(r => r.id === o.routineId)
    if (!r) continue
    if (r !== routine) {
      programmeSlotIds(r.ex)
      r.ex = r.ex.filter(e => !removed.has(e.slotId))
      for (const a of after) {
        const b = old.get(a.slotId), slot = r.ex.find(e => e.slotId === a.slotId)
        if (!b) { if (!slot) r.ex.push(clone(a)); continue }
        if (!slot) continue // A later stage may deliberately omit this lift.
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
          if (k in a) slot[k] = clone(a[k]); else delete slot[k]
        }
      }
      if (reordered) {
        const by = new Map(r.ex.map(e => [e.slotId, e]))
        const ordered = after.map(e => by.get(e.slotId)).filter(Boolean)
        let i = 0; r.ex = r.ex.map(e => old.has(e.slotId) ? ordered.filter(e => old.has(e.slotId))[i++] : e)
      }
    }
    const session=programmeSnapshotSession(cycle,o)
    if (session?.routineSnapshot) session.routineSnapshot.ex = clone(r.ex)
  }
}
