export declare const queueOf: (S: any) => any;
/** The week's sessions already done, in slot order. `[]` without a queue. */
export declare function queueDone(S: any): any;
/** The sessions still to do, in slot order — the first is the next one. `[]` without a queue. */
export declare function queueRemaining(S: any): any;
/**
 * The queue's answer for a date: the next undone session, on exactly one day — today, or
 * `startsOn` while that is still ahead (Home's "next week is waiting"). Every other date gets
 * null, so the calendar and the reminders do not paint the same session onto every day.
 * Dates are compared as ISO strings; `today` is passed in so callers and tests agree on it.
 */
export declare function queueNext(S: any, iso: any, today: any): any;
/**
 * Is `iso` the day the queue speaks for, with sessions still to do? True even when queueNext is
 * null there because every remaining session is pinned to another day: the planner's weekday
 * pointers stay hidden behind the queue on that day (history.js) whatever it answers.
 */
export declare function queueLiveOn(S: any, iso: any, today: any): boolean;
/**
 * What a per-date override pointing at `id` means for the queue: 'open' — a pin on a session
 * still to do (its day's session, skipped elsewhere); 'done' — a fulfilled pin, to be read as no
 * override; null — not a queue session (or no queue), the plain override rules apply.
 */
export declare function pinState(S: any, id: any): "done" | "open" | null;
/**
 * Everything Home's progress row shows, derived once. `items` keep slot order; `state` is
 * 'done', 'next' (the session for the day the queue answers on — pinned there, or the first
 * undone one not pinned to another day — whether or not the queue is active yet), 'pinned'
 * (given another day, carried as `on`; the earliest such day when there are several) or
 * 'later'. `waiting` = the queue is sitting on a future `startsOn`. null without a queue.
 */
export declare function queueView(S: any, today: any): {
    label: any;
    items: any;
    remaining: any;
    complete: boolean;
    startsOn: any;
    waiting: boolean;
    nextDate?: any;
    paused?: boolean | undefined;
} | null;
/**
 * The streak card's fraction, `done / planned`, for the week `today` is in. Without a queue it
 * is the calendar week's finished workouts over the weekdays that hold a plan of routines that
 * still exist (a combined day is one day, one workout). With an active queue the coach week is the
 * unit, and your own training counts beside it: `planned` is the queue's sessions plus the
 * weekdays you plan yourself (a weekday whose routines the queue already covers adds nothing),
 * and `done` is the queue's finished sessions plus this calendar week's workouts on top of them
 * — your own days, freestyle sessions, a redo of a session already done, a queue-routine workout
 * from before the apply. A merged 'US W1 D2 + Core' session counts for both sides: the queue's
 * session through the queue, your Core day as training on top, the two units `planned` added.
 * A queue still ahead of its `startsOn` (queueView's `waiting`) is next week's plan, so until
 * then the card is the calendar-week count alone and the progress row speaks for the coming week.
 */
export declare function weekTally(S: any, today: any): {
    done: any;
    planned: any;
};
