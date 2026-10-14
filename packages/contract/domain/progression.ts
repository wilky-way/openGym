/**
 * Progression engine — frozen contract v1 (DECISIONS "Progression systems", 2026-10-12).
 *
 * A declarative, deterministic engine: rules are closed JSON data stored with the programme definition
 * (versioned with it in the library), evaluated by pure code in packages/core (`core/src/progression-engine/*`),
 * served by the server and the MCP. No expressions, no scripts, no LLM at runtime. Every prescribed number
 * carries a `Why`.
 *
 * Relationship to legacy (must not change):
 *  - Routine-level policies in lib/progression.js (`off|linear|greyskull|double|triple|time`,
 *    `nextPrescription`) keep their exact behaviour for routines that are NOT programme-owned. Parity-gated.
 *  - Slot `progression {kind, instructions, parameters?, provenance?}` (schema $defs/progression) stays valid
 *    and keeps meaning "instruction text for the athlete". The engine only acts on a slot whose
 *    `progression.rules` lists rule ids (optional, additive schema field).
 *  - Slot `target {rir|rpe|pct}` / `setTargets[]` and `tm {key, percentages, reference}` keep their meaning;
 *    rules may *generate* them for a week instead of them being authored per week.
 *  - the operator 10-12 rule "show RIR targets, no load prediction" still holds for slots without rules: the
 *    engine never prescribes a load unless a rule that produces loads (percentage, rpe-load, linear, double)
 *    is attached. That is an explicit authoring choice, shown with its Why.
 */
import type { Stamp, ISODate, Unit, ProgrammeOccurrence } from './state-doc'

export const PROGRESSION_CONTRACT_VERSION = 1 as const

// ───────────── references ─────────────

/** Training-max / 1RM key: shared across slots (e.g. 'squat'). Values live in cycle.tm[key] (existing field). */
export type LiftKey = string
/** A rule id, unique within one definition: /^[a-z0-9][a-z0-9-]{0,63}$/ */
export type RuleId = string
/** Address of a slot by stable identity (PROGRAM-API SlotRef). */
export interface SlotRef { week: number; day: string; session: string; slot: string }
/** Set index within a slot's working sets, 0-based; must exist (validator checks against the slot's set count). */
export type SetIndex = number

export interface Rounding {
  /** smallest load step in the definition unit; required (no silent default) */
  increment: number
  mode: 'nearest' | 'down' | 'up'
  /** true: snap to what the athlete's plate/dumbbell inventory can build (core plates.plateStack/dropGrid);
   *  falls back to `increment` when the profile has no inventory. Why records which was used. */
  usePlates: boolean
}

// ───────────── rules (closed: additionalProperties:false everywhere) ─────────────

/** % of a training max or 1RM per week and set (percentage-wave waves, Sheiko tables). */
export interface PercentageRule {
  id: RuleId; kind: 'percentage'
  ref: { lift: LiftKey; basis: 'tm' | '1rm' }
  /** week.index → per-set prescription; weeks not listed → the rule prescribes nothing that week */
  weeks: Record<string, { pct: number; reps: number | 'amrap'; repsMin?: number }[]>   // pct in (0, 1.5]
  rounding: Rounding
}

/** Load from an RPE/RIR target and an e1RM estimated from logged sets (RTS / effort-based style). */
export interface RpeLoadRule {
  id: RuleId; kind: 'rpe-load'
  lift: LiftKey
  /** per week.index (or '*' for every week) and set: reps and an effort target in either scale */
  weeks: Record<string, { reps: number; rpe?: number; rir?: number }[]>
  e1rm: {
    /** which logged sets feed the estimate: the exercise(s) mapped to `lift` */
    window: { sessions: number } | { days: number }
    pick: 'best' | 'latest' | 'median'
    /** formula id from core onerm.FORMULAS; 'profile' = the profile's oneRmFormula setting */
    formula: 'profile' | 'epley' | 'brzycki' | 'lombardi' | string
    /** RIR-adjusted reps (core onerm.estimate1RM(w, r, formula, rir)) when logged sets carry effort */
    useLoggedEffort: boolean
  }
  /** load = e1rm × pctOf(reps + RIR) using the SAME formula inverted; no lookup table in v1 */
  rounding: Rounding
  /** no usable logged set in the window → 'athlete-picks' (show target only) or a fixed fallback */
  whenNoData: { kind: 'athlete-picks' } | { kind: 'percent-of-tm'; pct: number }
}

