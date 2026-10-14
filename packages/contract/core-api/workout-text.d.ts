import type { ExerciseIndex } from './exercises';
/**
 * `unit` is the profile's, `nameOf(entry)` the exercise's display name, `speedUnit` the one cardio
 * is shown in (lib/speed.js; km/h when absent). Blocks are separated by a blank line: the heading,
 * then each exercise (a superset's under one "Superset" line, its members together), then the
 * session note.
 */
export declare function workoutText(w: any, { unit, nameOf, speedUnit }: {
    nameOf: any;
    speedUnit?: any;
    unit: any;
}, index?: ExerciseIndex): string;
