import type { ExerciseIndex } from './exercises';
/** Whether a plan asks for back-off sets. Off unless switched on, so every plan saved before
 *  this field existed builds exactly as it did. A pyramid owns each set already, and a
 *  rest-pause trains one work set, so neither has anything to step down. */
export declare function isBackoff(cfg: any): boolean;
/**
 * The weight of work set `k` (0 = the top set) below a top set of `top`. The same grid rule a
 * stepper tap uses: a top set on the step's grid lands every back-off set on it, one typed off
 * the grid steps down from where it is. Never below one step — an empty bar is not a set — and
 * never above the top set itself.
 */
export declare function backoffAt(top: number, k: number, step: number): number;
/** The step back-off sets use: the exercise's own (cfg.inc), else its default — the same
 *  number progression.js's weightIncrement gives, and 0 where back-off sets do not apply. An
 *  assistance machine is left out: less load is harder there, so "lighter" is the wrong way. */
export declare function backoffStepOf(cfg: any, unit: any, index?: ExerciseIndex): any;
/** The planned weights for `n` work sets: "26 → 24 → 22". */
export declare function backoffWeights(top: number, n: number, step: number): number[];
/**
 * Step the open work rows of a freshly built entry down from its first work row. Warm-ups are
 * left alone (they ramp toward the top set), a logged row is never rewritten, and a per-side
 * row steps both limbs.
 */
export declare function applyBackoff(rows: any, step: any): any;
