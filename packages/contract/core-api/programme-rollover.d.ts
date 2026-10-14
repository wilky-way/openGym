import type { ExerciseIndex } from './exercises';
import type { ProgrammeCycle } from '../domain/state-doc';
export declare const needsRollover: (c: any) => boolean;
/** Conservative set proposals: only authored adds of at most one set are offered. */
export declare function rolloverProposals(S: any, cycleId: any, index?: ExerciseIndex): {
    routineId: any;
    instanceId: any;
    slotId: any;
    exerciseId: any;
    currentSets: number;
    sets: number;
    reason: string;
}[];
export declare function acceptRollover(S: any, cycleId: any, reviewed: any, selected?: any, index?: ExerciseIndex): {
    routineId: any;
    instanceId: any;
    slotId: any;
    exerciseId: any;
    currentSets: number;
    sets: number;
    reason: string;
}[];
/** Explicit choice after completion; validate a repeat in a draft before archiving. */
export declare function finishProgrammeBlock(S: any, cycleId: any, choice: any, { today }?: {    today?: unknown;
}, index?: ExerciseIndex): {
    id: any;
    programmeId: any;
    status: string;
    week1StartDate: any;
    lengthWeeks: any;
    lap: any;
    end: any;
    cadence: {
        perWeek: any;
    };
    since: any;
    startsOn: any;
    strict?: boolean | undefined;
    notBefore: null;
    snapshot: any;
    weekIndex: any;
    occurrences: ProgrammeCycle['occurrences'];
    inserted: never[];
    preApp?: any;
    seriesId?: any;
    tm?: any;
} | null;
