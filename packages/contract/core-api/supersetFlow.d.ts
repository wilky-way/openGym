export declare function nextUnfinishedUnit(entries: any, units: any, fromIdx: any): any;
export declare function insertionIndexAfterCurrentUnit(units: any, currentIndex: any, entryCount: any): number;
export declare function setProgressHighWater(entry: any, previous?: number): {
    isNew: boolean;
    highWater: number;
};
/**
 * Whether completing a set should start a rest timer.
 *
 * A rest belongs after every completed set — the last set of an exercise included, because
 * another exercise follows it and you rest before that one too. The only set with nothing
 * left to time is the last set of the last exercise, where the session is over.
 *
 * Ordinary exercises used to "finish quietly" instead: an exercise started no rest on its
 * closing set, so a two-set exercise timed one rest instead of two (issue #3) and a rest
 * never carried across the gap into the next exercise. Supersets already did it this way.
 */
export declare function restAfterSet({ unitDone, lastUnit }: {
    lastUnit: any;
    unitDone: any;
}): boolean;
/**
 * Whether re-checking an already-completed set should start a rest.
 *
 * The high-water rule deliberately swallows a re-check so that unchecking and re-checking
 * finished work does not replay navigation or reopen sheets. But a re-check is still you
 * telling the app a set is done, and that is the other half of issue #3 — "after the first
 * set, sometimes a break doesn't appear". That is what it looks like when you uncheck a set
 * to correct the reps after its rest has already run out: nothing times the rest you are
 * actually about to take.
 *
 * So: fill a gap, never disturb a rest that is already counting down. A timer that is running
 * belongs to the set you finished most recently, which is a better answer than restarting it.
 */
export declare function restOnRecheck({ timerRunning, unitDone, lastUnit }: {
    lastUnit: any;
    timerRunning: any;
    unitDone: any;
}): boolean;
/**
 * How long the rest after a completed set should run, in seconds.
 *
 * An exercise may carry its own `restSec` in its target (issue #10) — a heavy triple and a set
 * of curls do not want the same break. One that carries none inherits `defaultRestSec`, the
 * global rest timer, which is what every routine did before the field existed.
 *
 * `unit` is the superset group the set belongs to, as entry indices — a plain exercise is a
 * group of one. A group rests once, after the round, so it takes the LONGEST rest any of its
 * members asked for: the shortest would send you back to the bar before the member that needs
 * the most recovery is ready.
 *
 * `defaultRestSec` of 0 is the rest timer turned off (v1.2.11). That silences the members that
 * have no rest of their own, but an exercise that explicitly asks for one still gets it — the
 * setting is a default, and this field overrides the default.
 */
export declare function restSecFor(entries: any, unit: any, defaultRestSec: any, setRest?: { idx: number; sec: number } | null): any;
/**
 * The rest a completed set earns when it was a warm-up ramp set.
 *
 * Ramp sets are light and short, so an exercise may carry its own `warmupRestSec` in its target
 * next to `restSec`. It applies between ramp sets only: the break after the LAST ramp set, into
 * the first work set, is `workRestSec` (the value restSecFor resolved), because that is the rest
 * the first heavy set actually needs. An exercise without the field, or a work set, rests
 * `workRestSec` — exactly what every routine did before the field existed.
 */
export declare function warmupRestSecFor(entry: any, setIdx: any, workRestSec: any): any;
export declare function supersetFlowStep(entries: any, unit: any, fromIdx: any): {
    unitDone: boolean;
    roundDone: boolean;
    nextIdx: any;
} | null;
