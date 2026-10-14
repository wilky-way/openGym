import type { ExerciseIndex } from './exercises';
/**
 * Create a deep copy of a routine with a new id and a "(Copy)" suffix.
 * All exercises and their configuration are preserved independently.
 */
export declare function copyRoutine(routine: any, suffix?: string): any;
export declare function deleteRoutine(s: any, id: any): {};
/**
 * Everything deleteRoutine is about to take away, so an Undo can put the routine back where it
 * was (Plan's swipe and minus, v1.3.11): the routine itself and its place in the list, its place
 * on each weekday that holds it, the reschedules that name it, and its places in the saved loop
 * and the live queue. deleteRoutine leaves the last two alone (an id that no longer resolves is
 * skipped where they are read), but a save in between may have dropped it, so they are kept too.
 * Null when there is no such routine.
 */
export declare function routineSnapshot(S: any, id: any): {
    routine: any;
    index: any;
    week: {};
    dayPlan: {};
    seqAt: any;
    queueAt: any;
} | null;
/**
 * Undo for deleteRoutine, in place on a store draft, from a routineSnapshot taken just before it.
 * Each pointer goes back to its old position, or to the end of a list that has since got
 * shorter; a reschedule only where that date has not been planned again since. False, and nothing
 * changed, when a routine with that id exists again (another device put it back first).
 */
export declare function restoreRoutine(s: any, snap: any): boolean;
export declare function replaceSlotExercise(slot: any, id: any, S: any, rid: any, index?: ExerciseIndex): any;
/**
 * Where a running session's exercise sits in the routine it was built from, as an index into
 * `routine.ex`, or -1 when it does not sit anywhere: a freestyle exercise, one added from
 * another routine, one swapped for something the routine never had.
 *
 * A session entry keeps the routine it came from (`rid`), and a combined day can hold the same
 * exercise twice, so the match is by position among the twins: the second bench press of that
 * routine in the session is the routine's second bench press.
 */
export declare function routineSlotIndex(routine: any, entries: any, idx: any): number;
/**
 * What a running session's exercise would change in its routine, or null when there is nothing
 * to change: the exercise has no routine slot, or the slot already says what the session did.
 * `changes` are `{ key, from, to }` for `warmupSets`, `restSec` and `note`.
 *
 * Warm-ups added in a session used to last that session only, and so did anything edited on the
 * exercise's settings sheet from inside it (Progression settings opens the same sheet the routine
 * editor does). Sets, reps and weight are not offered: the progression engine moves those every
 * session, and the routine is the plan it reads them against.
 */
export declare function routineChangesFromEntry(routine: any, entries: any, idx: any, index?: ExerciseIndex): {
    at: number;
    changes: {
        key: string;
        from: string | number;
        to: any;
    }[];
} | null;
/**
 * Write those changes into the routine, in place on a store draft, the way the config sheet
 * does: a key is only stored when it has a value, so "no warm-ups" removes it instead of leaving
 * a 0 that no plan file ever had. Returns the changes it applied, or null.
 */
export declare function updateRoutineFromEntry(routine: any, entries: any, idx: any, index?: ExerciseIndex): {
    key: string;
    from: string | number;
    to: any;
}[] | null;
