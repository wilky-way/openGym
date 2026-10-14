import type { ExerciseIndex } from './exercises';
export declare const starterRoutines: () => any;
export declare const starterPlanOptions: () => {
    id: string;
    days: number;
}[];
export declare const starterPlanDays: (id: any) => any;
export declare const substituteFor: (ex: any, equipment: any, taken: any, index?: ExerciseIndex) => any;
export declare const buildStarterPlan: (id?: unknown, equipment?: readonly string[] | null, index?: ExerciseIndex) => {
    routines: any;
    schedule: any;
    fit?: {
        swapped: number;
        dropped: number;
    } | undefined;
} | null;
