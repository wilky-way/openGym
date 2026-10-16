import type { NativePrescription, NativeSetTarget, NativeRowIdentity } from '../domain/native-prescription';
import type { WorkoutSet, ProgrammeDefinition } from '../domain/state-doc';
export declare function validateNativePrescription(value: unknown): asserts value is NativePrescription;
export declare function sameNativeSource(a: Record<string, unknown>, b: Record<string, unknown>): boolean;
export declare function nativeRowIdentity(p: NativePrescription, rowOrdinal: number): NativeRowIdentity;
export declare function sameNativeRow(a: NativeRowIdentity | undefined, b: NativeRowIdentity | undefined): boolean;
export declare function nativeTargetLabel(target: NativeSetTarget): string;
/** Missing ratings stay unknown; actual values outside the goal are still valid logs. */
export declare function assessNativeSet(row: WorkoutSet, target: NativeSetTarget): {
    reps: 'unknown' | 'within' | 'below' | 'above';
    effort: 'unknown' | 'within' | 'below' | 'above';
};
export declare function canCompleteNativeSet(row: WorkoutSet): boolean;
/** Display the authored variant without exposing its storage key in max editors. */
export declare function nativeMaxLabel(definition: ProgrammeDefinition, key: string): string;
