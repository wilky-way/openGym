import type { Workout, ProgrammeDefinition } from '../../contract/domain/state-doc'
import type { ExerciseIndex } from '../src/exercises'
import { materializeTmSeed, type TmSeedOptions } from '../src/materialize-tm-seed'
// W08's injected SeedInput uses the persisted Workout shape, including nullable target.
const w08Resolver: (input: {
  state: {workouts?: Workout[]; [key: string]: unknown}
  definition: ProgrammeDefinition
  options: TmSeedOptions
  index: ExerciseIndex
}) => Record<string, number> = materializeTmSeed
void w08Resolver
