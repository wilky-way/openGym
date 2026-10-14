import type { ExerciseIndex } from './exercises';
/** The plate sizes the inventory editor lists, heaviest first, per unit. */
export declare const PLATE_SIZES: {
    kg: number[];
    lb: number[];
};
/** Pairs of each size the default inventory holds — plenty, the way a rack is. */
export declare const DEFAULT_PAIRS = 6;
/** Whether this profile counts its own plates for its unit, rather than loading the standard set. */
export declare const ownsPlates: (S: any) => boolean;
/**
 * The plates this profile can load, heaviest first: [{ w, n }] with n pairs of each size (a
 * single stack loads both plates of a pair, see rowLoad). S.plates[unit] is { [size]: count, _ts }; absent or without any
 * size → the default set.
 */
export declare function inventoryFor(S: any): {
    w: number;
    n: number;
}[];
/**
 * S.plates with `n` pairs of size `w` for the profile's unit, stamped. The first change copies
 * the standard set in, so the list the inventory sheet shows is always the one the rows load from.
 */
export declare function withPlatePairs(S: any, w: any, n: any, now?: number): any;
/** S.plates with the profile's unit back on the standard set: a stamped list with no sizes. */
export declare const withStandardPlates: (S: any, now?: number) => any;
/**
 * An exercise's own loading as S.loadKind stores it: 'pairs' | 'single' | 'none', or null when
 * the equipment decides. A bare string is how the first builds of plate loading stored it, and
 * still reads as that kind.
 */
export declare function loadKindOf(value: any): any;
/** S.loadKind with the exercise's loading set to `kind`, or back on its equipment's for null. */
export declare const withLoadKind: (map: any, exId: any, kind: any, now?: number) => any;
/** The count of one size in this profile's inventory (0 when it has none). */
export declare const pairsOf: (S: any, w: any) => number;
/**
 * Plates for `weight`, from `inv` ([{ w, n }], heaviest first). Heaviest-first greedy when that
 * lands exactly — the way a bar is loaded in practice. When greedy misses (a home gym with one
 * pair of each size, an odd inventory) the fewest plates that hit the weight exactly, biased to
 * heavier plates on ties. When nothing hits it, the closest load BELOW and what is missing.
 *   → { plates: [w, …] heaviest first, missing: number }   (missing 0 = exact)
 */
export declare function plateStack(weight: any, inv: any): {
    plates: any[];
    missing: number;
};
/**
 * Going from one stack to the next: what comes off and what goes on (multiset difference),
 * each heaviest first. { strip: [w…], add: [w…] } — both empty when nothing changes.
 */
export declare function plateDelta(prev: any, next: any): {
    strip: any[];
    add: any[];
};
/**
 * How an exercise's weight is loaded: 'pairs' (a bar or a two-post machine — plates split per
 * side beyond the bar), 'single' (one stack: dip belt, landmine, plate-loaded machine, sled — all
 * of it beyond the base weight), 'none' (dumbbells, kettlebells, cables, pin machines, bands).
 * The user's own choice in S.loadKind (loadKindOf) wins; otherwise bar equipment → pairs,
 * body-weight and "weighted" exercises and sleds → single (the added load is what you hang on),
 * the rest → none.
 * A band's "weight" is its tension, not plates, so bands are none even though isBw counts them.
 */
export declare function loadKindFor(S: any, cfgOrId: any, index?: ExerciseIndex): any;
/**
 * The weight that is there before any plate goes on, in the profile unit: the bar for bar
 * exercises (S.barWeights override, 0 = "no bar", else the type's default), the explicit
 * override for anything else (a sled's own weight), 0 otherwise.
 */
export declare function baseWeightFor(S: any, exOrId: any, index?: ExerciseIndex): any;
/**
 * The load line for one set row: null when there is nothing to load (kind none, no weight);
 * { barOnly: true } when the weight is at or below the base; otherwise the stack for the
 * per-side (pairs) or total (single) load plus what is missing from the inventory.
 *   → { kind, perSide, plates, missing, barOnly }
 */
export declare function rowLoad(kind: any, weight: any, base: any, inv: any): {
    kind: any;
    barOnly: boolean;
    perSide: number;
    plates: any[];
    missing: number;
} | null;
/** Two rows load the same when their stacks match, both are (or are not) bar-only, and the same amount is missing. */
export declare const sameLoad: (a: any, b: any) => any;
/**
 * Where a drop-set's next weight may land (lib/workout-model.js nextDropWeight): on the dumbbells
 * this profile owns for a dumbbell lift, on the plates
 * this profile owns when it has counted them and the exercise is plate-loaded — the heaviest load
 * at or below the drop that those plates make — else on the exercise's own weight step. A drop
 * rounded to .5 read 48.5 kg on a bar that loads in 2.5s (QA 1.3.9).
 */
export declare function dropGrid(S: any, cfg: any, index?: ExerciseIndex): any;
