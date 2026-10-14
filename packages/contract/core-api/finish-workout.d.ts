import type { ExerciseIndex } from './exercises';
export declare const FORGOTTEN_GAP_MS: number;
export declare function sessionEnd(active: any, now?: number, gap?: number): any;
export declare function buildCompletedWorkout(active: any, { end, prs, snapshotFor }?: {
    end?: number | undefined;
    prs?: string[] | undefined;
    snapshotFor?: unknown;
}, index?: ExerciseIndex): {
    id: any;
    d: any;
    start: any;
    end: number;
    routineIds: any[];
    routineId: any;
    programmeInstance?: any;
    name: any;
    bw: any;
    entries: any;
    prs: any[];
    excludeFromProgression?: boolean | undefined;
    note?: any;
};
