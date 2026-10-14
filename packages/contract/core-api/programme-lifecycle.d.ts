import type { ExerciseIndex } from './exercises';
export declare const runningProgramme: (S: any) => any;
export declare function requireProgrammeIdle(S: any): void;
export declare function endProgramme(S: any, cycleId: any, opts?: {}): any;
export declare function startProgramme(S: any, definition: any, opts?: {}, index?: ExerciseIndex): any;
export declare function switchProgramme(S: any, cycleId: any, definition: any, opts?: {}, index?: ExerciseIndex): any;
export declare function resumeProgramme(S: any, cycleId: any, opts?: {}): any;
