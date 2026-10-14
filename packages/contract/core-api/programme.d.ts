import type { ExerciseIndex } from './exercises';
import type { ProgrammeCycle } from '../domain/state-doc';
export { normaliseProgrammes, programmesOf } from './programme-sync.js';
/** One explicit week becomes ordinary routines. Exported for inserted weeks and future laps. */
export declare function materializeWeek(definition: any, week: any, cycle: any, { unit }?: {
    unit?: any;
}, index?: ExerciseIndex): {
    routines: any[];
    occurrences: {
        instanceId: string;
        weekIndex: any;
        dayKey: any;
        ordinal: any;
        routineId: string;
        status: string;
        sessionTemplateId?: any;
        routineName: any;
        weekId?: any;
        orderIndex?: any;
        inserted?: boolean | undefined;
    }[];
};
/** Earlier numbered weeks are history metadata, independent of authored repeat prescriptions. */
export declare function programmePreAppWeeks(definition: any, weekIndex: any): number[];
/** Activate a frozen definition in a draft state, as store.update's other helpers do. */
export declare function activate(S: any, definition: any, opts?: {}, index?: ExerciseIndex): {
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
};
/** Adopt current routines without changing their ids, prescriptions, or queue progress. */
export declare const adopt: (S: any, definition: any, existingRoutineIds: any, opts?: {}, index?: ExerciseIndex) => {
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
};
/** Set an explicit lower bound; projected dates themselves never enter the stored cycle. */
export declare function shiftNotToday(S: any, cycleId: any, today?: string): boolean;
export declare function skip(S: any, cycleId: any, instanceId: any, { today, now, reason }?: {
    now?: number | undefined;
    reason?: string | undefined;
    today?: string | undefined;
}): any;
export declare function pin(S: any, cycleId: any, instanceId: any, date: any, today?: string): any;
export declare function pause(S: any, cycleId: any, today?: string): boolean;
export declare function resume(S: any, cycleId: any, { today, now }?: {
    now?: number | undefined;
    today?: string | undefined;
}): boolean;
/** Resolve finished logs and move to the first week still pending; a calendar boundary does nothing. */
export declare function advanceProgramme(S: any, today?: string, now?: number): boolean;
/** Insert a separate stage without renumbering authored weeks or retargeting logged routines. */
export declare function insertDeload(S: any, cycleId: any, { key, setsFactor, loadFactor }?: {
    key?: string | undefined;
    loadFactor?: number | undefined;
    setsFactor?: number | undefined;
}, index?: ExerciseIndex): {
    index: any;
    weekId: string;
    orderIndex: number;
    fromWeekIndex: any;
    unit: any;
    mode: string;
    rir: number;
    label: string;
    deload: {
        setsFactor: number;
        loadFactor: number;
        from: string;
    };
    days: any[];
};
