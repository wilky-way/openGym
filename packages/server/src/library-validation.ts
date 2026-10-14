import { programmeConformance } from '../../core/src/programme-conformance'
import { createExerciseIndex } from '@opengym/core/exercises'
import type { ValidateResult, Level } from '@opengym/contract/http/api'

export const LEVELS: readonly Level[] = ['Invalid', 'Valid', 'Complete', 'Ready']
export function validateDefinition(definition: unknown, customEx?: unknown): ValidateResult {
  const index = createExerciseIndex(customEx)
  // Include this profile's custom exercises in the semantic catalogue as well as
  // the lookup index. Never register them in a process-global catalogue.
  let result: ReturnType<typeof programmeConformance>
  try { result = programmeConformance(structuredClone(definition), { catalogue: Object.values(index) }, index) }
  catch { result = { level: 'Invalid', issues: [{ code: 'structure.invalid', location: { path: '' }, fix: 'Correct the program structure.', requiredFor: 'Valid' }] } }
  const byCode: Record<string, number> = {}, byLevel: Record<string, number> = {}
  for (const issue of result.issues) {
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1
    byLevel[issue.requiredFor] = (byLevel[issue.requiredFor] ?? 0) + 1
  }
  return { ...result, nextLevel: LEVELS[LEVELS.indexOf(result.level) + 1] ?? null, counts: { byCode, byLevel } }
}
