import type { ExerciseIndex } from './exercises';
/** Fill only facts derivable from explicit prescriptions or supplied decisions.
 * No default effort, guessed goal/licence, load prediction or script execution.
 */
export declare function improveProgrammeDefinition(def: any, { catalogue, decisions, sourceRaw }?: {
    catalogue?: any[] | undefined;
    decisions?: {} | undefined;
    sourceRaw?: null | undefined;
}, index?: ExerciseIndex): {
    definition: any;
    changes: string[];
};
