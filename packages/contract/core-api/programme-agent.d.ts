import type { ExerciseIndex } from './exercises';
export declare function programmePosition(S: any, today: any, cycleId: any): {
    rev: any;
    wid: any;
    unit: any;
    active: null;
    next: null;
    endDate: null;
    adherence: null;
    cycleId?: undefined;
    programmeId?: undefined;
    status?: undefined;
    lap?: undefined;
    currentWeek?: undefined;
    currentWeekId?: undefined;
    nextBlockStart?: undefined;
    projection?: undefined;
} | {
    active?: undefined;
    rev: any;
    wid: any;
    unit: any;
    cycleId: any;
    programmeId: any;
    status: any;
    lap: any;
    currentWeek: any;
    currentWeekId: any;
    next: {
        instanceId: any;
        routineId: any;
        name: any;
        date: any;
        dayKey: any;
        missingTMs: any[];
    } | null;
    endDate: any;
    nextBlockStart: string | null;
    projection: any[];
    adherence: {
        done: number;
        skipped: number;
        planned: number;
        pending: number;
        weeks: {
            weekId: any;
            weekIndex: any;
            done: any;
            skipped: any;
            planned: any;
            closed: any;
        }[];
    };
};
export declare function getProgramme(S: any, { cycleId, programmeId }?: {    cycleId?: unknown;
    programmeId?: unknown;
}): {
    rev: any;
    wid: any;
    unit: any;
    effortScale: any;
    cycle: any;
    definition: any;
    displayDefinition: any;
};
/** Mutates only a caller-owned draft. Transport handles auth and conditional persistence. */
export declare function applyProgrammeAgentAction(S: any, action: any, params: any, today: any, index?: ExerciseIndex): any;
