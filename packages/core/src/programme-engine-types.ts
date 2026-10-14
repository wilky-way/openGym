/** Tolerant persisted shapes used by the programme draft transitions. */
import type { Routine, Workout, Queue, Programmes, Unit, CustomExercise } from '../../contract/domain/state-doc'
export type { ProgrammeDefinition, ProgrammeWeek, ProgrammeDay, ProgrammeCycle, ProgrammeOccurrence, Routine, RoutineExercise, SetTarget } from '../../contract/domain/state-doc'
export interface ProgrammeState {
  unit?: Unit
  routines: Routine[]
  workouts?: Workout[]
  programmes?: Programmes
  queue?: Queue | null
  dayPlan?: Record<string, string>
  customEx?: CustomExercise[]
  active?: { programmeInstance?: {cycleId?: string}; routineIds?: string[]; [key: string]: unknown } | null
  _rev?: number
  _wid?: string
  [key: string]: unknown
}
export interface ActivationOptions {
  cycleId?: string; today?: string; startsOn?: string; week1StartDate?: string; lengthWeeks?: number
  weekIndex?: number; lap?: number; end?: string; perWeek?: number; now?: number
  existingRoutineIds?: string[] | Record<string, string>; preApp?: unknown; seriesId?: string; tm?: Record<string, number>
}

// Explicit projection types keep frozen dependency declarations from leaking `any` to callers.
import type { ProgrammeOccurrence, ProgrammeWeek, ProgrammeDefinition, RoutineExercise, SetTarget } from '../../contract/domain/state-doc'
export interface ProjectedProgrammeOccurrence extends ProgrammeOccurrence {
  mode: string
  projected?: boolean
  pinConflict?: boolean
}
export interface PendingProgrammeOccurrence extends ProjectedProgrammeOccurrence {date: string; projected: true}
export interface ProgrammeProjectionWeek {
  weekId: string; weekIndex: number; inserted: boolean; mode: string
  occurrences: ProjectedProgrammeOccurrence[]; startDate: string | null; endDate: string | null
  done: number; skipped: number; planned: number; closed: boolean
}
export interface ProgrammeProjection {
  occurrences: ProjectedProgrammeOccurrence[]; pending: PendingProgrammeOccurrence[]; next: PendingProgrammeOccurrence | null
  weeks: ProgrammeProjectionWeek[]; anchor: string; lastDoneDate: string | null
  endDate: string | null; nextBlockStart: string | null
}
export interface DisplayProgrammeSlot extends Pick<RoutineExercise, 'id' | 'sets' | 'reps' | 'repsMin' | 'weight' | 'slotId' | 'pyramid' | 'tm' | 'open' | 'label'> {
  target: SetTarget | null
  setTargets?: (SetTarget | null)[]
  instructions: string
  note: string
  [key: string]: unknown
}
export interface DisplayProgrammeSession {
  sessionTemplateId?: string
  routineSnapshot: {name?: string; prog?: string; ex: DisplayProgrammeSlot[]; [key: string]: unknown}
  [key: string]: unknown
}
export interface DisplayProgrammeDay {key: string; ordinal?: number; sessions: DisplayProgrammeSession[]; [key: string]: unknown}
export interface DisplayProgrammeWeek extends Pick<ProgrammeWeek, 'index' | 'weekId' | 'orderIndex' | 'label' | 'unit' | 'mode' | 'rir' | 'deload' | 'sourceWeek'> {
  rpe?: number; effort: SetTarget | null; effortLabel: string; days: DisplayProgrammeDay[]; [key: string]: unknown
}
export interface DisplayProgrammeDefinition extends Pick<ProgrammeDefinition, 'id' | 'name' | 'short' | 'unit' | 'source' | 'instructions'> {
  weeks: DisplayProgrammeWeek[]
  [key: string]: unknown
}
