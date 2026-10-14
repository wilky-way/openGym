export declare const PER_SET_MAX = 5;
/** Each session with plottable sets: [{ t, d, sets: [{ n, y, w, r }] }], in workout order.
 *  `metric`: 'weight' (default), 'reps', or 'e1rm' — the estimated 1RM of the set itself, which
 *  is what tells straight sets apart: at one weight their lines would lie on top of each other,
 *  and the rep that went missing in the last set is the thing to see. A set past the estimate's
 *  rep cap has no point, as on the Est. 1RM curve. A per-side set is estimated from one side's
 *  reps, not both added up. */
export declare function perSetSessions(workouts: any, exId: any, { metric, formula }?: {
    metric?: string | undefined;
    formula?: unknown;
}): {
    t: any;
    d: any;
    sets: {
        n: number;
        y: any;
        w: number;
        r: any;
    }[];
}[];
/** One line per set number for the chart, at most PER_SET_MAX of them: { lines, hidden }, where
 *  `hidden` counts the set numbers left out, so the card can say so instead of dropping them quietly. */
export declare function perSetLines(sessions: any): {
    lines: {
        n: any;
        points: any;
    }[];
    hidden: number;
};
/** The set that most often is the first to fall below set 1, as { n, count, of } — `of` being
 *  the sessions with a set 1 and at least one more. Null with fewer than three such sessions (too
 *  few to call it a pattern) or when no session dropped. Ties go to the earlier set. */
export declare function dropOffSet(sessions: any): {
    n: any;
    count: any;
    of: any;
} | null;
