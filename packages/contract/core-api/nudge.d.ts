export declare const NUDGE_TONES: string[];
export declare const NUDGE_MAX_MISSES = 3;
export declare const NUDGE_LOOKBACK_DAYS = 14;
export declare const NUDGE_COPY: {
    friendly: {
        title: string;
        lines: string[];
    };
    guilt: {
        title: string;
        lines: string[];
    };
    drill: {
        title: string;
        lines: string[];
    };
};
export declare const toneOf: (r: any) => any;
/** Minutes after midnight the nudge is owed from, or null when that would be after 21:30. */
export declare function nudgeMinute(reminderTime: any): number | null;
export declare const NUDGE_LATEST_MINUTE: number;
/**
 * The routine ids to nudge about on `iso`, or null: not a missed day, or already 3 missed days in
 * a row since the last workout (back-off). Workouts dated after `iso` are not looked at, so the
 * phone can ask about future dates and get the back-off of a break that simply goes on.
 */
export declare function nudgeFor(state: any, iso: any): any[] | null;
/** The day's line index: by date, so a day keeps its line and consecutive days rotate. */
export declare const lineIndex: (iso: any, n: any) => number;
