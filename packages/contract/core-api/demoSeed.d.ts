import type { ExerciseIndex } from './exercises';
export declare function buildDemoState(index?: ExerciseIndex): {
    routines: any[];
    week: {
        1: any;
        3: any;
        5: any;
    };
    dayPlan: {};
    workouts: {
        id: string;
        d: string;
        start: number;
        end: number;
        routineId: any;
        name: any;
        bw: number;
        entries: any;
        prs: any[];
    }[];
    bodyweight: {
        d: string;
        w: number;
        t: number;
    }[];
    measurements: {
        d: any;
        t: number;
    }[];
    exWeights: {};
    targetW: number;
    effort: string;
};
