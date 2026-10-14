import type { ExerciseIndex } from './exercises';
/** Offline preparation only. Repairing stored definitions with no source file is opt-in (options.repair). Never changes active/paused definitions, snapshots, routines or logs. */
export declare function refreshProgrammeDefinitions(state: any, files?: any[], options?: {}, index?: ExerciseIndex): {
    state: any;
    report: {
        added: any[];
        updated: any[];
        protected: any[];
        skipped: any[];
        needsReview: { id: any; reason?: any; unknown?: any; unprescribed?: any }[];
        conformance: { id: any; protected: boolean; before: any; after: any; issues: any }[];
        repairs: { id: any; changes: any }[];
    };
};
