import type { ExerciseIndex } from './exercises';
/**
 * Where a planned session's reps come from (Settings → During a workout). 'plan', the default:
 * the routine's own sets × reps, with history and the progression policy deciding the weight —
 * and a policy that moves reps (double progression, bodyweight, a timed hold) still moving them
 * from there. 'last': the reps you logged last time, the way every planned session opened before
 * this setting existed. A profile saved before it, or one that never chose, reads as 'plan'.
 */
export declare const startsFromLast: (st: any) => boolean;
/** A deload uses working history of this series, with a visible seed fallback when absent. */
export declare function programmeDeloadConfig(st: any, cfg: any, routine: any, index?: ExerciseIndex): {
    cfg: any;
    deload: any;
} | null;
/** Singular upstream stamp identifies the first occurrence; each entry freezes its own id. */
export declare function programmeInstanceFor(routines: any): {
    cycleId: any;
    instanceId: any;
    weekIndex: any;
    ordinal: any;
} | null;
/**
 * One planned exercise, built the way a session builds it: the prescription, the rows it opens
 * with and the target it is judged against. The session start, a mid-session edit of the
 * exercise, and an exercise added to or swapped into a planned session all build through here,
 * so an entry cannot come out differently depending on where it was made. `routine` is the one
 * the exercise is planned in: its own history comes first (#216) and its policy applies.
 * `noProg` builds the routine's own numbers with no prescription, as an excluded routine does.
 */
export declare function buildPlannedEntry(stored: any, cfg: any, routine: any, { noProg }?: {
    noProg?: boolean | undefined;
}, index?: ExerciseIndex): {
    target: any;
    planned: any;
    plan: {
        policy: string;
        kind: string;
    };
    sets: never[];
    series?: any;
    occurrenceId?: any;
    weekIndex?: any;
} | {
    target: any;
    plan: {
        policy: any;
        kind: string;
        rowReps?: undefined;
        sec?: undefined;
        sets?: undefined;
        weight?: undefined;
        reps?: undefined;
        why?: undefined;
    } | {
        policy: any;
        kind: string;
        weight: any;
        why: any[];
    } | {
        policy: any;
        kind: string;
        reps: number;
        sets: number;
        rowReps: any[];
        why: string[];
        sec?: undefined;
        weight?: undefined;
    } | {
        rowReps?: undefined;
        weight?: any;
        policy: any;
        kind: string;
        sec: any;
        why: string[];
        sets?: undefined;
        reps?: undefined;
    } | {
        rowReps?: undefined;
        policy: any;
        kind: string;
        reps: any;
        why: string[];
        sec?: undefined;
        sets?: undefined;
        weight?: undefined;
    } | {
        rowReps?: undefined;
        policy: any;
        kind: string;
        sec: any;
        why: any[];
        sets?: undefined;
        weight?: undefined;
        reps?: undefined;
    } | {
        rowReps?: undefined;
        sec?: undefined;
        sets?: undefined;
        policy: any;
        kind: string;
        weight?: any;
        why: string[];
        reps?: undefined;
    } | {
        policy: any;
        kind: any;
        weight: any;
        reps: any;
        sets: any;
        rowReps: any;
        why: any;
    };
    sets: any;
    planned: {
        sets: number;
    };
    series?: any;
    occurrenceId?: any;
    weekIndex?: any;
    deload?: any;
    carried?: boolean | undefined;
};
/**
 * What an exercise's settings sheet opens with in a running session: the entry's target with the
 * sets and reps (the range, the seconds) its routine planned put back in place of today's.
 *
 * The sheet edits the plan. Today's target is the prescription, and a double-progression aim, a
 * bodyweight climb or a set the rep ceiling added has moved it off the plan. Opened at those
 * numbers, a save that changed nothing stamped them as the plan, and the next build read that as
 * an edit: "Plan changed", the raise undone within the session, the climb started again the next
 * time (#275). The weight stays today's, the one on the bar. An entry built before plans were
 * stamped has only its target.
 */
export declare function plannedConfigOf(entry: any): any;
/**
 * Whether an entry is rebuilt the way an excluded routine builds its exercises: at the routine's
 * own numbers, with no prescription (buildPlannedEntry's `noProg`).
 *
 * `entry.noProg` comes from two places. A deload or rehab routine freezes it onto every exercise
 * it starts, and those are built without a prescription. An exercise's ⋯ menu sets it by hand for
 * one session, and that only stops the session from counting: its rows stay at the prescription.
 * Read as the first kind, a hand-set flag made a rebuild (Progression settings saved, a swap) drop
 * today's 102.5 to the routine's own 60, and its Undo then let those 60 count as progress. So only
 * an entry whose routine is itself kept out is built that way.
 */
export declare const builtOutOfProgression: (entry: any, routine: any) => boolean;
export declare function buildSessionEntries(st: any, r: any, index?: ExerciseIndex): any;
