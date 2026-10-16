// Dependency-free; keep api/programme-prescription.js identical (parity test).
const copy = x => JSON.parse(JSON.stringify(x))
export const authoredPrescriptionFields = ['setTargets','generatedRules','authoredInstructions','noteKind','instructions','open','label','target','setRepsMin','tm','repsMin']

/** Settings edit the shape, while the authored effort and rule text remain attached. */
export function retainProgrammePrescription(previous, next) {
  if (!authoredPrescriptionFields.some(k => k !== 'repsMin' && previous?.[k] != null)) return next
  for (const key of authoredPrescriptionFields) if (!(key in next) && previous?.[key] != null) next[key] = copy(previous[key])
  const count = Math.max(1, Math.min(100, next.pyramid?.length || Number(next.sets) || 1))
  // Added rows repeat the final back-off prescription; removed rows trim its tail.
  const resize = rows => Array.from({length:count},(_,i) => copy(rows[Math.min(i,rows.length-1)]))
  if (next.setTargets?.length) next.setTargets = resize(next.setTargets)
  if (next.tm?.percentages?.length) {
    const percentages = resize(next.tm.percentages)
    if (next.pyramid?.length) next.tm = {...next.tm, percentages}
    else {
      // Turning off a pyramid keeps its displayed percentages without an invalid TM shape.
      next.setTargets = percentages.map((pct,i) => ({...next.setTargets?.[i],pct}))
      delete next.tm
    }
  }
  if (next.setRepsMin?.length) next.setRepsMin = resize(next.setRepsMin).map((min,i) => {
    const reps = next.pyramid?.[i] ?? next.reps
    return min == null ? null : reps === 'max' ? min : Math.min(min, Number(reps) || min)
  })
  if (next.repsMin != null && next.reps !== 'max') next.repsMin = Math.min(next.repsMin, Number(next.reps) || next.repsMin)
  return next
}
