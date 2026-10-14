import type { ExerciseIndex } from './exercises';
export declare function routineFromSession(session: any, name?: any, routines?: any[], index?: ExerciseIndex): {
    id: string;
    name: string;
    ex: any;
};
export declare function saveSessionAsRoutine(state: any, session: any, name: any, index?: ExerciseIndex): string;
