import type { ExerciseIndex } from './exercises';
import type { ProgrammeCycle } from '../domain/state-doc';
export declare function shiftPreview(S: any, cycleId: any, today: any): {
    before: {
        occurrences: any[];
        pending: any[];
        next: any;
        weeks: any[];
        anchor: any;
        lastDoneDate: any;
        endDate: any;
        nextBlockStart: string | null;
    };
    after: {
        occurrences: any[];
        pending: any[];
        next: any;
        weeks: any[];
        anchor: any;
        lastDoneDate: any;
        endDate: any;
        nextBlockStart: string | null;
    };
    moved: number;
};
export declare function programmeIdle(S: any, cycle: any, today: any): boolean;
export declare function repeatProgrammeWeek(S: any, cycleId: any, today: any, { weekId }?: {    weekId?: unknown;
}, index?: ExerciseIndex): false | {
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
    inserted: ProgrammeCycle['inserted'];
    preApp?: any;
    seriesId?: any;
    tm?: any;
};
/** Resume can repeat the last trained stage, or the current stage if none was logged. */
export declare function repeatStageOf(S: any, cycle: any, today: any): any;