/** Rep-range / double progression. */
export interface DoubleRule {
  id: RuleId; kind: 'double'
  repsLow: number; repsHigh: number
  condition: 'all-sets' | 'first-set' | 'total-reps'
  /** for 'total-reps': threshold = sets × repsHigh unless set */
  totalThreshold?: number
  increment: number; unit: Unit
  afterIncrease: 'reset-to-low'
  rounding: Rounding
}

/** Fixed increment per N successful sessions or weeks. */
export interface LinearRule {
  id: RuleId; kind: 'linear'
  increment: number; unit: Unit
  every: { sessions: number } | { weeks: number }
  success: 'all-sets-all-reps' | 'last-set-reps'
  rounding: Rounding
}

/** AMRAP result bumps the training max (percentage-wave style). Evaluated at week boundaries. */
export interface AmrapTmRule {
  id: RuleId; kind: 'amrap-tm'
  lift: LiftKey
  /** which slot+set is the AMRAP that drives the bump */
  source: { slot: SlotRef; set: SetIndex }
  /** first matching band wins, ordered by minRepsOver desc; reps over the prescribed minimum */
  bands: { minRepsOver: number; tmDelta: number }[]
  unit: Unit
  /** when the bump applies */
  at: 'end-of-week' | 'end-of-cycle-lap'
}

/** What to do when a slot stalls. Attached to load rules via `onStall`. */
export interface StallRule {
  id: RuleId; kind: 'stall'
  /** consecutive failed exposures before acting; failure = the load rule's success condition not met */
  after: number
  action:
    | { kind: 'repeat' }
    | { kind: 'reset'; pct: number }                    // multiply working load (or TM) by pct, e.g. 0.9
    | { kind: 'deload'; setsFactor: number; loadFactor: number; weeks: number }
  appliesTo: 'load' | 'tm'
}

/** Authored deload week(s): every factor explicit (no silent defaults, BUILDER-PLAN rule). */
export interface ScheduledDeloadRule {
  id: RuleId; kind: 'scheduled-deload'
  weeks: number[]                                     // week.index values
  setsFactor: number; loadFactor: number
  effort?: { rir?: number; rpe?: number }
  progressionDuring: 'off'
}

/** volume-ramp volume ramp: sets per muscle per week from MEV toward MRV. */
export interface VolumeRampRule {
  id: RuleId; kind: 'volume-ramp'
  scope: { muscles: string[] } | { slots: SlotRef[] }  // muscles = core muscles.js ids
  startSets: number                                  // weekly sets in the first ramp week (≈ MEV)
  addPerWeek: number
  maxSets: number                                    // cap (≈ MRV)
  weeks: number[]                                    // week.index values the ramp covers, ascending
  /** how added sets are spread over the slots in scope, deterministic */
  distribute: 'round-robin-by-slot-order' | 'proportional'
  /** optional deterministic hold: if any slot in scope missed its rep floor last week, don't add */
  holdIfMissedReps: boolean
}

export type ProgressionRule =
  | PercentageRule | RpeLoadRule | DoubleRule | LinearRule
  | AmrapTmRule | StallRule | ScheduledDeloadRule | VolumeRampRule

/** Optional, additive fields on the programme definition. */
export interface DefinitionProgression {
  progressionRules?: ProgressionRule[]
  /** seed values for cycle.tm at activation when the athlete hasn't set them: lift → {value, unit} or 'from-e1rm' */
  tmSeeds?: Record<LiftKey, { value: number; unit: Unit } | { fromE1rm: { pct: number } }>
}
/** NEW optional field on a slot's existing `progression` object. Order matters (see evaluation order). */
export interface SlotProgressionRefs { rules?: RuleId[]; onStall?: RuleId }

// ───────────── evaluation ─────────────
/**
 * evaluate(input) is pure and total. Order per slot per week:
 *   1. volume-ramp / scheduled-deload → set count
 *   2. one load rule (percentage | rpe-load | double | linear) → per-set load + reps
 *   3. stall handling (replay of logged exposures in this cycle) → modifies load or TM
 *   4. scheduled-deload factors → load × loadFactor, sets × setsFactor (ceil, min 1)
 *   5. rounding
 * amrap-tm bumps are applied to the TM timeline before step 2 for weeks after the bump.
 * Replay is from the cycle's own logged workouts (occurrence ids), in date order; same input → same output.
 * A slot with two load rules is a validation error.
 */
