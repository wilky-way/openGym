import type { ExerciseIndex } from './exercises';
/** Equipment you hold one of in each hand. */
export declare const BELL_EQ: Set<string>;
/** Whether the meaning of the weight is worth asking about for this exercise (object or id). */
export declare const isBellEx: (exOrId: any, index?: ExerciseIndex) => boolean;
/** A stored meaning ('as' | 'each' | 'total'), or null when there is none. S.dbLoad holds `{ mode, _ts }`. */
export declare function dbLoadOf(value: any): any;
/**
 * What a weight means for this exercise right now: the routine's own choice (cfg.dbLoad), else
 * the exercise's default (S.dbLoad), else 'as' (as entered, today's behaviour).
 */
export declare function dbLoadFor(S: any, cfgOrId: any, index?: ExerciseIndex): any;
/**
 * S.dbLoad with the exercise's default set to `mode`. Going back to "as entered" is a stamped
 * null rather than a deleted key, so it wins a sync against the other device's older choice.
 */
export declare const withDbLoad: (map: any, exId: any, mode: any, now?: number) => any;
/** Whether this exercise uses a single bell: logged per side, or named one-arm. */
export declare const isOneArm: (cfg: any, index?: ExerciseIndex) => boolean;
/** How many bells are lifted at once: 1 for one-arm work, else 2. */
export declare const bellsIn: (cfg: any, index?: ExerciseIndex) => 1 | 2;
/**
 * A freestyle entry's target with the meaning it is logged in stamped on it, as buildPlannedEntry
 * stamps a planned one: `cfg` as it is when the exercise is "as entered".
 */
export declare function withMeaning(S: any, cfg: any, id?: any, index?: ExerciseIndex): any;
/** The meaning a logged entry was saved with: its target's stamp, 'as' when it has none. */
export declare const entryDbLoad: (entry: any) => any;
/** What one logged kilo of this entry is worth in volume: 2 for "each" on two bells, else 1. */
export declare const volumeFactor: (entry: any, index?: ExerciseIndex) => 1 | 2;
/**
 * The factor that turns a weight meant as `from` into the same load meant as `to`. Only the two
 * explicit meanings convert; "as entered" is taken at face value both ways, and a one-arm
 * exercise has one bell, so each and total are the same number there.
 */
export declare function meaningFactor(from: any, to: any, cfg: any, index?: ExerciseIndex): number;
/**
 * The entry with its weights read as `to`: a scaled copy when the meanings differ (see
 * meaningFactor), the entry itself otherwise. For comparing, never for storing.
 */
export declare function entryAs(entry: any, to: any, index?: ExerciseIndex): any;
/** A workout with every entry of `exId` read as `to` (entryAs); the workout itself when nothing changes. */
export declare function workoutAs(w: any, exId: any, to: any, index?: ExerciseIndex): any;
/**
 * The state with one exercise's history read as `to`, for the readers that compare it: records,
 * the 1RM, the progression that builds today's rows. The state itself when nothing converts,
 * which is always the case for an exercise that never chose a meaning.
 */
export declare function historyAs(S: any, exId: any, to: any, index?: ExerciseIndex): any;
/**
 * The meaning an exercise's history is read in when no session is asking: the exercise's own
 * default, else the meaning it was last logged with, else 'as'.
 */
export declare function currentDbLoad(S: any, exId: any): any;
/** The quick lists the inventory editor offers, per unit: 2–50 kg in 2s, 5–100 lb in 5s. */
export declare const DB_PRESETS: {
    kg: {
        from: number;
        to: number;
        step: number;
    };
    lb: {
        from: number;
        to: number;
        step: number;
    };
};
export declare const presetWeights: (unit: any) => number[];
/** Sorted, de-duplicated, positive weights out of anything list-shaped. */
export declare const cleanWeights: (list: any) => number[];
/** The dumbbells this profile owns for its unit, lightest first; [] when it has not said. */
export declare const dumbbellsOf: (S: any) => number[];
/** Whether this profile has listed its dumbbells for its unit. */
export declare const ownsDumbbells: (S: any) => boolean;
/**
 * S.dumbbells with the profile's unit set to `weights`, stamped. An empty list is "no inventory"
 * again, kept as a stamped entry (like the standard plate set) so it wins a sync too. Kept per
 * unit and never converted: a 20 lb bell is not a 9.07 kg one.
 */
export declare const withDumbbells: (S: any, weights: any, now?: number) => any;
/**
 * The loads this exercise can be done at with the bells you own, lightest first, in the unit and
 * meaning the sets are logged in; null when the inventory does not apply and the increment's grid
 * stays in charge. Only dumbbell exercises with a load of their own: an added-weight (bodyweight)
 * entry or a kettlebell keeps its grid. An exercise logged as both bells together on two bells
 * moves in pairs (2 × each weight); every other meaning moves one bell at a time.
 */
export declare function ownedWeightsFor(S: any, cfg: any, index?: ExerciseIndex): number[] | null;
/** The `n`-th owned weight above `w` (the nearest one for an off-list weight); null past the heaviest. */
export declare function ownedUp(ws: any, w: any, n?: number): any;
/** The nearest owned weight below `w`; null under the lightest. */
export declare function ownedDown(ws: any, w: any): any;
/** The heaviest owned weight at or under `x`, else the lightest you have. */
export declare function ownedFloor(ws: any, x: any): any;
/** One tap of a stepper over owned weights: the neighbour in that direction, or where it is at either end. */
export declare function stepOwned(ws: any, v: any, dir: any): any;
/**
 * A deload over owned weights: the owned weight nearest `w × factor` that is lighter than `w`,
 * the heavier of two equally near. With nothing lighter it holds `w`.
 */
export declare function ownedDeload(ws: any, w: any, factor: any): any;
/**
 * The owned weights either side of an ideal load, for the Epley deload (progression.js
 * selectDeloadCandidate): the nearest at or under it and the nearest at or over it, never above
 * `max` (or at it, when `strict`).
 */
export declare function ownedAround(ideal: any, ws: any, max: any, strict: any): any[];
