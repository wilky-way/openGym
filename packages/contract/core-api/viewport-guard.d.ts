export declare function viewportDisplacement(win?: Window & typeof globalThis): number;
export declare function keyboardOpen(win?: Window & typeof globalThis): boolean;
/** Realign the viewports if iOS left them apart. Returns true when a correction was issued. */
export declare function realign(win?: Window & typeof globalThis): boolean;
/** The same correction while Modals.jsx has the body pinned (`position:fixed; top:-y`): the
 *  document has no scroll range then, so asking for the current position is a no-op and iOS
 *  keeps the offset — the picker sheet left open after the keyboard closed. Let the page scroll
 *  for one call, land it where the pin says it was, and pin it again. */
export declare function realignPinned(win?: Window & typeof globalThis): boolean;
export declare function installViewportGuard(win?: Window & typeof globalThis): () => void;
