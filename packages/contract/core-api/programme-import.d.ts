import type { ExerciseIndex } from './exercises';
export declare function ruleInstructions(e: any, kind?: string): string;
export declare const hasPrivateProgrammes: (S: any) => boolean;
export declare const importExerciseKey: (e: any) => string;
export declare function validateProgrammeDefinition(d: any, catalogue?: any[], index?: ExerciseIndex): any;
/** Preview is pure. Explicit mappings beat unique exact catalogue names; ambiguities stay unresolved. */
export declare function importProgramme(input: any, { filename, mappings, prescriptions, customEx, strictPrescriptions }?: {
    customEx?: never[] | undefined;
    filename?: string | undefined;
    mappings?: {} | undefined;
    prescriptions?: {} | undefined;
    strictPrescriptions?: boolean | undefined;
}, index?: ExerciseIndex): {
    definition: any;
    unknown: never[];
    unprescribed: never[];
    warnings: never[];
    skipped: boolean;
} | {
    definition: {
        id: any;
        name: any;
        unit: any;
        weeks: any;
        source: any;
        rulesSupported: boolean;
        needsReview: any[];
        instructions?: string | undefined;
        end: any;
        repeat?: any;
        importWarnings: any[];
    };
    unknown: any[];
    unprescribed: any[];
    warnings: any[];
    skipped: boolean;
};
/** Confirm saves a definition only. Activate/adopt remains a separate UI step. */
export declare function saveImportedProgramme(S: any, preview: any, { replace }?: {
    replace?: boolean | undefined;
}, index?: ExerciseIndex): any;
