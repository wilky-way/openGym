/** v1.3.9's `s` hash of a copy: the rest of it, keys sorted, FNV-1a over the JSON. */
export declare function restHash139(S: any): any;
/**
 * The copy `local` and `server` both started from, as far as their settings go: per key, the
 * value of the side that did not change it. null when no way round, or more than one, matches
 * `fpS`, or too many settings differ to try.
 */
export declare function legacyBase(local: any, server: any, fpS: any): {} | null;
/**
 * `local` (an old app's owed copy) ready to merge with `server`: every setting and plan day this
 * device changed since the copy `fp` was taken of is stamped at `now`. `resolved` false when that
 * could not be told and the device changed something besides its lists: the caller keeps the
 * copy aside. Returns a new object for `state`.
 */
export declare function liftLegacy(local: any, server: any, fp: any, now?: number): {
    state: any;
    resolved: boolean;
};
