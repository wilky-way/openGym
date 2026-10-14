import type { ExerciseIndex } from './exercises';
export declare const STAMPED_MAPS: string[];
/** The copy with the later `_ts`; on a tie the first argument (callers pass local first). */
export declare const newerOf: (a: any, b: any) => any;
/**
 * Entries of `newer` in their order, then those of `older` whose key nothing in `newer` has.
 * Same key → `newer`'s entry. Duplicate keys within one list are dropped (first wins).
 */
export declare function unionById(newer?: any[], older?: any[], key?: (x: any) => any): any[];
/**
 * unionById for a list whose order the user set (routines): `newer`'s entries in their order, and
 * each entry only `older` has goes in right after its nearest earlier neighbour in `older` (at
 * the start when it has none there). Appending them sent a routine that one device put back
 * (Plan's Undo) to the end of the list whenever the other device's copy was the newer one.
 */
export declare function unionByNeighbours(newer?: any[], older?: any[], key?: (x: any) => any): any[];
/**
 * The photos and videos of a workout both copies have: `kept`'s list as it stands (its order,
 * its refs), then every ref of `other`'s list whose hash `kept` lacks. Whole-record merging lost a
 * photo added on one device whenever the other edited that workout's note, date or length, or
 * added a photo of its own, later — the other copy's version was kept, and with it its list.
 *
 * The price is the file's known limit, one field in: with no record of what was removed, a photo
 * taken off on one device inside the conflict window comes back from the other copy that still
 * lists it — a resurrected photo is one tap to remove again, a lost one is gone. A removal the
 * other device has already pulled sticks, since neither copy lists it any more. Refs are carried
 * as they are; readers normalise and cap (workoutMediaOf). Mutates and returns `kept`.
 */
export declare function mergeWorkoutMedia(kept: any, other: any): any;
/** One entry per day; where both have a day, the one edited later (`t`); sorted by day. */
export declare function mergeBodyweight(a?: any[], b?: any[]): any[];
/**
 * Stamps `_ts` on a saved workout changed after it was logged — its sets edited, moved to another
 * day or time, its length or its note corrected — the edit time mergeStates needs to keep the
 * version edited last, the way stampRoutines does for a plan. Without it the copy that was newer
 * as a whole decided: a phone that logged a weigh-in after the desktop corrected a workout brought
 * the uncorrected one back on the next conflict. Mutates and returns `w`.
 */
export declare function stampWorkout(w: any, now?: number): any;
/**
 * What an Undo needs to mark what it put back (see above), taken right after the change it may
 * undo: for every stamped setting or plan day that change moved, its stamp before and after, and
 * its value before. `before` and `after` are the copies around the change.
 */
export declare function undoMarks(before: any, after: any): {};
/**
 * In an Undo's draft `s`, after it put things back: marks every setting and plan day of `marks`
 * (undoMarks) that is now exactly what it was before the change, and that nothing changed since.
 */
export declare function markUndone(s: any, marks: any): any;
/**
 * The same for one field `k` of an entry `x` in an Undo's draft: `base` and `del` are the field's
 * stamps before and after the change it undid. Only when nothing changed the field since.
 */
export declare function markEntryUndone(x: any, k: any, base: any, del: any): any;
/**
 * Stamps `x`, the new version of an entry whose previous version is `old`, as edited at `now`:
 * its `_ts`, and in `_f` every field that differs from `old`. A new entry gets its `_ts` only.
 * Mutates and returns `x`.
 */
export declare function stampEntry(old: any, x: any, now: any): any;
/**
 * Two versions of one entry: the version edited last (`_ts`; `a` on a tie), with every field the
 * other side changed later (`_f`) taken from that side, removal included. Returns a new object.
 */
export declare function mergeEntry(a: any, b: any): any;
/**
 * A settings map whose entries carry their own edit time (`{ …, _ts }`), such as the Structural
 * Balance overrides or the plate-loading choices: every key of either side, and of a key both have, the entry set last — the
 * same rule a routine follows. Taking the newer copy's entry lost a choice made on one device
 * whenever the other had since logged a set; a plain key union brought a cleared entry back
 * from the side that still had it. So a clear is written as a stamped entry, not a delete, and
 * wins like any other edit. On a tie, or with `prefer`, the newer (preferred) side's entry stays.
 */
export declare function mergeStampedMap(newer: any, older: any, prefer: any): any;
/**
 * `follow` in the unit of `lead`: converted, or only relabelled when `lead`'s last switch kept the
 * numbers (see the file's header). Returns `follow` itself when the units already agree.
 */
