/** Frozen modern log, or a same-date legacy routine log, for a resolved occurrence. */
export function loggedProgrammeWorkout(workouts, occurrence) {
  return (workouts || []).filter(w => {
    const ids = (w.entries || []).map(e => e.occurrenceId).filter(Boolean)
    if (ids.length) return ids.includes(occurrence.instanceId)
    if (w.programmeInstance?.instanceId === occurrence.instanceId) return true
    return occurrence.status === 'done' && w.d === occurrence.date && (w.routineIds || [w.routineId]).includes(occurrence.routineId)
  }).sort((a,b) => String(a.d).localeCompare(String(b.d)) || (Number(a.start)||0)-(Number(b.start)||0)).at(-1)
}

/** Count authored work sets using the same deload floor/minimum as session start. */
export function programmeWeekSets(week) {
  const factor = week.mode === 'deload' ? week.deload?.setsFactor ?? .5 : 1
  return (week.days || []).flatMap(d => d.sessions || []).flatMap(s => s.routineSnapshot?.ex || [])
    .reduce((n,e) => n + Math.max(1, Math.floor((Number(e.sets) || 1) * factor)), 0)
}