/**
 * FROZEN SEMANTICS (Codex review #5) — a unit implements exactly these; anything not listed is a contract change.
 *
 * Replay order: logged workouts belonging to the cycle (entry.occurrenceId → cycle occurrence, else
 *   programmeInstance, else legacy routine/date rule — same resolution as core resolveOccurrences), sorted by
 *   (workout.d ASC, workout.start ASC, workoutKey ASC). An "exposure" = one slot's sets in one workout.
 *   Warm-up rows (core workout-model isWarmupRow) never count. Skipped occurrences are not exposures.
 * Success / failure per load rule (evaluated on the exposure's working sets, done sets only):
 *   percentage: success iff every non-AMRAP set reached `reps` (or `repsMin` when set) and the AMRAP set
 *     (if any) reached its prescribed minimum; else failure.
 *   rpe-load: success iff every set reached its reps AND (when effort was logged) logged RPE <= target RPE + 1
 *     (RIR >= target RIR − 1); missing effort = judged on reps only.
 *   double: per `condition`; success moves load up by `increment` and reps back to repsLow.
 *   linear: per `success`; `every.sessions` counts consecutive successes; `every.weeks` counts calendar weeks
 *     (cycle weeks, not ISO weeks) with ≥1 success.
 * Initial load (first exposure, no prior success/failure):
 *   double / linear: slot.weight (authored seed) if > 0; else the first logged working load becomes the base and
 *   the first prescription is `load: null` (athlete picks) with Why kind 'authored' input {reason:'no-seed'}.
 *   percentage: TM (or 1RM) at that point of the TM timeline; missing TM → load null + warning 'tm.missing'.
 *   rpe-load: per `whenNoData`.
 * TM timeline (immutable seed, idempotent apply): at activation the cycle stores `tmSeed` (NEW cycle field,
 *   frozen; from cycle.tm as set by the athlete, else definition.tmSeeds). The timeline is ALWAYS recomputed as
 *   seed + amrap-tm bumps + stall resets from replay. `cycle.tm` is a cache written by apply for legacy
 *   display, NEVER an input. Re-running preview/apply on the same logs yields byte-identical results and
 *   apply twice is a no-op the second time (required fixtures).
 * Bounds (validator rejects outside): pct (0, 1.5]; reps 1–100; sets 1–100 per slot per week; increment
 *   (0, 100] in the unit; tmDelta [−50, 50]; stall.after 1–10; reset pct [0.5, 1); setsFactor (0, 1];
 *   loadFactor (0, 1]; volume-ramp startSets 0–60, addPerWeek 0–10, maxSets ≥ startSets, ≤ 60; window
 *   sessions 1–20 / days 1–180; bands ≤ 10, minRepsOver 0–30 strictly decreasing.
 * Rounding: compute in full precision, round once at the end; ties go per `mode` ('nearest' rounds half up);
 *   usePlates picks the nearest buildable load in `mode` direction from core plates (same inventory logic
 *   the app uses), recording `roundedFrom` and `inventory:true|false` in Why.inputs.
 * Unit mismatch between a rule and the profile: convert with the core units module (same factor the app
 *   uses), record `convertedFrom` in Why; never silently mix.
 */
export interface EvaluateInput {
  definition: unknown                 // ProgrammeDefinition (schema-valid) incl. DefinitionProgression
  cycle?: {
    id: string
    /** Display cache only; evaluation uses the immutable seed below. */
    tm?: Record<LiftKey, number>
    /** Frozen at activation, matching ProgrammeCycle.tmSeed (absent on pre-engine cycles). */
    tmSeed?: Record<LiftKey, number>
    /** Cycle occurrence identities/statuses used to resolve logs and exclude skipped exposures. */
    occurrences: ProgrammeOccurrence[]
    week1StartDate: ISODate
    weekIndex: number
    /** Legacy resolveOccurrences fallback inputs; same value types as ProgrammeCycle. */
    since?: Stamp
    startsOn?: ISODate
    strict?: true
  }
  /** finished workouts relevant to the cycle (server passes from the doc; preview may pass hypothetical logs) */
  logs: unknown[]                     // Workout[] from state-doc
  profile: { unit: Unit; oneRmFormula?: string; plates?: unknown; dumbbells?: unknown; loadKind?: unknown; effortScale: 'rir' | 'rpe' }
  /** liftKey → exercise ids whose sets count for e1RM/AMRAP (from slot ids + tm.key) */
  liftExercises?: Record<LiftKey, string[]>
  weeks: number[]                     // which week.index values to prescribe
  asOf?: ISODate                      // ignore logs after this date (preview "what would week N look like")
}