export declare function inUnitOf(follow: any, lead: any, index?: ExerciseIndex): any;
/** An entry's name in resetIds: a workout's id (or day and start), a weigh-in's day and time, … */
export declare const entryKey: (field: any, x: any) => string;
export declare const RESET_ID_MAX = 20000;
/** Every field's names from `a` then `b`, each once, capped (see RESET_ID_MAX). */
export declare function mergeResetIds(a: any, b: any): {};
/** The names of every entry the given copies hold — what a reset wipes (see the file's header). */
export declare function resetIdsOf(...copies: any[]): {};
/**
 * What a copy that has not seen a reset still contributes after it (see the file's header): with
 * the reset's `ids`, everything but the entries it wiped; without (a reset from before ids were
 * kept), only the entries made after `at`. The kept loads are those of the workouts that remain.
 */
export declare function sinceReset(S: any, at: any, ids: any, index?: ExerciseIndex): any;
export declare const DELETED_MAX = 5000;
/**
 * Records in `next.deleted` every entry `prev` had and `next` no longer has, at `now`, and marks
 * as added back (`-now`) any entry `next` brought in again whose removal was on record (and any
 * favourite starred). Mutates and returns `next`; adds no `deleted` when there is nothing to record.
 */
export declare function stampDeletions(prev: any, next: any, now?: number): any;
/** Both copies' records of removals: per entry, the later stamp. */
export declare function mergeDeletions(a: any, b: any): {} | null;
export declare const ORDER_KEY = "routineOrder";
export declare function orderMoved(a: any, b: any): boolean;
/**
 * Stamps in `next.edited` every field (and every day of the plan, note, bar weight) that differs
 * from `prev`, at `now`. Mutates and returns `next`.
 */
export declare function stampEdits(prev: any, next: any, now?: number): any;
/** Both copies' edit stamps: per key, the later one. */
export declare function mergeEdits(a: any, b: any): any;
export declare function mergeStates(a0: any, b0: any, { prefer }?: {    prefer?: unknown;
}, index?: ExerciseIndex): any;
/**
 * `next` replacing `cur` wholesale (a backup import, a reset) never takes the reset stamp back:
 * the later `resetAt` stays, with its names — a restored backup that carried none would otherwise
 * be taken, on every device that saw the reset, for a copy from before it and wiped again.
 * Mutates and returns `next`.
 */
export declare function keepReset(cur: any, next: any): any;
/** Stamps `next`, a restored backup, as described above. Mutates and returns `next`. */
export declare function stampRestore(next: any, others?: any[], now?: number): any;
/**
 * A backup that replaces the profile ("Replace anyway", or an import with nothing to ask about) is
 * stamped like a reset of what it replaced, on top of stampRestore: every entry this device or the
 * server held that the backup lacks is recorded as removed at `now`, and every field of an entry
 * the backup holds in another version is stamped at `now`, and so is a stamped settings entry
 * (balance, loading, plates) it sets differently. A device that still had an unsent change from
 * before the replace used to bring the replaced workouts back with its merge, and its older edit
 * of an entry won over the backup's version. A change made after the replace (a later stamp) still
 * wins, and an entry only that device knew of is not named, so it stays. `others` are the copies
 * the replace knew: this device's and the server's. Mutates and returns `next`.
 */
export declare function stampReplace(next: any, others?: any[], now?: number): any;
/** The latest stamp a copy carries: its `_ts`, every setting, removal and entry stamp. */
export declare function highestStamp(S: any): number;
/**
 * Stamps everything the change from `prev` to `next` touched, at one time that comes after every
 * stamp `prev` carries (and `wall`, this device's clock): routines, custom exercises, workouts a
 * screen re-stamped (stampWorkout), removals, settings and plan days. Mutates `next`; returns
 * the time used, for the copy's own `_ts`.
 */
export declare function stampChange(prev: any, next: any, wall?: number): number;
/**
 * Stamps `_ts` on every routine of `next` that is new or differs from its version in `prev` — the
 * edit time mergeStates needs to keep the routine edited last. The store runs it on every change
 * (useStore update), so no screen that edits a plan has to remember to. Mutates and returns `next`.
 */
export declare function stampRoutines(prev?: any[], next?: any[], now?: number, putBack?: () => boolean): any[];
/**
 * Stamps `_ts` on every custom exercise of `next` that is new or differs from its version in
 * `prev`, the way stampRoutines does for a plan — the edit time mergeStates needs to keep the
 * version edited last. The store runs it on every change (useStore update). Mutates and returns
 * `next`.
 */
export declare function stampCustomEx(prev?: any[], next?: any[], now?: number): any[];
/** stampCustomEx for any list of entries with ids: equipment profiles, gym cards. */
export declare function stampEntries(prev?: any[], next?: any[], now?: number): any[];
export declare function localExtras(local: any, server: any): {
    workouts: number;
    bodyweight: number;
    customEx: number;
    routines?: number | undefined;
    setup?: number | undefined;
};
