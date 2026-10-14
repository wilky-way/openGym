import type { ExerciseIndex } from './exercises';
import { exOr } from './exercises.js';
export declare const FIT_EPOCH_OFFSET = 631065600;
/** A JavaScript time (ms since 1970) as a FIT date_time (s since 1989-12-31). */
export declare const fitTime: (ms: any) => number;
export declare function fitCrc(bytes: any, crc?: number): number;
export declare const BASE: {
    enum: number[];
    uint8: number[];
    uint16: number[];
    uint32: number[];
    uint32z: number[];
    string: number[];
};
/**
 * Encode `messages` into a complete .fit file. A message is `{ global, fields }`, each field
 * `[number, type, value, size?]` (size only for a string). A local message type is defined the
 * first time a layout is used, and defined again only when the slot is reused for another.
 */
export declare function encodeFit(messages: any): Uint8Array<ArrayBuffer>;
export declare const MSG: {
    fileId: number;
    session: number;
    lap: number;
    event: number;
    deviceInfo: number;
    activity: number;
    fileCreator: number;
    set: number;
};
export declare const SPORT: {
    generic: number;
    running: number;
    cycling: number;
    fitnessEquipment: number;
    training: number;
    walking: number;
    rowing: number;
};
export declare const SUB_SPORT: {
    generic: number;
    treadmill: number;
    indoorCycling: number;
    indoorRowing: number;
    elliptical: number;
    stairClimbing: number;
    strengthTraining: number;
    cardioTraining: number;
};
export declare const CATEGORY: {
    benchPress: number;
    calfRaise: number;
    cardio: number;
    carry: number;
    chop: number;
    core: number;
    crunch: number;
    curl: number;
    deadlift: number;
    flye: number;
    hipRaise: number;
    hipStability: number;
    hipSwing: number;
    hyperextension: number;
    lateralRaise: number;
    legCurl: number;
    legRaise: number;
    lunge: number;
    olympicLift: number;
    plank: number;
    plyo: number;
    pullUp: number;
    pushUp: number;
    row: number;
    shoulderPress: number;
    shoulderStability: number;
    shrug: number;
    sitUp: number;
    squat: number;
    totalBody: number;
    tricepsExtension: number;
    warmUp: number;
    run: number;
};
/** The FIT exercise_category of an exercise ({ n, tg, bp }), or 65534 (unknown). */
export declare function fitCategory(ex: any, mode: any): any;
/** [sport, sub_sport] of one cardio exercise, read off its name and equipment. */
export declare function cardioSport(ex: any): number[];
/**
 * The FIT messages for a finished workout `w`. `unit` is the profile's weight unit (weights are
 * stored in it, FIT wants kilograms), `version` the app's ("1.4.0"), `exOf(id)` the exercise.
 */
export declare function workoutFitMessages(w: any, { unit, version, exOf }?: {
    exOf?: typeof exOr | undefined;
    unit?: string | undefined;
    version?: string | undefined;
}, index?: ExerciseIndex): {
    global: number;
    fields: (string | number | undefined)[][];
}[];
/** The finished workout `w` as the bytes of a .fit file. Options as workoutFitMessages. */
export declare const workoutFit: (w: any, options: any, index?: ExerciseIndex) => Uint8Array<ArrayBuffer>;
/** "opengym-2026-10-09-1830.fit": the day and the start time, so two sessions a day stay apart. */
export declare function fitFileName(w: any): string;
