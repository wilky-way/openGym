import { ruleInstructions } from './programme-import'
import { effortOf } from '@opengym/core/history'
import type { ProgrammeState, RoutineExercise } from './programme-engine-types'
interface InstructionConfig extends RoutineExercise {
  generatedRules?: unknown[]
  authoredInstructions?: string
}

/** Authored prose stays opaque; generated rules carry their own numeric provenance. */
export function programmeInstructions(S: ProgrammeState, cfg?: InstructionConfig | null) {
  if (!cfg?.generatedRules) return cfg?.instructions || ''
  return [ruleInstructions({sets: cfg.generatedRules}, effortOf(S)), cfg.authoredInstructions]
    .filter(Boolean).join('\n\n')
}
