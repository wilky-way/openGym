/** Resolve a row's phase. An explicit phase wins over the legacy warmup boolean. */
export declare function phaseForSet(set: any, fallback?: string): "warmup" | "work";
export declare function isWarmupRow(set: any): boolean;
export declare function setType(set: any): any;
export declare const isDropSet: (set: any) => boolean;
export declare const isRestPauseSet: (set: any) => boolean;
export declare const isFailureSet: (set: any) => boolean;
/** Flip a row's to-failure mark, dropping the key when it goes off so the row is what it was. */
export declare function toggleFailure(set: any): any;
/** A drop-set's weight drops, oldest first; empty for anything else. */
export declare function dropsOf(set: any): any;
/** A rest-pause set's short-rest bursts, oldest first; empty for anything else. */
export declare function clustersOf(set: any): any;
/**
 * Weight x reps from a drop-set's drops, on top of its own main set. The 1RM estimate and the
 * progression engine deliberately read only a row's own `w`/`r` (the heaviest effort), so this
 * is the one place a drop-set's extra volume gets added back in for totals.
 *
 * A rest-pause row is different: its own `r` IS the total (every burst's reps included), and
 * `clusters` is only how that total breaks down — not extra volume on top of it. Adding
 * `clustersOf(set)` here as well would double-count the same reps twice.
 */
export declare function extraVolumeOf(set: any): any;
/** Append a weight drop to a row, marking it a drop-set. */
export declare function addDrop(set: any, drop: any): any;
/** Append a short-rest burst to a row, marking it a rest-pause set. */
export declare function addCluster(set: any, cluster: any): any;
/** Remove one drop by index. Clearing the last one reverts the row to a straight set. */
export declare function removeDropAt(set: any, i: any): any;
/** Remove one burst by index. Clearing the last one reverts the row to a straight set. */
export declare function removeClusterAt(set: any, i: any): any;
/** Patch one drop's fields in place (weight/reps steppers edit an existing drop). */
export declare function setDropAt(set: any, i: any, patch: any): any;
/** Patch one burst's fields in place (a reps stepper edits an existing burst). */
export declare function setClusterAt(set: any, i: any, patch: any): any;
/**
 * Suggested weight for the next drop: pct% lighter than the previous weight, on a weight you can
 * actually load. `grid` is the exercise's weight step (5 → 80 kg, not 80.5) or a function that
 * snaps a weight onto the plates you own (lib/plates.js dropGrid); without one it rounds to .5,
 * the way it always did. A drop never comes out at or above the weight it drops from.
 */
export declare function nextDropWeight(prevWeight: any, pct: number | undefined, grid: any): number;
/** Suggested reps for the next rest-pause burst: roughly half the previous rep count. */
export declare function nextBurstReps(prevReps: any): number;
/**
 * Split a rest-pause total (the extra reps you want past the activation set) into a descending,
 * roughly-halving sequence of bursts that adds back up to it — e.g. 12 -> [6, 3, 2, 1]. This is
 * what a planned rest-pause exercise configures directly, rather than a burst count picked by
 * hand: you say how many reps you want out of the whole rest-pause portion, not how many rests.
 */
export declare function splitBurstReps(total: any): number[];
export declare function isSideSet(set: any): boolean;
export declare const WEIGHT_ORIGIN_MANUAL = "manual";
/** Includes a completed limb even when its partner is still unchecked. */
export declare const hasCompletedWork: (set: any) => boolean;
/** Actual completed load x reps; the scalar maximum weight is only a summary. */
export declare function completedVolumeOf(set: any): any;
export declare function makeSideSet(row?: {}): any;
export declare function syncSideAggregate(row: any): any;
export declare function setSideField(row: any, side: any, field: any, value: any): any;
export declare function toggleSide(row: any, side: any): any;
export declare function addSideDrop(row: any, pct: any, grid: any): any;
export declare function removeSideDropAt(row: any, i: any): any;
export declare function setSideDropAt(row: any, side: any, i: any, patch: any): any;
export declare function addSideCluster(row: any, restSec: any): any;
export declare function removeSideClusterAt(row: any, i: any): any;
export declare function setSideClusterAt(row: any, side: any, i: any, r: any): any;
export declare function normalizeMode(value: any, fallback?: string): string;
/** Resolve one row's mode: explicit row, parent target, then legacy result fields. */
export declare function modeForSet(set: any, target?: {}): string;
/** Resolve a single mode for an entry; mixed work-row modes intentionally return null. */
export declare function modeForEntry(entry: any, fallback?: null): any;
