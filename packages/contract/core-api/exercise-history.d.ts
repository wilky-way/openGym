import type { ExerciseIndex } from './exercises';
export declare const HISTORY_SESSIONS = 10;
export declare function exerciseHistory(S: any, exId: any, { limit }?: {
    limit?: number | undefined;
}, index?: ExerciseIndex): {
    mode: any;
    metric: string;
    best: number;
    prId: null;
    total: number;
    sessions: any[];
    points: any[];
    e1rmPoints: any[];
};
/**
 * The best set ever logged of an exercise, for the "Best set" reference on the workout card
 * (#173) — the answer to "last time was a bad day, what can I actually do". It is the heaviest
 * completed work set, and of equally heavy ones the one with the most reps: the same "heaviest"
 * the Best chip and a PR mean, which on an assistance machine is the least help. A timed exercise
 * compares holds, then their load; cardio compares minutes, then speed. An exercise never loaded
 * (pull-ups) comes down to its reps that way.
 *
 * Unlike "Last time" this looks across every routine: a record belongs to the exercise, not to
 * the slot it was set in. Only sets logged in `mode` count, so a hold is never measured against
 * a rep set. A tie keeps the first time it was reached, as the PR marker does.
 * `as` reads dumbbell weights in that meaning (lib/dumbbells.js): the session's own, so a past
 * "40 total" is held against today's sets as the "20 each" it was.
 * Returns { d, set, target } or null.
 */
export declare function bestSetFor(S: any, exId: any, mode?: any, as?: any, index?: ExerciseIndex): {
    d: any;
    set: any;
    target: any;
} | null;
