import type { ExerciseIndex } from './exercises';
/** Equipment values (e.eq) that put a bar in your hands. */
export declare const BAR_EQ: Set<string>;
/** Typical bar weights per equipment type, for a kg profile. */
export declare const DEFAULT_BAR_KG: Record<string, number>;
/** The same bars as a lb profile knows them — real markings, not converted kg. */
export declare const DEFAULT_BAR_LB: Record<string, number>;
/** Whether this exercise (object or id) is done with a bar. */
export declare const usesBar: (exOrId: any, index?: ExerciseIndex) => boolean;
/** The default bar weight for an equipment type, in the given unit. null off the list. */
export declare const defaultBarWeight: (eq: string, unit: "kg" | "lb") => number | null;
/**
 * A stored 0 is "no bar", not "unset" (issue #138). Smith machines that counterbalance their
 * carriage put nothing in your hands, so the plate math and the drop-set steps have to start
 * from the weight you logged, not from a 9 kg bar that is not there. The key being absent is
 * what means "use the default for this bar type" — which is why the editor clears the key
 * rather than writing a 0 when you ask for the default back.
 */
export declare const isNoBar: (S: any, exId: any) => boolean;
/** True when the user has set their own bar weight for this exercise — including "no bar". */
export declare const hasBarOverride: (S: any, exId: any) => boolean;
/**
 * Effective bar weight for one exercise, in the profile unit: the explicit
 * S.barWeights[exId] if set — an explicit 0 is "no bar" (a Smith machine whose carriage is
 * counterbalanced, issue #138) and stays 0 — else the default for the bar type. null for
 * anything that is not a bar exercise.
 */
export declare function barWeightFor(S: any, exOrId: any, index?: ExerciseIndex): any;
/**
 * Plates per side: (total − bar) / 2, rounded to 2 decimals. null when there is nothing
 * sensible to show — a missing number, or a total at or below the bar itself. A bar of 0
 * ("no bar") splits the whole total.
 */
export declare function plateSplit(total: number | null | undefined, bar: number | null | undefined): number | null;
