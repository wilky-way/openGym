import type { ExerciseIndex } from './exercises';
export declare const FATIGUE_SETS_PER_UNIT = 8;
export declare const FATIGUE_MAX_SETS_PER_SESSION = 12;
export declare const FATIGUE_SCAN_MS: number;
export declare const FATIGUE_RIR_WINDOW_MS: number;
export declare const FATIGUE_ACUTE_WINDOW_MS: number;
export declare const FATIGUE_CHRONIC_WINDOW_MS: number;
export declare const FATIGUE_RIR_FLOOR_WEIGHT = 0.3;
export declare const FATIGUE_RATIO_MIN = 0.5;
export declare const FATIGUE_RATIO_MAX = 2;
export declare const FATIGUE_NOVICE_WEEKLY_SETS = 4;
export declare const BODYWEIGHT_REF_LOAD = 75;
/** Exponential half-life for fatigue stimulus of one muscle. */
export declare function fatigueHalfLifeOf(slug: any): any;
/** Period after training during which retained strength remains at full value. */
export declare const STRENGTH_FULL_MS = 1209600000;
/** Exponential half-life for retained strength after the full-retention period. */
export declare const STRENGTH_HALF_LIFE_MS = 2419200000;
/** Minimum retained-strength value for an untrained or fully detrained muscle. */
export declare const STRENGTH_FLOOR = 0.5;
/**
 * Stable labels for consumer fatigue buckets: values below 0.25 are ready, values from 0.25
 * through 0.5 are recovering, and values above 0.5 are fatigued.
 */
export declare const FATIGUE_STATES: Readonly<{
    READY: "ready";
    RECOVERING: "recovering";
    FATIGUED: "fatigued";
}>;
/**
 * Return exponential decay expressed as a fraction of one half-life.
 *
 * @param {number} ageMs Elapsed age of the stimulus in milliseconds.
 * @param {number} halfLifeMs Duration of one half-life in milliseconds.
 * @returns {number} Remaining fraction, using the exact `0.5 ** (age / halfLife)` formula.
 */
export declare function halfLifeDecay(ageMs: number, halfLifeMs: number): number;
export declare const LB_TO_KG = 0.45359237;
/**
 * How much of a hard set a proximity-to-failure reading is worth. Logged effort
 * (`rir`/`rpe` via effort.js) always wins; otherwise the RIR is estimated against
 * the exercise's 90-day rolling best (see `estimateSetRir`). At or near failure a
 * set counts full, far from it no less than the floor: easy work still moves blood.
 *
 * @param {number|null} rir Reps in reserve, or null when intensity is unknown.
 * @returns {number} Set weight in [0.3, 1].
 */
export declare function rirWeightFor(rir: number | null): number;
/**
 * Estimate a set's reps in reserve from a capacity anchor (Epley inverse, both in
 * kg so mixed-unit histories anchor correctly). The anchor is the exercise's recent
 * best 1RM estimate, so `80x8` against a 110 max reads ~RIR 3 while the same set
 * against a 100 max reads failure. Returns null wherever an honest answer is
 * impossible: no anchor, no load, no reps, or above the rep cap (where estimators
 * diverge past 10%).
 *
 * @param {{w?: number, r?: number}} set A completed set with load and reps.
 * @param {number|null} anchorKg Recent best 1RM estimate for the exercise, in kg.
 * @returns {{rir: number, source: 'estimated'}|null} Clamped RIR in [0, 10].
 */
export declare function estimateSetRir(set: {
    w?: number;
    r?: number;
}, anchorKg: number | null, unit: any): {
    rir: number;
    source: 'estimated';
} | null;
/**
 * Capacity anchors per workout: the 90-day rolling best 1RM estimate per exercise,
 * in kg, keyed by the workout object. One chronological pass - later sessions never
 * leak into earlier anchors. Powers both fatigue scoring and estimated-effort stats;
 * unrated histories without any estimable set simply get empty maps (full credit).
 *
 * @param {Array<object>} workouts Workout history.
 * @param {{unit?: string, bodyweightKg?: number}} opts Profile unit for unstamped loads and the
 * profile bodyweight for bodyweight exercises (the same options fatigueOf takes).
 * @returns {Map<object, Map<string, number>>} Workout -> exercise id -> anchor.
 */
