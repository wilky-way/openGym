import type { ExerciseIndex } from './exercises';
export declare const MUSCLES: string[];
export declare const inMuscleOrder: (list: any) => any[];
export declare const INERT: string[];
export declare const MUSCLE_NAME: {
    trapezius: string;
    deltoids: string;
    chest: string;
    'upper-back': string;
    serratus: string;
    biceps: string;
    triceps: string;
    forearm: string;
    abs: string;
    obliques: string;
    'lower-back': string;
    gluteal: string;
    quadriceps: string;
    hamstring: string;
    adductors: string;
    'hip-flexors': string;
    calves: string;
    tibialis: string;
    'cardiovascular system': string;
};
/** True only when the catalogue explicitly supplied muscle groups, not a body-part fallback. */
export declare function hasExplicitMuscleMetadata(entry: any): boolean;
/** Canonical unique muscle groups, accepting new primary/secondary arrays and legacy fields. */
export declare function muscleGroupsOf(entry: any): any[];
export declare const normalizeMuscleGroups: typeof muscleGroupsOf;
/** True when any requested group matches; an empty request is an intentionally unfiltered query. */
export declare function matchesMuscleGroups(ex: any, requested: any): boolean;
/** Complete muscle-weight metadata, including explicit zero-credit associations. */
export declare function muscleWeightsOf(ex: any): {};
/** Muscles one exercise trains: positive effective stimulus only. */
export declare function musclesOf(ex: any): {
    [k: string]: any;
};
/** Snapshot display and weighted muscle metadata into a completed history entry. */
export declare function exerciseMuscleSnapshot(ex: any): {};
/**
 * Training load per muscle, in "effective sets".
 * `items` is [{ id, sets }] — sets being a count, so a 4×8 bench press weighs four
 * times a single set. Volume in kg is deliberately not used: 100 kg of leg press
 * against 12 kg of lateral raise says nothing about which muscle worked harder.
 */
export declare function loadOf(items: any, index?: ExerciseIndex): {};
/**
 * Load for finished workouts (only sets actually ticked off count). `pick` narrows that
 * further — the map can then answer "where did the *hard* sets go", which is a different
 * question from where the sets went: a muscle can lead on volume and still never be trained
 * near failure.
 */
export declare const loadOfWorkouts: (workouts: any, pick: any, index?: ExerciseIndex) => {};
/**
 * Workouts in one existing Muscle balance range, with time injected for deterministic tests.
 *
 * The 7-day range is "this week", not "the last seven days", so it moves with the profile's
 * first weekday — the caller passes it since this takes workouts rather than the whole state.
 */
export declare function muscleBalanceWindow(workouts: any, win: any, now?: number, today?: string, ws?: number): any;
/** Load a routine *would* produce, from its planned set counts. */
export declare const loadOfRoutine: (routine: any, exercises?: {}, index?: ExerciseIndex) => {};
/**
 * Effective sets programmed by the live recurring week; overrides and history are not plans.
 * A floating week or rotation (S.queue, lib/queue.js) is the plan too: each of its sessions once,
 * beside your own weekday routines — the same split the Home streak card tallies (weekTally).
 */
export declare function loadOfWeeklyPlan(S: any, index?: ExerciseIndex): {};
/** Load for a workout still in progress — the sets ticked so far. */
export declare const loadOfActive: (active: any, index?: ExerciseIndex) => {};
/**
 * Shade buckets 0–4 per muscle.
 *
 * With no `thresholds`, levels remain relative to the hardest-worked muscle in the same
 * window. This is the original balance-map behavior. When `thresholds` is supplied, levels
 * use an absolute scale instead: it is an ordered array of `{ at, level, exclusive? }` rules,
 * and the last matching rule wins. An exclusive rule matches values strictly greater than
 * `at`; otherwise the boundary is inclusive. Values below the first matching rule are l0.
 * Absolute rules let recovery views keep fixed semantic bands instead of renormalizing to the
 * strongest muscle on screen.
 */
export declare function levelsOf(load: any, thresholds: any): {};
/** Muscles sorted hardest-worked first; untrained ones last, in body order. */
export declare function rankOf(load: any): {
    worked: string[];
    missed: string[];
};
