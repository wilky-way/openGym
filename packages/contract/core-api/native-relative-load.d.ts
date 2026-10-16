import type { NativeLoadEvaluation, NativePrescription } from '../domain/native-prescription';
import type { Entry, Row, State } from './session-types';
import { type ExerciseIndex } from './exercises';
export type NativeRelativeResult = {
    status: 'pending';
    reason: string;
} | {
    status: 'resolved';
    evaluation: NativeLoadEvaluation;
};
export declare const hasNativeRelativeLoad: (p: NativePrescription) => boolean;
/** The guarded producer supplies a fresh ID; copying never copies authored authority. */
export declare function nativeExtraRow(source: Row, id: string): Row;
/** Pure read: the only search is within this exact entry's row instances. */
export declare function evaluateNativeRelativeLoad(S: State, entry: Entry, row: Row, index?: ExerciseIndex): NativeRelativeResult;
/** Completion/undo only: caller owns the guarded synchronous draft and exact row target. */
export declare function prepareNativeCompletion(S: State, entry: Entry, row: Row, complete: boolean, index?: ExerciseIndex): void;
/** Finish never derives a target again: a completed dependency must carry its own receipt. */
export declare function validNativeEvaluation(row: Row): boolean;
/** Structural edits may remove rows, but cannot duplicate/rebind authored row instances. */
export declare function validateNativeRelativeRows(entry: Entry, index?: ExerciseIndex): void;
