export declare const sessionNoProg: (active: any) => boolean;
/**
 * Keeps the whole session out of progression, or puts it back. Off counts every entry again
 * except the ones a deload or rehab routine keeps out (`routineOwns(entry)`): that is the
 * routine's setting, which its entries show with no switch of their own, the same rule as the
 * exercise menu. Mutates `active`, for use inside a store update.
 */
export declare function setSessionNoProg(active: any, on: any, routineOwns?: () => boolean): void;
/**
 * One exercise kept out or counted again from its own menu or its marker's Undo. Counting one
 * again means the session is no longer out as a whole, so the header stops saying it is and an
 * exercise added later counts too.
 */
export declare function setEntryNoProg(active: any, index: any, on: any): void;
/** An entry joining the session (added, or brought in with a routine): out too while the whole session is. */
export declare const joinSessionNoProg: (active: any, entry: any) => any;
