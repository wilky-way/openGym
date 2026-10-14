import type { ExerciseIndex } from './exercises';
export declare const workoutAt: (w: any) => any;
export declare function modeOf(cfg: any, index?: ExerciseIndex): any;
export declare const isTimed: (cfg: any, index?: ExerciseIndex) => boolean;
export declare const isBw: (cfg: any, index?: ExerciseIndex) => boolean;
export declare const isPerSide: (cfg: any) => boolean;
export declare const sideReps: (reps: any) => number;
export declare const repStep: (cfg: any) => 1 | 2;
export declare const setsFromRows: (cfg: any, rows: any, index?: ExerciseIndex) => number;
export declare function fmtSec(sec: any): string;
export declare const EFFORT: {
    rir: {
        f: string;
        hd: string;
        step: number;
        min: number;
        max: number;
    };
    rpe: {
        f: string;
        hd: string;
        step: number;
        min: number;
        max: number;
    };
};
export declare function stepEffort(kind: any, cur: any, dir: any): any;
export declare const capEffort: (kind: any, v: any) => any;
export declare const effortOf: (S: any) => any;
export declare function setLabel(id: any, s: any, cfg?: any, speedUnit?: any, index?: ExerciseIndex): string;
export declare function defaultConfig(id: any, mode: any, index?: ExerciseIndex): {
    sets: number;
    min: number;
    speed: number;
} | {
    min?: undefined;
    speed?: undefined;
    bodyweight: boolean;
    sets: number;
    sec: number;
    weight: number;
    mode: string;
} | {
    min?: undefined;
    speed?: undefined;
    bodyweight?: undefined;
    sets: number;
    sec: number;
    weight: number;
    mode: string;
} | {
    min?: undefined;
    speed?: undefined;
    bodyweight: boolean;
    sets: number;
    reps: number;
    weight: number;
    mode: string;
} | {
    min?: undefined;
    speed?: undefined;
    bodyweight?: undefined;
    sets: number;
    reps: number;
    weight: number;
    mode: string;
};
/** "2 × 10", "3 × 8–12", "2 × 0:45": what a plan asks for per set, without its load. */
export declare function setsRepsOf(cfg: any, index?: ExerciseIndex): any;
export declare function exLine(cfg: any, unit: any, speedUnit?: any, index?: ExerciseIndex): string;
export declare function cleanupSg(ex: any): void;
export declare function pairAdjacent(items: any, first: any, second: any, groupId: any): any[];
export declare function unpairSuperset(items: any, idx: any): any[];
/**
 * Is this completed entry excluded from progression / session read-back?
 *
 * "Excluded" moved from a whole-workout flag to a per-entry one (ENG-11): a rehab routine
 * combined with real work excludes only its own exercises. A legacy workout carries the
 * whole-workout flag and no per-entry field, so every one of its entries reads as excluded.
 * `noProg` is frozen onto the entry from its source routine's `excludeFromProgression` at
 * build time — editing the routine flag later never rewrites a saved session.
 */
export declare function entryExcluded(w: any, entry: any, index?: ExerciseIndex): boolean;
/**
 * Which routine a saved entry was planned by — the "slot" its numbers belong to (issue #216).
 *
 * Every entry of a session started since combined days carries its own `rid`. A session saved
 * before that has none, and there the workout's routine stands in for all of its entries. The one
 * exception is a newer session in which some entries carry a `rid` and this one does not: that is
 * an exercise added to a freestyle session, and it belongs to no routine at all.
 */
export declare function entryRoutineId(w: any, en: any): any;
export declare const entrySeries: (S: any, w: any, en: any) => any;
export declare const entryMatchesRoutine: (S: any, w: any, en: any, rid: any) => boolean;
/**
 * The last counting session of an exercise: `{ d, sets, target, rid?, planned? }`, or null.
 *
 * Given a routine id, the routine's own last session of it (issue #216): the same bench press in
 * a heavy day and a light day is two lines of progress, not one that zigzags between them. A
 * routine that has never trained the exercise falls back to its last session anywhere, so a new
 * or copied routine starts from what you actually lift rather than from nothing.
 */
export declare function lastEntryFor(S: any, exId: any, rid?: any): {
    d: any;
    sets: any;
    target: any;
    rid?: any;
    series?: any;
    planned?: any;
} | null;
/** How long any single note may get. Long enough for a paragraph, short enough to stay a note. */
export declare const NOTE_MAX = 500;
/**
 * The most recent session note the user pinned for this exercise, or null.
 *
 * A note written mid-session is about that session — "shoulder twinged today". Some of them are
 * about the NEXT one instead: "go a notch narrower". The pin is how the user says which, at the
 * moment of writing, when they are the only one who knows. Pinned notes surface again the next
 * time the exercise comes up; unpinned ones stay in that day's history.
 *
 * Only the newest pinned note is returned: a pin is a message to your next self, and a stack of
 * them from six sessions ago is noise, not context.
 */