export declare function anchorsByWorkout(workouts: Array<object>, opts?: {
    unit?: string;
    bodyweightKg?: number;
}, index?: ExerciseIndex): Map<object, Map<string, number>>;
/**
 * One set's RIR with its provenance: logged effort first, Epley-inverse estimate
 * against the workout's anchors second, null when intensity is unknowable. The same
 * precedence fatigue scoring uses, so stats and the map never disagree about a set.
 */
export declare function resolveSetRir(row: any, set: any, entry: any, workout: any, anchors: any, opts?: {}, index?: ExerciseIndex): {
    rir: any;
    source: string;
} | null;
/**
 * Calculate current per-muscle fatigue from completed sets in the recent window.
 *
 * Stimulus time is history.js `workoutAt`: `workout.start`, falling back to the workout date
 * `workout.d` read as local noon. Each completed
 * set contributes the exercise's `musclesOf` weights in quality-weighted effective-set units
 * (logged RIR first, Epley-inverse estimate against the 90-day rolling best second, full
 * credit when intensity is unknowable); a full session of ~8 hard sets scores 1.0, scaled by
 * the acute:chronic gain (recent weekly rate vs 28-day exposure, novice prior of 4 sets/week,
 * clamped 0.5-2). The scan is bounded to FATIGUE_SCAN_MS for performance, not semantics.
 * Stimuli accumulate chronologically with a per-muscle half-life (24h arms/small,
 * 30h torso, 48h legs/lower-back), decayed to `now`, and normalised with the saturation curve
 * 1 - exp(-v). Every window is causal, so rest never increases fatigue and out-of-window
 * imports stay irrelevant; deleting the latest session never increases anything, while
 * deleting mid-history may re-score later sessions through their anchors and gains.
 * The result always contains every drawable muscle slug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @param {{unit?: string, bodyweightKg?: number}} options Profile unit for unstamped loads and the
 * profile bodyweight (kg) for bodyweight exercises; both are supplied at the UI boundary.
 * @returns {Record<string, number>} Fatigue values keyed by every drawable muscle slug.
 */
export declare function fatigueOf(workouts: Array<object>, now: number, opts?: {}, index?: ExerciseIndex): Record<string, number>;
/**
 * Calculate retained per-muscle strength from the latest completed stimulus in all history.
 *
 * A muscle with no completed set starts at the 0.5 floor. After a completed set, strength is
 * 1.0 through 14 days old, then decays toward the floor with a 28-day half-life. Any later
 * completed set becomes the new latest stimulus and resets the 14-day full-retention period.
 * The result always contains every drawable muscle slug.
 *
 * @param {Array<object>} workouts Workout history with `start`/`d` and entry set arrays.
 * @param {number} now Current time in milliseconds; injected to keep this function deterministic.
 * @returns {Record<string, number>} Retained-strength values keyed by every drawable muscle slug.
 */
export declare function strengthOf(workouts: Array<object>, now: number, opts?: {}, index?: ExerciseIndex): Record<string, number>;
/**
 * List muscles currently above the fatigued threshold.
 *
 * @param {Array<object>} workouts Workout history passed to {@link fatigueOf}.
 * @param {number} now Current time in milliseconds passed to {@link fatigueOf}.
 * @returns {string[]} Muscle slugs whose fatigue value is greater than 0.5, in `MUSCLES`
 * head-to-toe order.
 * @example
 * const avoid = fatiguedMuscles(workouts, now)
 */
export declare function fatiguedMuscles(workouts: Array<object>, now: number, opts?: {}, index?: ExerciseIndex): string[];
/**
 * List muscles whose retained strength is below full retention.
 *
 * @param {Array<object>} workouts Workout history passed to {@link strengthOf}.
 * @param {number} now Current time in milliseconds passed to {@link strengthOf}.
 * @returns {string[]} Muscle slugs whose retained strength is less than 1.0, in `MUSCLES`
 * head-to-toe order; never-trained muscles are included at the 0.5 floor.
 * @example
 * const targets = detrainedMuscles(workouts, now)
 */
export declare function detrainedMuscles(workouts: Array<object>, now: number, opts?: {}, index?: ExerciseIndex): string[];
