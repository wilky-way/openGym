/** The quick picks, in the order the sheet shows them. Labels are English source strings. */
export declare const DAY_NOTE_TAGS: string[];
export declare const DAY_NOTE_LABEL: {
    sick: string;
    travel: string;
    rest: string;
    injured: string;
};
export declare const DAY_NOTE_ICON: {
    sick: string;
    travel: string;
    rest: string;
    injured: string;
};
/** A stored entry read back: { tag, text } with the junk left out, or null for none or a cleared one. */
export declare function readDayNote(entry: any): {
    tag: any;
    text: any;
} | null;
/** The note on `iso`, or null. */
export declare const dayNoteOf: (S: any, iso: any) => {
    tag: any;
    text: any;
} | null;
/** Whether `iso` is excused: it carries a note. The nudge and the reminder skip such a day. */
export declare const excusedOn: (S: any, iso: any) => boolean;
/** Whether `iso` can take a note at all: a real date, today or earlier. */
export declare const canNoteDay: (iso: any, today?: string) => boolean;
/**
 * S.dayNotes with `iso` set to `note` ({ tag, text }), stamped `now`. An empty note (no tag, no
 * text) is written as a cleared entry, so the removal syncs (see the top of this file).
 */
export declare function withDayNote(map: any, iso: any, note: any, now?: number): any;
/** The label a note reads as in a list or a tooltip: its quick pick, its text, or both. */
export declare function dayNoteLine(note: any, tr?: (s: any) => any): any;