export declare function pinnedNoteFor(S: any, exId: any): {
    note: any;
    d: any;
} | null;
/** The standing note for an exercise — the one that is true every session. */
export declare const exNoteFor: (S: any, exId: any) => any;
export declare function freestyleConfig(S: any, cfg: any): any;
export declare function bestWeightFor(S: any, exId: any, as?: any, index?: ExerciseIndex): number;
/**
 * The routines planned for a date, in merge order. Plural is the primary form now that a
 * weekday can hold several routines (`S.week[wd]` is `string[]`); the singular helpers below
 * are thin wrappers. `[]` — a stray empty array, or a key that is absent — all mean rest, so
 * "is this a rest day?" is `effectiveRoutineIds(S, iso).length === 0`.
 *
 * `S.dayPlan[iso]` stays scalar (a routine id, the `'rest'` sentinel, or undefined): the
 * per-date override and Start-time are single-pick. All array-tolerance is on `S.week`.
 *
 * A coach week (`S.queue`, lib/queue.js) has no weekdays: its sessions are done in order, and
 * the first undone one is today's session — so it goes in front of whatever the weekday
 * holds. The planner's own weekday pointers (a week applied before the queue existed) are
 * hidden behind it; routines you planned yourself ride along as a combined day. `today` is a
 * parameter so tests and the reminder builder can pin the clock; the override still wins.
 *
 * An override naming a queue session is a PIN (queue.js): the session is that day's, with the
 * weekday's own routines riding along as on any queue day, and the floating rule skips it on
 * other days. Programme pins use the occurrence's projected date. Once the session is done
 * or its programme week leaves the queue, its dayPlan mirror reads as if unpinned.
 */
export declare function effectiveRoutineIds(S: any, iso: any, today?: string): any[];
export declare function effectiveRoutines(S: any, iso: any): any[];
export declare const effectiveRoutineId: (S: any, iso: any) => any;
export declare const effectiveRoutine: (S: any, iso: any) => any;
/**
 * The next day that actually has something to train, looking forward from `iso` (exclusive).
 *
 * Takes a date string rather than reading the clock so callers and tests agree on "today".
 * A routine with no exercises does not count: starting one lands you in an empty session, so
 * it is not an answer to "what is next" (the same guard TabBar applies before starting). On a
 * combined day, any one routine with exercises makes the day trainable.
 * Returns null when the whole week is rest.
 *
 * Return shape carries `routines` (the whole day) plus `routine` = `routines[0]` for the
 * "what's next" label.
 */
export declare function nextTrainingDay(S: any, iso: any): {
    iso: string;
    weekday: number;
    routines: any[];
    routine: any;
} | null;
/**
 * Build the rows a planned exercise starts a session with: its work sets, preceded by however
 * many warm-up sets the routine asks for (`cfg.warmupSets`, 0 by default so an existing plan
 * behaves exactly as before).
 *
 * The warm-ups are stacked with insertWarmupRow, one call each, so the ramp is the same one
 * the in-session "Add warm-up set" button produces: each row halves the gap left to the work
 * weight, giving 50% / 75% / 87.5% for three, and never under the bar on a barbell lift
 * (barFloor). `options.step` is the exercise's loading step, passed in by the caller (see
 * insertWarmupRow for why this module cannot read it itself).
 */
export declare function buildSets(S: any, cfg: any, options?: {}, index?: ExerciseIndex): any[];
/** Beyond this a "warm-up" is its own workout; the config stepper stops here too. */
export declare const MAX_PLANNED_WARMUPS = 5;
/**
 * The lightest warm-up a lift can have: the bar it is done with (bar.js barWeightFor, the
 * athlete's own bar weight included), 0 for anything without one. Half of a 55 lb press is
 * 25 lb, which no one can load onto a 45 lb bar, so a warm-up rung never goes under it.
 */
export declare const barFloor: (S: any, exId: any, index?: ExerciseIndex) => any;
/**
 * Stamp every work row with the exercise's planned intensifier and pre-fill its drops/clusters,
 * already computed and editable — the plan designs the set, not a button pressed mid-workout.
 *
 * Must run AFTER applyPrescription: a drop-set's chain of drops is a percentage of each row's
 * own `w`, so it has to be computed from the final prescribed weight, not the pre-progression
 * one buildSets started from — otherwise a bumped working weight would leave stale, cheaper
 * drops sitting underneath it. `grid` puts each drop on a loadable weight (nextDropWeight).
 */
export declare function applyIntensifierPlan(sets: any, cfg: any, grid: any, index?: ExerciseIndex): any;
/**
 * "Last set to failure" (`cfg.lastToFailure`, written only when on): the last work row of a
 * freshly built exercise is marked as taken to failure, the way Greyskull's final set is an
 * AMRAP. Only that one row, and only a row not logged yet; every other row keeps what it had, so
 * a plan without the flag builds exactly the rows it always did. Runs inside applyIntensifierPlan,
 * the step every way of building an exercise's rows ends with, so none of them can forget it.
 */
