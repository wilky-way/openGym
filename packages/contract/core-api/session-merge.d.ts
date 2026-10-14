import type { ExerciseIndex } from './exercises';
/** Validate live starts separately from building entries for historical/backfilled workouts. */
export declare function requireProgrammeStart(st: any, routineIds: any, today: any): void;
/**
 * Build a session's entries from an ordered list of routine ids.
 * - resolves + filters to still-existing routines, de-duplicates by id (first wins)
 * - concatenates each routine's entries in list order
 * - stamps `entry.rid` = that routine's id on every entry
 *
 * Returns `{ entries, routineIds, routines }` — `routineIds` / `routines` are the resolved,
 * de-duplicated list, so a caller stores exactly what was built.
 */
export declare function buildCombinedEntries(st: any, routineIds: any, index?: ExerciseIndex): {
    entries: any[];
    routineIds: any[];
    routines: any[];
};
/**
 * The session name for a combined workout, from routine names in merge order (ENG-12 rule):
 *   1–3 routines → join with " + "          → "Rehab + Core"
 *   4+ routines  → first two, then "+ N more" → "Rehab + Core + 2 more"
 * An empty list returns null — not a reachable state for a saved or active session.
 */
export declare function deriveSessionName(names: any): any;
