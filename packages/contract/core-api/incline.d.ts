import type { ExerciseIndex } from './exercises';
export declare const INCLINE_MAX = 40;
export declare const INCLINE_STEP = 0.5;
/**
 * A typed or stepped incline as it is stored: on the half percent, between 0 and 40. Nothing
 * (a cleared field) stays nothing, so the key goes rather than holding a 0 nobody typed.
 */
export declare function clampIncline(v: any): number | null;
/**
 * Whether a cardio exercise offers the incline column. A catalogue exercise does when its name
 * or equipment says treadmill, walking, running, stairs or elliptical. Your own exercise does
 * unless its name says it is a bike, a rower and the like: its name can be in any language, and
 * an optional field you never fill costs nothing.
 */
export declare function inclineFits(ex: any, index?: ExerciseIndex): boolean;
/** Whether a set carries a grade worth showing: anything above flat. */
export declare const hasIncline: (s: any) => boolean;
/** What a new row takes over from the set it follows: its incline, when it had one. */
export declare const inclineFrom: (s: any) => {
    incline: number;
} | {
    incline?: undefined;
};
