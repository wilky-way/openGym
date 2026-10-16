import type { ExerciseIndex } from './exercises'
import type { ProgressionValidateResult } from '../domain/progression'
/** P1 closed authoring validation; the index is caller-owned for muscle scopes. */
export declare function validateProgression(definition: unknown, index?: ExerciseIndex): ProgressionValidateResult