export interface Why {
  ruleId: RuleId | 'authored'         // 'authored' = the number was written in the definition, no rule
  kind: ProgressionRule['kind'] | 'authored'
  /** every input used, by name, e.g. {tm: 140, pct: 0.85, increment: 2.5, roundedFrom: 119} */
  inputs: Record<string, number | string | boolean | null>
  /** English sentence built from a fixed template per kind (no free text from rules) */
  text: string
}

export interface PrescribedSet {
  reps: number | 'amrap'; repsMin?: number
  load: number | null                 // null = athlete picks (target only)
  unit: Unit
  target?: { rir?: number; rpe?: number; pct?: number }   // displayed per profile effortScale
  why: Why[]
}
export interface PrescribedSlot { ref: SlotRef; exerciseId?: string; sets: PrescribedSet[]; why: Why[] }
export interface PrescribedWeek { index: number; slots: PrescribedSlot[] }

export interface EvaluateResult {
  weeks: PrescribedWeek[]
  /** TM timeline after replay (start value, each change with its Why) */
  tm: Record<LiftKey, { value: number; at: ISODate | 'seed'; why: Why }[]>
  warnings: { code: string; ref?: SlotRef; message: string }[]
}

// ───────────── validation ─────────────
export type ProgressionIssueCode =
  | 'rule.unknown-kind' | 'rule.duplicate-id' | 'rule.unknown-ref'      // slot lists a rule id that doesn't exist
  | 'rule.unknown-lift' | 'rule.unknown-week' | 'rule.unknown-slot' | 'rule.unknown-set'
  | 'rule.two-load-rules' | 'rule.range'                                // number out of its documented range
  | 'rule.extra-field'                                                  // closed objects; also catches "stage tricks"
  | 'rule.unit-mismatch' | 'rule.ramp-order' | 'rule.deload-overlap' | 'rule.missing-rounding'
  // Design decision: undefined composition fails closed until semantics are specified.
  | 'rule.two-volume-ramps' | 'rule.multiple-amrap-bumps'
  | 'rule.amrap-source-not-amrap' | 'rule.tm-stall-without-key' | 'rule.reps-unsupported'
export interface ProgressionIssue { code: ProgressionIssueCode; ruleId?: RuleId; ref?: Partial<SlotRef>; path: string; fix: string }
/** Fails closed: any issue prevents the definition from reaching `Complete`. */
export interface ProgressionValidateResult { ok: boolean; issues: ProgressionIssue[] }

// ───────────── apply ─────────────
/**
 * Apply writes prescriptions into the running cycle so Today/Workout show them: for the given weeks it sets
 * slot weights/reps/sets/targets on the cycle-owned routines and updates the cycle.tm cache, through the normal
 * /api/data compare-and-write as a STAMPED server writer (fresh stamps, baseRev/baseWid precondition,
 * no auto-rebase). It never touches workouts, never edits a week before the cycle's current week, and never
 * edits today's occurrence.
 *
 * In-progress workouts (Codex review #6): an active workout is device-local and the server CANNOT prove there
 * is none (presence expires ~70 s after the last ping, and is lost offline or on restart). So:
 *  - the caller must pass `confirmNoActiveSession: true` (the MCP tool asks the human; the web UI only offers
 *    apply when its own `active` is empty), and
 *  - the server additionally refuses with TRAINING_NOW when presence shows an active session.
 * Even if both are wrong, nothing is lost: apply only edits routines for future occurrences, and an open
 * session keeps its own copied prescription (`active` is never sent to the server).
 */
export interface ApplyRequest {
  cycleId: string; weeks: number[]; expectedRev: number; expectedWid: string | null
  confirmNoActiveSession: true
  /** Explicit consent to an inventory adjustment carrying a large-adjustment warning. */
  confirmInventoryAdjustment?: boolean
  dryRun?: boolean
}
export interface ApplyResult { stateRev: number; wid: string; changed: { ref: SlotRef; field: string; before: unknown; after: unknown; why: Why[] }[]; warnings: EvaluateResult['warnings'] }
export type ApplyErrorCode = 'REV_CONFLICT' | 'CYCLE_NOT_ACTIVE' | 'PAST_WEEK' | 'TRAINING_NOW' | 'INVALID_RULES' | 'NOT_FOUND'

export type { Stamp }
