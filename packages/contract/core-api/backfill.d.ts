import type { ExerciseIndex } from './exercises';
export declare const workoutsOn: (S: any, iso: any) => any;
export declare const backfillStart: (iso: any, time?: string) => number;
export declare const backfillEnd: (active: any) => any;
export declare function historyAsOf(S: any, { d, start, replaceId, strict }: {
    d: any;
    replaceId?: string | null | undefined;
    start?: number | undefined;
    strict?: boolean | undefined;
}): any;
export declare const sessionHistory: (S: any) => any;
export declare function insertChronological(workouts: any, w: any): any[];
export declare function completeBackfill(workouts: any, active: any, w: any, now?: number): any[];
export declare function markAllSetsDone(entries: any, index?: ExerciseIndex): any;
