/** 'rotation' while a usable live queue exists, or once chosen with nothing built yet (S.scheduleMode). */
export declare const scheduleModeOf: (S: any) => "rotation" | "week";
/** A queue payload arrived but is unusable (malformed, duplicate-only, all-deleted): Week + a fix-up in Plan. */
export declare const queueRecovery: (S: any) => boolean;
/** The saved sequence's routines that still exist, first occurrence of each — the ids a new pass gets. */
export declare const rotationIds: (S: any) => any;
/** Settings → Rotation with a saved rotation and no queue. False when nothing valid is left to start. */
export declare function startPass(s: any, today?: string, now?: number): boolean;
/**
 * Plan's editor save: create the rotation on the first save, adopt an externally written queue,
 * or apply an ordinary edit. An edit keeps the running pass's `since`/`startsOn`, and the done
 * rule is by routine id since `since`, so progress already logged survives a reorder — and an id
 * added back after it was already trained today reads as done straight away.
 */
export declare function saveRotation(s: any, ids: any, label: any, today?: string, now?: number): void;
/**
 * Ends the current pass without touching the saved sequence — "Use Fixed Week", or the editor
 * emptied down to nothing. Sweeps the same future pins saveRotation does, so a dropped pass never
 * resurfaces as a plain routine override (history.js) once the weekday plan is back in charge.
 */
export declare function stopPass(s: any, today?: string): void;
/**
 * "How you train: Rotation", the one switch Plan and Settings share. Holds Rotation selected
 * (S.scheduleMode) and starts a pass from the saved sequence when there is one to start. A
 * malformed queue is not a live pass: Plan's recovery is the honest answer there, not a new pass
 * written over data another client may still fix. Returns true when a pass started.
 */
export declare function chooseRotation(s: any, today?: string, now?: number): boolean;
/**
 * "How you train: Fixed week". Stops this app's own pass and keeps the saved sequence for a
 * later start; the weekday plan was never touched. A planner's queue (no matching rotationId)
 * is never this app's to drop, so only the mode flag moves for it.
 */
export declare function chooseFixedWeek(s: any, today?: string): void;
/**
 * Plan's "Start new pass": throw the current pass away and begin the saved sequence again, right
 * now. Today is its first day, so Home, Start and the day sheet all name its first session as
 * today's, and nothing logged before this moment counts for it (`strict`, queue.js): a session
 * done earlier today was the old pass's, even under the same routine name.
 */
export declare function startNewPass(s: any, today?: string, now?: number): void;
/**
 * Called with the state a finished workout has just been written into. Replaces a COMPLETE pass
 * this app manages with the next one and returns true; returns false — leaving `S.queue`
 * untouched — for an incomplete pass, a queue with no matching `rotationId`, or a managed pass
 * that no longer matches its rotation (the editor will resync it on the next save).
 *
 * The next pass is the rotation, rotated so it begins after the final queue id this workout
 * credited: `[A,B,C]` closed by C repeats as `[A,B,C]`, closed by B becomes `[C,A,B]`.
 */
export declare function refillAfter(s: any, w: any, today?: string, now?: number): boolean;
/**
 * A complete pass this app manages, refilled as the finish that completed it would have
 * (refillAfter), taking the latest workout that credited it as that finish. For a copy that
 * reached this state without a finish on this device: a sync merge that took both devices'
 * sessions of the pass, or kept the other copy's queue over this one's refill. Returns true when
 * it refilled; anything else (no managed pass, an incomplete one) is left alone.
 */
export declare function refillIfComplete(s: any, today?: string, now?: number): boolean;
