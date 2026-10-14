import type { Workout, ProgrammeDefinition } from '../../contract/domain/state-doc'
import type { ExerciseIndex } from '../src/exercises'
import { materializeTmSeed, type TmSeedOptions } from '../src/materialize-tm-seed'
// Injected SeedInput uses the persisted Workout shape, including nullable target.
const currentResolver: (input: {
  state: {workouts?: Workout[]; [key: string]: unknown}
  definition: ProgrammeDefinition
  options: TmSeedOptions
  index: ExerciseIndex
}) => Record<string, number> = materializeTmSeed
void currentResolver
