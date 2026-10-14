/** Tolerant read, never a migration: unknown fields and future versions survive. */
export declare function normaliseProgrammes(raw: any): any;
export declare const programmesOf: (S: any) => any;
/** A reset names the records it cleared; future records with other ids remain valid. */
export declare function programmesSinceReset(raw: any, at: any, ids: any): any;
/** Finished logs are authoritative even when a stale skip has a later edit stamp. */
export declare function resolveOccurrences(cycle: any, workouts?: any[]): any[];
export declare function mergeProgrammes(a: any, b: any, workouts: any, mergeEntry: any): any;
/** Terminal cycles and activation conflicts cannot reclaim routines or a running queue. */
export declare function reconcileProgrammeOwnership(S: any): void;
/** Stamps changed fields independently down to each occurrence. Mutates next only. */
export declare function stampProgrammes(prev: any, next: any, now: any, stampEntry: any): void;
export declare function programmeStamp(S: any): number;
