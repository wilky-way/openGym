export declare const favIds: (S: any) => any;
export declare const isFav: (S: any, id: any) => any;
/** Flip one exercise in a state draft. Returns true when it is a favourite afterwards. */
export declare function toggleFav(s: any, id: any): boolean;
/**
 * Favourites first, everything else after — both halves keep the order they came in, so a
 * list that is already sorted by name (or by usage) stays that way within each half.
 */
export declare function sortFavouritesFirst(list: any, S: any): any;
/**
 * A search's results the way a person scans them: favourites, then the exercises they have
 * already logged or planned (`usage`: id -> count, the picker's "Chosen"), then the rest. Each
 * group keeps the search's own order. Someone who imported years of history types "press" and
 * wants their press on top, not the best name match among 5,000.
 */
export declare function sortYoursFirst(list: any, S: any, usage: any): any;
/** How often each exercise sits in a routine or a logged workout: id -> count. */
export declare function usageOf(S: any): {};
