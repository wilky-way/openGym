export declare const PYRAMID_MAX = "max";
export declare const MAX_PYRAMID_SETS = 10;
export declare const PYRAMID_PRESETS: (string | number)[][];
export declare function isPyramid(cfg: any): boolean;
export declare function normalizePyramid(list: any, stride?: number): (string | number)[];
export declare function pyramidFromFlat(cfg: any): any[];
export declare function flatFromPyramid(list: any): {
    sets: any;
    reps: any;
};
/** "12 · 8 · 6 · Max · 12" */
export declare function pyramidLabel(list: any): any;
export declare function pyramidTargetAt(list: any, i: any): any;
export declare function normalizePyramidRest(rest: any, length: any): number[];
export declare function normalizePyramidWeight(weights: any, length: any): number[];
/** The weight planned for work set `i` of a pyramid, or 0 when that set has none. An extra set
 *  added mid-session copies the last one's, like its target. */
export declare function pyramidWeightAt(cfg: any, i: any): number;
/** The rest a ticked work row of a pyramid earns, or 0 to fall back to the exercise's rest.
 *  `i` indexes `rows`, warm-ups included; the pyramid counts work sets only. */
export declare function pyramidRestFor(target: any, rows: any, i: any): number;
/** The record a Max set at weight `w` is up against: the most reps any Max set of this exercise
 *  did at `w` or heavier (more reps on less weight is not a record). Ties: heavier, then first. */
export declare function maxRecordAt(workouts: any, exId: any, w: any): {
    w: number;
    r: any;
    d: any;
    t: any;
} | null;
/** Most reps in a Max set, per workout, for the Stats chart: [{ t, y, d, w }]. */
export declare function maxRepsSeries(workouts: any, exId: any): any[];
