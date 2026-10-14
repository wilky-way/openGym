import type { EvaluateInput, EvaluateResult, PrescribedSet, ProgressionRule, ProgressionIssue, SlotRef, Why } from '../../../contract/domain/progression'
import type { OpenGymProgrammeDefinition, Slot } from '../../../contract/domain/programme-model.generated'
import type { ExerciseIndex } from '../exercises'

/** Frozen contract input plus an optional injected date cutoff. */
export type EngineInput = EvaluateInput & { now?: string }
export interface AuthoredSlot { ref: SlotRef; slot: Slot; order: number }
export interface WorkingSet { w?: number; r?: number; rir?: number; rpe?: number; done?: boolean; [key: string]: unknown }
export interface Exposure {
  ref: SlotRef; occurrenceId: string; date: string; start: number; workoutKey: string
  week: number; calendarWeek: number; sets: WorkingSet[]; target: Record<string, unknown>
  /** Completed scalar sets or individual limbs, matching core onerm scanning. */
  estimateSets?: WorkingSet[]
  exerciseId?: string; unit: 'lb' | 'kg'
}
export type TmTimeline = EvaluateResult['tm']
export interface RuleContext {
  input: EngineInput; definition: OpenGymProgrammeDefinition; authored: AuthoredSlot
  rule: ProgressionRule; exposures: Exposure[]; allExposures: Exposure[]; tm: TmTimeline; index: ExerciseIndex
  warnings: EvaluateResult['warnings']
}
/** Rule extensions preserve the shared replay and rounding invariants. */
export interface EngineExtensions {
  timeline?: (input: EngineInput, slots: AuthoredSlot[], exposures: Exposure[], seed: TmTimeline, index: ExerciseIndex) => TmTimeline
  setCount?: (context: RuleContext, count: number) => { count: number; why: Why[] }
  load?: (context: RuleContext) => PrescribedSet[] | undefined
  /** Return ordinary-direction load deltas; replay reflects them for assisted exercises. */
  stall?: (context: RuleContext, sets: PrescribedSet[]) => PrescribedSet[]
  /** Return ordinary-direction load deltas; replay reflects them for assisted exercises. */
  deload?: (context: RuleContext, sets: PrescribedSet[]) => PrescribedSet[]
}

export interface EngineResult extends EvaluateResult {
  slotErrors?: {code:'UNSUPPORTED_REPS'|'UNSUPPORTED_ASSISTED';slot:SlotRef}[]
  error?: { code: 'INVALID_LOAD'; message: string } | { code: 'INVALID_RULES'; issues: ProgressionIssue[] } | { code: 'INVALID_DEFINITION'; issues: {path:string;message:string}[] }
}
