export declare const DEFAULT_ACCENT = "lime";
export declare const CUSTOM = "custom";
/** '#rrggbb' in lowercase, or null for anything else ('#abc', 'red', 'url(…)', a number). */
export declare function cleanHex(v: any): string | null;
/**
 * A copy's accent fields made safe, in place: a malformed `accentCustom` is dropped and an
 * `accent` that is not even a word goes back to the default. Returns the copy.
 */
export declare function sanitizeAccent(s: any): any;
/** The choice to draw: a known preset key, 'custom' with a usable colour, or the default. */
export declare function accentKey(S: any): string;
export declare function accentValue(S: any): string | null;
export declare function luminance(hex: any): number;
/** WCAG contrast ratio of two '#rrggbb' colours, 1 to 21. */
export declare function contrast(a: any, b: any): number;
/** `hex` moved `t` (0–1) of the way to `to`. */
export declare function mix(hex: any, to: any, t: any): string;
/** Black or white, whichever reads better on `hex` (black on a tie). */
export declare function inkOn(hex: any): "#000000" | "#ffffff";
export declare const THEMES: {
    dark: {
        bgs: string[];
        min: number;
        toward: string;
        label2: string[];
    };
    light: {
        bgs: string[];
        min: number;
        toward: string;
        label2: string[];
    };
};
export declare const GREY_SAT = 0.25;
export declare const GREY_TEXT = 4.5;
export declare const GREY_GAP = 2;
/** Whether `hex` is a grey for readableIn (see GREY_SAT). */
export declare const isGrey: (hex: any) => boolean;
/**
 * `hex` as drawn in `theme`: unchanged when it already stands out enough, otherwise made lighter
 * (dark theme) or darker (light theme) in small steps of HSL lightness until it does, hue and
 * saturation kept. A grey has to clear the stricter grey bar (THEMES above).
 */
export declare function readableIn(hex: any, theme: any): any;
/** Whether `hex` is drawn differently from itself in `theme` (Settings says so). */
export declare const adjustedIn: (hex: any, theme: any) => boolean;
/**
 * The text colour for a button that is `acc` at rest and `acc2` while pressed: the one that reads
 * better on `acc` (inkOn), unless it drops under 3:1 (large text) on the pressed shade and the
 * other one holds up better across both. Over the whole sRGB cube that keeps at least 3:1 pressed
 * and about 4.35:1 at rest (accent.test.js).
 */
export declare function inkOnBoth(acc: any, acc2: any): "#000000" | "#ffffff";
/**
 * The CSS custom properties for the user's colour in `theme`, the same set a preset defines in
 * index.css: the accent, its pressed shade, the text on it, and the switch knob's ring. The soft
 * and line tints are mixed from --acc in index.css and follow on their own. null for anything
 * but a valid hex.
 */
export declare function customAccentVars(hex: any, theme: any): {
    '--acc': any;
    '--acc-2': string;
    '--on-acc': string;
    '--knob-ring': string;
} | null;
/** The colour and its text colour for a preset key or a '#rrggbb' value (accent and contrasting text colour). */
export declare function accentPair(v: any): {
    accent: any;
    ink: any;
};
/**
 * Puts the accent on the page root: a preset by `data-accent` (index.css does the rest), the
 * user's colour as inline custom properties for the resolved `theme`. `value` is accentValue's.
 */
export declare function applyAccent(el: any, value: any, theme: any): void;
