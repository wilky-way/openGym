import type { ExerciseIndex } from './exercises';
import { defaultIncrement } from './exercises.js';
export declare const POLICIES: string[];
export declare const POLICIES_FOR: {
    reps: string[];
    time: string[];
    cardio: string[];
};
export declare const POLICY_NAME: {
    off: string;
    linear: string;
    greyskull: string;
    double: string;
    triple: string;
    time: string;
};
export declare const POLICY_DESC: {
    off: string;
    linear: string;
    greyskull: string;
    double: string;
    triple: string;
    time: string;
};
export declare const DELOAD_FACTOR = 0.9;
export declare const DELOAD_AFTER: {
    linear: number;
    greyskull: number;
    double: number;
    triple: number;
    time: number;
};
export declare const DELOAD_FACTOR_MIN = 0.5;
export declare const DELOAD_FACTOR_MAX = 0.95;
export declare function isValidDeloadFactor(value: any): boolean;
export declare function deloadFactorOf(cfg: any): number;
export declare function epley1RM(weight: any, reps: any): number | null;
export declare function deloadTarget1RM(weight: any, reps: any, factor?: number, perSide?: boolean): number | null;
export { defaultIncrement };
export declare function weightIncrement(cfg: any, unit: any, index?: ExerciseIndex): any;
export declare const DEFAULT_SEC_INCREMENT = 5;
export declare const MAX_BW_SETS = 6;
export declare function policyFor(cfg: any, routine: any, mode: any, index?: ExerciseIndex): any;
export declare function snapWeight(v: any, step: any): number;
export declare function addStep(w: any, step: any, inc: any): number;
export declare function stepWeight(value: any, step: any, direction: any): number;
export declare function deloadTo(cur: any, step: any, factor?: number): number;
/**
 * Pick a bounded load/reps pair for an Epley target. The search is deliberately lexicographic:
 * hard constraints first, then closest estimated 1RM, fewer rep changes, and greater load. That
 * makes a grid tie predictable without hiding a product decision in arbitrary score weights.
 */
export declare function selectDeloadCandidate({ currentWeight, targetWeight, targetReps, step, factor, reps, repsMin, perSide, owned }: {
    currentWeight: any;
    factor?: number | undefined;
    owned?: number[] | null | undefined;
    perSide?: boolean | undefined;
    reps?: any;
    repsMin?: any;
    step: any;
    targetReps: any;
    targetWeight: any;
}): any;
/**
 * What a routine's exercise asks for — its sets and reps (the range, under double progression;
 * the seconds, for a hold) — as stamped on every entry a session builds (`entry.planned`, issue
 * #275). A prescription moves the session's `target`; this keeps what the routine said, which
 * is the only way the next session can tell a plan that was edited from one that progressed.
 * The weight never starts one on its own — history decides it — but once the sets or reps were
 * edited, a weight edited with them is the one the new plan opens at (nextPrescription).
 */
export declare function plannedOf(cfg: any, index?: ExerciseIndex): {
    sets: number;
};
/** Did the routine's sets or reps change since the session that stamped `planned`? */
export declare function planChanged(planned: any, cfg: any, index?: ExerciseIndex): boolean;
export declare function readSession(entry: any, fallback?: any, index?: ExerciseIndex): {
    mode: any;
    target: any;
    goal: any;
    held: any;
    weight: number;
    best: number;
    ok: any;
    count?: undefined;
    low?: undefined;
    amrap?: undefined;
    reps?: undefined;
} | {
    held?: undefined;
    best?: undefined;
    mode: any;
    target: any;
    goal: any;
    reps: any;
    weight: number;
    count: any;
    low: number;
    amrap: any;
    ok: any;
};
/**
 * Every past session for one exercise, oldest first. `fallback` — see readSession.
 *
 * With a routine id, the sessions that routine trained (issue #216): a heavy day and a light day
 * of the same lift each progress on their own line, and a combined day that holds the lift twice
 * is read by the entry that belongs to the routine, not by whichever comes first. A routine with
 * no session of its own reads the exercise's whole history instead, so a new or copied routine
 * continues from where you are. Each session carries the routine it came from (`rid`) and the
 * plan it was built from (`planned`), so the caller can tell a borrowed or outdated baseline.
 */
export declare function sessionsFor(S: any, exId: any, fallback: any, rid: any, index?: ExerciseIndex): any[];
export declare const MAX_TRIPLE_SETS = 10;
export declare function tripleSetsOf(cfg: any): {
    setsMin: number;
    setsMax: number;
};
export declare function stallCount(sessions: any, policy: any): number;
/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said — for reps, unless the profile starts
 * planned sessions from the last session, in which case the rows keep last time's (see
 * startsFromLast in session-start.js).
 */
export declare function nextPrescription(S: any, cfg: any, routine?: any, index?: ExerciseIndex): {
    policy: any;
    kind: string;
    rowReps?: undefined;
    sec?: undefined;
    weight?: undefined;
    why?: undefined;
    sets?: undefined;
    reps?: undefined;
} | {
    policy: any;
    kind: string;
    weight: any;
    why: any[];
} | {
    policy: any;
    kind: string;
    reps: number;
    sets: number;
    rowReps: any[];
    why: string[];
    sec?: undefined;
    weight?: undefined;
} | {
    rowReps?: undefined;
    weight?: any;
    policy: any;
    kind: string;
    sec: any;
    why: string[];
    sets?: undefined;
    reps?: undefined;
} | {
    rowReps?: undefined;
    policy: any;
    kind: string;
    reps: any;
    why: string[];
    sec?: undefined;
    weight?: undefined;
    sets?: undefined;
} | {
    rowReps?: undefined;
    policy: any;
    kind: string;
    sec: any;
    why: any[];
    weight?: undefined;
    sets?: undefined;
    reps?: undefined;
} | {
    rowReps?: undefined;
    sec?: undefined;
    sets: number;
    policy: any;
    kind: string;
    weight: number;
    reps: any;
    why: any[];
} | {
    rowReps?: undefined;
    sec?: undefined;
    policy: any;
    kind: string;
    weight: number;
    reps: any;
    why: any[];
    sets?: undefined;
} | {
    rowReps?: undefined;
    sec?: undefined;
    policy: any;
    kind: string;
    weight?: any;
    why: string[];
    sets?: undefined;
    reps?: undefined;
} | {
    policy: any;
    kind: any;
    weight: any;
    reps: any;
    sets: any;
    rowReps: any;
    why: any;
} | {
    rowReps?: undefined;
    sec?: undefined;
    policy: any;
    kind: string;
    weight: any;
    reps: number;
    why: any[];
    sets?: undefined;
};
/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet. `floor` is the lift's bar
 * (history.js barFloor), which the re-ramped warm-ups never go under.
 */
export declare function applyPrescription(sets: any, p: any, step?: number | number[], floor?: number): any;
