/** A fingerprint of `S`: per-entry hashes of the counted lists, one hash (`s`) for the rest. */
export declare function syncFingerprint(S: any): {
    s: string;
};
/**
 * How many entries of `S` were added, edited or removed since the copy `fp` was taken of, plus
 * one when anything else changed. null when there is no fingerprint to compare with — the device
 * last agreed with the server before it kept one, so it cannot say how much is waiting.
 */
export declare function countChanges(S: any, fp: any): number | null;
