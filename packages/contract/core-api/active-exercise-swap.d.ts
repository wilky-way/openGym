/**
 * Swap one exact active-workout occurrence.
 *
 * Unlogged occurrences are replaced in place. Logged results are never relabelled: after explicit
 * confirmation, the replacement is inserted beside the original. A logged group member also
 * requires an explicit choice to keep the replacement in the group or detach it after the group.
 */
export declare function swapActiveExercise(active: any, index: any, replacement: any, { loggedConfirmed, groupDisposition }?: {
    loggedConfirmed?: boolean | undefined;
    groupDisposition?: unknown;
}): {
    inserted: boolean;
    index: any;
    needsConfirmation?: undefined;
    grouped?: undefined;
} | {
    inserted?: undefined;
    needsConfirmation: boolean;
    grouped: boolean;
    index: any;
} | null;
