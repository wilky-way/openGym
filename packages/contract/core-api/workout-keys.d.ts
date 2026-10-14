/**
 * What a key press means on the workout screen: 'tick', 'prev', 'next', or null when it is not
 * one of these keys, or not the workout's to take.
 *
 * `tabbed` says whether focus reached its element with Tab. Someone who tabbed to a button and
 * presses Space or Enter means that button. A click, though, also leaves focus on the button it
 * pressed (Chrome, Firefox), and a USB button that sends Space must not press "Next" again just
 * because the mouse was the last thing to use it — so without Tab, Space and Enter tick.
 * Modifier combinations are left alone: they are the browser's and the system's shortcuts.
 *
 * `rtl` mirrors the arrows: in a right-to-left language the exercises run from right to left like
 * the text, and the next card comes in from the left (components/SwipeCards.jsx), so ← is next.
 */
export declare function workoutKeyAction(event: any, { tabbed, rtl }?: {
    rtl?: boolean | undefined;
    tabbed?: boolean | undefined;
}): "next" | "prev" | "tick" | null;
/**
 * The set a 'tick' is for: `{ idx, i, side?, current }` (entry index, set index, 'L' or 'R' for
 * a unilateral row, and whether it belongs to the exercise marked current), or null when
 * nothing is left to tick.
 *
 * The exercise marked current comes first. In a superset that is the member whose turn it is,
 * followed by the rest of its group. After that comes the next exercise with work left, the
 * same one the superset and finish flow would reach (nextUnfinishedUnit, which wraps round to
 * one skipped earlier). A unilateral set is ticked a side at a time, left first.
 */
export declare function nextOpenSet(entries: any, cur: any): {
    idx: any;
    i: any;
    side: string;
    current: any;
} | {
    side?: undefined;
    idx: any;
    i: any;
    current: any;
} | null;
