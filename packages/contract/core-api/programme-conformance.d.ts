import type { ExerciseIndex } from './exercises';
export declare function programmeConformance(def: any, { catalogue }?: {
    catalogue?: any[] | undefined;
}, index?: ExerciseIndex): {
    level: string;
    issues: any[];
};
