export declare const todayISO: () => string;
export declare const isoOf: (d: any) => string;
export declare const DAYN: string[];
export declare const DAYS: string[];
export declare const MONTHS: string[];
export declare const MONTHS_LONG: string[];
export declare function fmtDate(iso: any, long: any, withYear?: boolean): string;
export declare function fmtDateRange(from: any, to: any, long: any, now?: Date): string;
export declare function fmtDur(ms: any): any;
export declare const durPart: (ms: any) => any[];
export declare const capWords: (s: any) => string;
export declare const exerciseNameText: (ex: any) => any;
export declare const setWeightDecimals: (n: any) => void;
export declare const weightDecimals: () => number;
export declare const fmtNum: (n: any) => string;
export declare const fmtPlate: (n: any) => string;
export declare const fmtVol: (v: any, unit: any) => string;
export declare const exCount: (n: any) => any;
export declare const routineCount: (n: any) => any;
export declare const changeCount: (n: any) => any;
export declare const setsWorkCount: (n: any, work: any) => any;
export declare function fmtAgo(ts: any, now?: number): string;
export declare function fmtDaysAgo(iso: any, dayIso?: string): string;
export declare const MONDAY = 1;
export declare const SUNDAY = 0;
/** The profile's first weekday, defaulting to Monday for every state written before this. */
export declare const weekStartOf: (S: any) => 0 | 1;
/** getDay() indices in display order — [1..6,0] for a Monday start, [0..6] for a Sunday one. */
export declare const weekOrder: (ws?: number) => number[];
/** How many days a weekday sits past the start of its week. 0..6, so it doubles as a column. */
export declare const weekDayOffset: (day: any, ws?: number) => number;
/** The Date (noon local, so DST cannot shift the day) that starts the week `iso` falls in. */
export declare function startOfWeek(iso: any, ws?: number): Date;
/**
 * A key that is equal for two dates in the same week: the ISO date of the week's first day.
 *
 * Only ever compared or used as a map key — never shown, never stored — so it does not need
 * to be an ISO week number, and being one would be a liability here: "2026-35" is defined
 * Monday-first, and there is no Sunday-first equivalent to fall back to.
 */
export declare const weekKey: (iso: any, ws?: number) => string;
export declare const localTZ: () => string;
export declare const uid: () => string;
export declare const ACCENT_NAMES: {
    lime: string;
    sky: string;
    orange: string;
    violet: string;
    pink: string;
    red: string;
    teal: string;
    gold: string;
};
export declare const ACCENTS: {
    lime: string;
    sky: string;
    orange: string;
    violet: string;
    pink: string;
    red: string;
    teal: string;
    gold: string;
};
export declare const ACCENT_INK: {
    lime: string;
    sky: string;
    orange: string;
    violet: string;
    pink: string;
    red: string;
    teal: string;
    gold: string;
};
export declare const argb: (hex: any) => number;
