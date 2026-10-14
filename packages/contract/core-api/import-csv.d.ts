import type { ExerciseIndex } from './exercises';
/**
 * A real CSV reader: quoted fields, embedded commas and newlines, doubled quotes, BOM
 * and CRLF. Splitting on commas breaks on the first exercise named "Bench Press, Close
 * Grip" — and a whole history would import shifted by one column without ever erroring.
 */
export declare function parseCSV(text: any): string[][];
/** Name of the app a header looks like — shown back to the user so they can sanity-check. */
export declare function detectSource(header: any): "FitNotes" | "FitNotes (iOS)" | "Hevy" | "Strong" | null;
/**
 * Find the dataset exercise a foreign name refers to, or null.
 *
 * Curated alias first, then an exact word-bag match, then entries that contain every
 * word of the query — but only when exactly one candidate is that close. Guessing
 * between "barbell bench press" and "dumbbell bench press" would file years of training
 * under the wrong lift, which is worse than leaving it as a custom exercise the user can
 * see and fix.
 */
export declare function matchExercise(name: any, index?: ExerciseIndex): any;
/**
 * Exact Hevy English title → catalogue id (from the generated title map).
 * Used when a CSV is detected as Hevy: same deterministic table as the API import,
 * keyed by title because Hevy's CSV has no template id column.
 */
export declare function matchHevyTitle(name: any, index?: ExerciseIndex): any;
export declare const bpFromName: (name: any) => string | RegExp | null;
/** "2020-12-30 18:51:52" · "2024-03-07" · "2024/03/07" · "2024.03.07" · "22 Dec 2025, 08:00" · "21 août 2024, 18:00" · "07/03/2024" -> { d, t } */
export declare function parseWhen(s: any): {
    d: string;
    t: number | null;
} | null;
/** Whole calendar days from one "YYYY-MM-DD" to another (0 when either is unreadable). */
export declare const daysBetween: (a: any, b: any) => number;
/**
 * Read an export into workouts openGym understands, WITHOUT touching state — the caller
 * shows the summary for confirmation first. Nothing here throws on a bad row: a history
 * of several thousand sets will contain oddities, and losing the file over one of them
 * helps nobody. Bad rows are counted and reported instead.
 */
export declare function importId(prefix: any, text: any): string;
export declare function priorCustom(customEx: any, id: any, name: any): any;
export declare function parseWorkoutCSV(text: any, { unit, customEx }?: {
    customEx?: unknown[] | undefined;
    unit?: string | undefined;
}, index?: ExerciseIndex): {
    sets?: undefined;
    error: string;
    source?: undefined;
    workouts?: undefined;
    customEx?: undefined;
    matched?: undefined;
    matchedSets?: undefined;
    created?: undefined;
    unmatchedNames?: undefined;
    skipped?: undefined;
    warmups?: undefined;
    fileUnit?: undefined;
    mixedUnits?: undefined;
    converted?: undefined;
    rpeSets?: undefined;
    rirSets?: undefined;
    from?: undefined;
    to?: undefined;
    kind?: undefined;
} | {
    error?: undefined;
    kind: string;
    source: string | null;
    workouts: {
        id: string;
        d: any;
        start: any;
        end: any;
        routineId: null;
        name: any;
        entries: {
            id: any;
            sets: any;
            topW: number | null;
            sg?: any;
            note?: any;
        }[];
        prs: never[];
        note?: any;
    }[];
    customEx: any[];
    matched: number;
    matchedSets: number;
    created: number;
    unmatchedNames: any[];
    sets: number;
    skipped: number;
    warmups: number;
    fileUnit: string;
    mixedUnits: boolean;
    converted: boolean;
    rpeSets: number;
    rirSets: number;
    from: any;
    to: any;
};
/**
 * Body-weight history from Apple Health, or any CSV with a date and a weight.
 *
 * Health's own export is one big `export.xml` — often several hundred MB, nearly all of
 * it step counts and heart rate. Building a DOM would blow up the tab, so the body-mass
 * records are pulled out with a scan instead. Health writes weights in the unit the
 * phone is set to and labels each record, so the unit is read per record.
 */
export declare function parseBodyweight(text: any, { unit }?: {
    unit?: string | undefined;
}): {
    source?: undefined;
    fileUnit?: undefined;
    converted?: undefined;
    from?: undefined;
    to?: undefined;
    error: string;
    bodyweight?: undefined;
    kind?: undefined;
} | {
    error?: undefined;
    kind: string;
    source: string;
    bodyweight: {
        d: any;
        w: number;
        t: any;
    }[];
    fileUnit: string;
    converted: boolean;
    from: any;
    to: any;
};
/** Sniff the file and parse it as whatever it is. */
export declare function parseImport(text: any, opts: any, index?: ExerciseIndex): {
    sets?: undefined;
    error: string;
    source?: undefined;
    workouts?: undefined;
    customEx?: undefined;
    matched?: undefined;
    matchedSets?: undefined;
    created?: undefined;
    unmatchedNames?: undefined;
    skipped?: undefined;
    warmups?: undefined;
    fileUnit?: undefined;
    mixedUnits?: undefined;
    converted?: undefined;
    rpeSets?: undefined;
    rirSets?: undefined;
    from?: undefined;
    to?: undefined;
    kind?: undefined;
} | {
    error?: undefined;
    kind: string;
    source: string | null;
    workouts: {
        id: string;
        d: any;
        start: any;
        end: any;
        routineId: null;
        name: any;
        entries: {
            id: any;
            sets: any;
            topW: number | null;
            sg?: any;
            note?: any;
        }[];
        prs: never[];
        note?: any;
    }[];
    customEx: any[];
    matched: number;
    matchedSets: number;
    created: number;
    unmatchedNames: any[];
    sets: number;
    skipped: number;
    warmups: number;
    fileUnit: string;
    mixedUnits: boolean;
    converted: boolean;
    rpeSets: number;
    rirSets: number;
    from: any;
    to: any;
} | {
    source?: undefined;
    fileUnit?: undefined;
    converted?: undefined;
    from?: undefined;
    to?: undefined;
    error: string;
    bodyweight?: undefined;
    kind?: undefined;
} | {
    error?: undefined;
    kind: string;
    source: string;
    bodyweight: {
        d: any;
        w: number;
        t: any;
    }[];
    fileUnit: string;
    converted: boolean;
    from: any;
    to: any;
};
/**
 * Merge into state. Existing days win — importing twice never duplicates a workout. A day the
 * file has two sessions on brings both (they are checked against the state before the merge,
 * not against each other); a day already in the history brings neither.
 */
export declare function mergeImport(S: any, parsed: any, index?: ExerciseIndex): {
    added: any;
    skipped: number;
};