export declare function applyFailurePlan(sets: any, cfg: any, index?: ExerciseIndex): any;
export declare function workoutVolume(w: any, index?: ExerciseIndex): number;
export declare function workoutDay(w: any): string | null;
export declare function workoutDuration(w: any): number;
export declare const setUnits: (s: any) => 1 | 2;
export declare const doneUnits: (s: any) => number;
export declare const setUnitsTotal: (entries: any) => any;
export declare function setsDone(w: any): number;
export declare function setsDoneActive(A: any): number;
export declare const lastBW: (S: any) => any;
export declare function supersetUnits(items: any): any[];
export declare function sessionSections(entries: any): {
    rid: any;
    items: any;
    units: any[];
}[];
export declare function moveSupersetUnit(items: any, index: any, direction: any): any[] | null;
export declare function moveRoutineEntry(items: any, index: any, direction: any): any[] | null;
export declare function unitOf(units: any, idx: any): any;
export declare function streakWeeks(S: any): number;
/**
 * Cascade an explicit work-set load edit through the later inherited work sets.
 *
 * Missing `weightOrigin` is inherited for compatibility with existing sessions. A row or side
 * marked `manual` is an explicit exception, so it stays put even when it is heavier or lighter.
 * `side` narrows a per-side edit to one limb; without it both limbs are eligible independently.
 * Completed rows (and completed limbs) never get rewritten. Clearing an inherited load removes
 * its `w` key just like a direct edit.
 *
 * Only a work-set edit cascades, and only onto work sets. Warm-ups are a ramp (buildSets), each
 * rung its own load, so editing one rung leaves the rungs after it where they were (setting
 * warm-up 1 of a 60/90/105 ramp to 65 used to turn it into 65/65/65).
 *
 * `backoffStep` (an entry built with back-off sets, lib/backoff.js): each later work row lands
 * one more step below the edited one rather than at the same load, so 26 → 27.5 on the top set
 * makes the back-off sets 25.5 and 23.5, not 27.5 three times.
 */
export declare function cascadeWeight(rows: any, from: any, value: any, side?: any, backoffStep?: number): any;
export declare function rerampWarmups(rows: any, step?: number | number[], floor?: number): any;
export declare function insertWarmupRow(rows: any, mode: any, target: any, step?: number, floor?: number): any;
export declare const canBeWarmup: (row: any) => boolean;
export declare function makeWarmupAt(rows: any, i: any): any;
export declare function makeWorkAt(rows: any, i: any): any;
/** The rows one set takes up at `i`: a timed per-side hold is an L row and an R row that read
 *  as one set number (addSet pushes them as a pair), so taking one out takes its partner too.
 *  Anything else is the row alone. Returns [start, count]. */
export declare function setSpanAt(rows: any, i: any): any[];
/** "One more like this one": a copy of row `i` right below it, unticked and without sub-rows.
 *  A timed per-side hold is planned as an L row then an R row (buildSets), so copying either
 *  half copies the pair and puts it after the pair, keeping every L next to its R. */
export declare function copySpanAt(rows: any, i: any): {
    start: any;
    end: any;
};
export declare function copyRowAt(rows: any, i: any): any;
/** Undo for a removed set: `row` back at index `i` exactly as it was (tick, values, sub-rows).
 *  An index past the end (the entry lost rows since) lands it last. */
export declare function insertRowAt(rows: any, i: any, row: any): any;
/** Remove the set at `i` (both halves of a per-side pair), never emptying the entry. */
export declare function removeRowAt(rows: any, i: any): any;
/** "Remove set": the last set, which for a timed per-side exercise is its last L/R pair. */
export declare const removeLastSet: (rows: any) => any;
/** Completed non-warm-up sets across a workout's entries, counted the way setsDone counts them —
 *  each side of a unilateral row on its own — so "22 sets · 19 work" never reads as three
 *  warm-ups on a workout that had none. */
export declare function workSetsDone(w: any): any;
export declare function metricRowsForEntry(entry: any, mode: any): any;
/** The authoritative metric for an entry; reps rows take precedence over timed/cardio rows. */
export declare function metricModeForEntry(entry: any, fallback?: null): any;
/** Every saved occurrence of an exercise in one workout, in its stored order. */
export declare function entriesForExercise(workout: any, exId: any): any;
/** Metric data for every occurrence in one workout, including legacy reps topW-only records. */
export declare function metricEntriesForExercise(workout: any, exId: any, index?: ExerciseIndex): any;
/** Total reps from one completed row, counting only completed limbs of a per-side row. */
export declare function completedRepsOf(set?: {}): any;
/** Best load from completed work rows, with a guarded reps-only legacy topW fallback. */
export declare function bestWeightForEntry(entry?: {}, index?: ExerciseIndex): number;
