export declare const EDGE = 24;
export declare const SLOP = 8;
export declare const RATIO = 1.5;
export declare const REVEAL = 76;
export declare const OPEN_MIN = 40;
export declare const DELETE_AT = 0.6;
export declare const DELETE_FLING_AT = 0.4;
export declare const COPY_AT = 0.4;
export declare const COPY_FLING_AT = 0.25;
export declare const FLING = 0.5;
export declare const RESIST = 0.35;
/** How far a row with no end-side action gives toward the end before it stops. */
export declare const BAND = 14;
/** +1 in a left-to-right page, -1 in a right-to-left one: logical offset × this = pixels. */
export declare const lineDir: () => -1 | 1;
/** Whether a touch at clientX starts in the screen's edge zone (back gestures live there). */
export declare const inEdgeZone: (x: any, width: any) => boolean;
/** The axis a move has settled on: null while under the slop, 'x' once clearly sideways, else 'y'. */
export declare function axisOf(dx: any, dy: any): "x" | "y" | null;
/** Where the row sits for a raw logical drag `raw` on a row `w` wide: with the finger up to the
 *  commit point, then at a third of the pace beyond it, never past the row's own width. */
export declare function shapeOffset(raw: any, w: any, canCopy?: boolean): number;
/** Whether an offset is past the commit point, i.e. letting go now acts. */
export declare function armedFor(o: any, w: any, canCopy?: boolean): "copy" | "delete" | null;
/** What letting go does, for a row resting at logical offset `o` on a row `w` wide, released at
 *  logical velocity `v` (px/ms): 'delete' | 'copy' act; 'open-delete' | 'open-copy' leave the row
 *  open on its button; 'close' snaps it shut. A flick back the other way always closes. A row
 *  with no end-side action (`canCopy` false) only ever closes from that side. */
export declare function commitFor(o: any, w: any, v?: number, canCopy?: boolean): "close" | "copy" | "delete" | "open-copy" | "open-delete";
/** Logical velocity over the last 100 ms of [time, offset] samples. */
export declare function velocityOf(samples: any): number;
export declare const reducedMotion: () => boolean;
/** Closes whichever row is resting open, if any. */
export declare function closeOpenRow(instant?: boolean): void;
/**
 * The gesture for one row. `onCommit('delete' | 'copy')` acts; `canDelete` false greys the delete
 * side and turns a delete into a rubber band and `onBlocked()`. `closeKey` closes the row whenever
 * it changes (the entry's rows were added or removed, a tick, a timer start: the row under the
 * finger may no longer be the set it was). `onStart` runs when a swipe locks (the hint chip goes).
 * `canCopy` false is a delete-only row. `canSwipe()`, when given, is asked as a touch starts and
 * again before it locks: false leaves the touch to someone else (the routine editor's long-press
 * reorder, once it has picked a row up).
 */
export declare function useSwipeRow({ canDelete, canCopy, canSwipe, onCommit, onBlocked, onStart, closeKey }: {
    canCopy?: boolean | undefined;
    canDelete?: boolean | undefined;
    canSwipe: any;
    closeKey: any;
    onBlocked: any;
    onCommit: any;
    onStart: any;
}): {
    outerRef: any;
    frontRef: any;
    delRef: any;
    cpRef: any;
    openSide: any;
    peek: any;
    pressDelete: () => void;
    pressCopy: () => void;
    handlers: {
        onPointerDown: (e: any) => void;
        onPointerMove: (e: any) => void;
        onPointerUp: (e: any) => void;
        onPointerCancel: (e: any) => void;
    };
};
