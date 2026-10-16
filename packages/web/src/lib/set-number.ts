import { isWarmupRow } from '@opengym/core/workout-model'

/** The number a set row shows: counted per phase (warm-ups and work sets each from 1), and a
 *  timed per-side L/R pair as one set. */
export function setNumberAt(sets: any, i: any) : any {
  const s = sets[i]
  const warm = isWarmupRow(s)
  const phaseNum = sets.slice(0, i + 1).filter((x: any ) : any => isWarmupRow(x) === warm).length
  return s?.side ? Math.ceil(phaseNum / 2) : phaseNum
}
