import type { ExerciseIndex } from './exercises';
/** Build the shareable bundle: every routine, the week schedule, referenced customs. */
export declare function buildPlanBundle(S: any, name: any, index?: ExerciseIndex): {
    opengym_plan: number;
    exported: string;
    name: any;
    unit: any;
    week: {};
    routines: any;
    customEx: any;
};
/**
 * Validate + normalise an imported file. Throws with a friendly message if it isn't one.
 *
 * Every exercise id has to resolve — either to the built-in library or to a custom
 * exercise carried in the same file. An id that resolves to neither (a hand-edited file,
 * an export from a build with a different exercise dataset) is dropped here: kept, it
 * would sit invisibly in the routine and only surface as a blank screen when the routine
 * is trained.
 */
export declare function parsePlan(raw: any, destinationUnit?: string, index?: ExerciseIndex): {
    name: any;
    routines: any;
    week: any;
    customEx: any;
    dropped: number;
    routineCount: any;
    exerciseCount: any;
    scheduledDays: number;
    unit: any;
    sourceUnit: any;
    destinationUnit: any;
};
/**
 * Merge a parsed bundle into a draft state `s` (call inside store.update).
 *  - customs: reuse one you already have with the same name + body part, else add it fresh
 *  - routines: always added as NEW routines (fresh ids) — never overwrites yours
 *  - schedule: optional; when on, the shared week REPLACES yours (days the shared plan
 *    leaves empty become rest days — a half-overwritten week would silently mix two plans)
 */
export declare function mergePlan(s: any, bundle: any, { schedule }?: {    schedule?: unknown;
}, index?: ExerciseIndex): {
    routines: any;
};
/**
 * Full self-contained HTML for the print/PDF view. With `routineId` it is that one routine on
 * its own page (#282) — the session you take to the gym, not the week around it — so the week
 * schedule is left out and the routine's name is the page title.
 */
export declare function planPrintHTML(S: any, owner: any, { routineId }?: {    routineId?: unknown;
}, index?: ExerciseIndex): string;
/**
 * Render the plan and open the browser's print dialog (→ Save as PDF).
 * Uses a hidden iframe so we never navigate away or trip a popup blocker.
 * `opts` is planPrintHTML's: `{ routineId }` prints a single routine.
 */
export declare function printPlan(S: any, owner: any, opts: any, index?: ExerciseIndex): void;
