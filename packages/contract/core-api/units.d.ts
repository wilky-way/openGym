import type { ExerciseIndex } from './exercises';
export declare function convertWeight(value: any, from: any, to: any): any;
export declare function convertBodyWeight(value: any, from: any, to: any): any;
/** A new state object with every weight expressed in `to`, and `unit` set to it. */
export declare function convertStateUnit(S: any, to: any, index?: ExerciseIndex): any;
