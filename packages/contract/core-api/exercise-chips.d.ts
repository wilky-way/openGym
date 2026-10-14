/** How far one exercise is: 'done' once every work set is ticked (a warm-up you skipped does not
 *  hold the chip back), 'partial' once anything is ticked, else 'todo'. An exercise with no rows
 *  yet has nothing done. */
export declare function entryProgress(entry: any): "done" | "partial" | "todo";
/** One chip per unit: { key, unit, n, state, current }. A superset is done when all of its
 *  members are, and started when any of them is. `cur` is the session's marker (s.active.cur). */
export declare function exerciseChips(entries: any, cur: any): {
    key: any;
    unit: any;
    n: number;
    state: string;
    current: any;
}[];
