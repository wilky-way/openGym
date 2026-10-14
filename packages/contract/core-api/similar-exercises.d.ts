/** The target muscle a swap away from `ex` should start on, or '' when it has none. */
export declare const swapMuscleOf: (ex: any) => any;
/**
 * The exercises in `list` sharing `ex`'s target muscle, `ex` itself left out, those on its
 * equipment first. Otherwise the list's own order is kept (Array#sort is stable), so favourites
 * floated to the top earlier stay on top within each half.
 */
export declare function sameMuscleFirst(list: any, ex: any): any;
