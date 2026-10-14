import type { ExerciseIndex } from './exercises';
/**
 * @returns {{ entries: object[], skipped: number }} the new session's entries (every row
 *   unchecked), and how many exercises were left out because they no longer exist (a deleted
 *   custom exercise).
 */
export declare function repeatSessionEntries(st: any, w: any, { exists }?: {
    exists?: ((id: any) => boolean) | undefined;
}, index?: ExerciseIndex): {
    entries: object[];
    skipped: number;
};
