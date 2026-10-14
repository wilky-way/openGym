import type { Queue } from '../domain/state-doc';
export declare const isProgrammeDate: (iso: any) => boolean;
/** Noon + setDate walks calendar days in this runtime's zone, including 23/25-hour days. */
export declare function addProgrammeDays(iso: any, days: any): string | null;
export declare const occurrenceWeekId: (o: any) => any;
export declare const occurrenceOrder: (o: any) => number;
export declare function orderedOccurrences(cycle: any, queue: any): any[];
/** DESIGN §3.1. `queue` is optional; pass S.queue to reflect its current-week reorder. */
export declare function projectCycle(cycle: any, workouts: any[] | undefined, today: any, queue?: Queue | null): {
    occurrences: any[];
    pending: any[];
    next: any;
    weeks: any[];
    anchor: any;
    lastDoneDate: any;
    endDate: any;
    nextBlockStart: string | null;
};
/** General calendar cells combine historical lifts and projected/resolved program sessions. */
export declare function monthCells(projection: any, month: any, { workouts, weekStartsOn, today }?: {
    today?: null | undefined;
    weekStartsOn?: number | undefined;
    workouts?: never[] | undefined;
}): any[];
/** Optional current queue projection; no programme metadata means the stock queue rules. */
export declare function projectionForQueue(S: any, today: any): {
    occurrences: any[];
    pending: any[];
    next: any;
    weeks: any[];
    anchor: any;
    lastDoneDate: any;
    endDate: any;
    nextBlockStart: string | null;
} | null;
