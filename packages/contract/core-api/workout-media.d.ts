/**
 * Adds a photo or video to the saved workout `w` (the record or a copy of it) inside `state`.
 * Returns 'added', or why not: 'gone' (the workout was deleted meanwhile), 'invalid' (not a
 * MediaRef normalizeMediaRef accepts), 'full' (already shows WORKOUT_MEDIA_MAX) or 'dup' (that
 * very file is already on it). Mutates `state` — made for useStore's update().
 */
export declare function addWorkoutMedia(state: any, w: any, ref: any, now?: number): "added" | "dup" | "full" | "gone" | "invalid";
/**
 * Takes the file `hash` off the saved workout `w` (every entry that names it). Returns whether
 * anything changed. The file itself is left to the GCs: another device, a stash or an exercise
 * may still refer to it, and the server keeps it for its grace period either way.
 */
export declare function removeWorkoutMedia(state: any, w: any, hash: any, now?: number): boolean;
