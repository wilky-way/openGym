export declare const REST_MAX: number;
export declare const REST_PAUSE_MIN = 5;
export declare const REST_PAUSE_MAX: number;
/** Whole seconds within [min, max]. Anything that is not a number reads as `min`. */
export declare function clampDuration(sec: any, min?: number, max?: number): number;
/** { m, s } for a number of seconds: 90 → { m: 1, s: 30 }. */
export declare function splitDuration(sec: any): {
    m: number;
    s: number;
};
/** Minutes and seconds back into seconds, clamped to the wheel's range. */
export declare function joinDuration(m: any, s: any, min?: number, max?: number): number;
/**
 * The short form a row shows: "45s" under a minute, "1:30" from a minute up, "Off" for 0 when
 * the caller says 0 means off. Digits stay Western, like the rest of the app's numbers.
 */
export declare function fmtDuration(sec: any, { off }?: {
    off?: null | undefined;
}): string;
/**
 * What a screen reader says: "1 minute 30 seconds", "45 seconds", "2 minutes". 0 is `off` when
 * given (the rest timer's "Off"), "0 seconds" otherwise.
 */
export declare function durationText(sec: any, { off }?: {
    off?: null | undefined;
}): any;
/** The rest timer's own wording for a row or a preview: "1:30" or "Off". */
export declare const fmtRest: (sec: any) => string;
