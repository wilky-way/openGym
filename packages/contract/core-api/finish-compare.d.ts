import type { ExerciseIndex } from './exercises';
/** -1, 0 or 1: today against last time, by the heaviest set first, then by total reps. */
export declare function trendOf(today: any, last: any): number | null;
/** Rows for the summary of `w`, read from `st` (which already holds `w`). Cardio and timed sets are left out. */
export declare function finishCompare(st: any, w: any, index?: ExerciseIndex): {
    id: any;
    today: any;
    last: any;
    trend: number | null;
    next: {
        w: any;
        r: any;
        sets: any;
        kind: string;
    } | null;
}[];
/**
 * The cardio of `w` for the finish summary, which the rows above leave out: one row per cardio
 * exercise with the sets that were done, warm-ups included (a walk to warm up is still a walk).
 * The summary prints them with setLabel, so a treadmill's speed and incline read as logged.
 */
export declare function finishCardio(w: any, index?: ExerciseIndex): {
    id: any;
    target: any;
    sets: any;
}[];
