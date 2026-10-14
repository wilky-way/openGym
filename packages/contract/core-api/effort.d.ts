import type { ExerciseIndex } from './exercises';
export declare const HARD_RIR = 3;
export declare const MIN_RATED = 5;
/**
 * A set's effort in RIR, or null when it was never rated. 0 is a rating, not "empty". A set
 * marked as taken to failure (workout-model isFailureSet) is RIR 0 by definition, so it reads as
 * one when nothing was rated; a rating typed in by hand still wins, it is the more exact of the two.
 */
export declare const rirOf: (s: any) => any;
/** RIR → the scale being displayed. The reverse of rirOf, for one number. */
export declare const toScale: (kind: any, rir: any) => number | null;
/**
 * Which scale to *label* aggregates with. The profile's own setting wins; a profile that
 * logs nothing itself but carries rated history (the imported-from-Hevy case) is shown the
 * scale that history is actually written in, rather than an RIR it has never seen.
 */
export declare function displayScale(S: any): any;
export declare const scaleName: (kind: any) => any;
export declare const avgRir: (sets: any) => number | null;
/**
 * The headline numbers for a window: how hard, how much of it was hard, and — the part that
 * keeps the rest honest — how much of the training was rated at all. Effort is optional and
 * off by default, so partial coverage is the normal case; an average without its denominator
 * would quietly speak for sets that were never rated. `resolve` maps (set, workout, entry)
 * to RIR; estimates flow through it flagged, so the caller can label them honestly.
 */
export declare function effortSummary(S: any, days: any, resolve?: typeof rirOf): {
    done: number;
    rated: number;
    est: number;
    covered: number;
    hard: number;
    avg: number | null;
    hardPct: number | null;
};
/** Does this profile hold any rated set at all? Decides whether the effort UI exists. */
export declare function hasEffort(S: any): boolean;
/**
 * Could any set be RIR-estimated (load, reps in estimator range, non-assisted)?
 * Decides whether the estimated-fallback UI exists for histories nobody rated -
 * Jefit/Hevy imports carry loads but no ratings. Warm-ups don't count: estimating
 * them would fill the card with discounted ramp rows instead of training.
 */
export declare function hasEstimableEffort(S: any, index?: ExerciseIndex): boolean;
/**
 * Average effort per calendar week, with the week's set count alongside: the pair is the
 * point. Volume up with effort up is fatigue accumulating; volume up with effort flat is the
 * adaptation you were training for. Weeks with a single rated set are dropped rather than
 * drawn — one tap should not become a peak in the curve.
 */
export declare function effortWeeks(S: any, days: any, resolve?: typeof rirOf): {
    t: any;
    rir: number;
    n: any;
    est: any;
    sets: any;
}[];
/**
 * How the rated sets spread across the scale, in whole steps with everything past the top
 * bucket collapsed into it. This is the chart that answers "am I training too far from
 * failure, or leaving nothing for the next session" — an average alone hides both, because
 * half the sets at 0 and half at 4 average to a healthy-looking 2.
 */
export declare const BUCKETS = 4;
export declare function effortHistogram(S: any, days: any, resolve?: typeof rirOf): {
    rir: number;
    tail: boolean;
    n: any;
    pct: number;
}[];
/** A set that counts as hard — the filter behind the muscle map's "hard sets" mode. */
export declare const isHardSet: (s: any) => boolean;
export declare const EFFORT_BANDS: {
    rir: number;
    max: number;
    color: string;
    feel: string;
}[];
export declare const EFFORT_PRESETS: {
    rir: number;
    color: string;
    feel: string;
    tail: boolean;
}[];
/**
 * The colour for one effort value, given in RIR (use rirOf to convert a set first). Picks the
 * band the value falls into: an exact preset lands on its own band, a typed in-between value
 * (RIR 1.5) takes the band it sits within so it is never left uncoloured. null (unrated) has
 * no colour — the caller shows a neutral control, not a green one.
 */
export declare const effortColor: (rir: any) => string | null;
