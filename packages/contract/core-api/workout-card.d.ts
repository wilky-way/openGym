import type { ExerciseIndex } from './exercises';
export declare const CARD_WIDTH = 1080;
export declare const MAX_RECORDS = 6;
/**
 * What the card says. `unit` is the profile's, `nameOf(entry)` the exercise's display name — the
 * same pair "Copy as text" takes (workoutText). Sets are work sets, as the volume is: warm-ups are
 * left out of both, the way they are left out of records and progression everywhere else. A
 * per-side set counts once per side, as the workout screen counts it. `levels` is the finish
 * summary's muscle map for this one session (levelsOf over loadOfWorkouts), null when no set
 * reached a muscle the map can show — a card of only cardio has nothing to shade.
 */
export declare function workoutCardModel(w: any, { unit, nameOf }: {
    nameOf: any;
    unit: any;
}, index?: ExerciseIndex): {
    title: any;
    date: string;
    stats: {
        label: any;
        value: any;
    }[];
    records: any[];
    levels: {} | null;
};
export declare function wrapText(text: any, width: any, measure: any, max: any): string[];
/**
 * Where everything goes. `measure(text, weight, size)` returns a width in pixels — the canvas's
 * measureText in the app, a fake in the tests. `rtl` mirrors the card for Arabic: text anchors
 * at the right edge, the tiles run right to left and the trophy sits to the right of its line.
 * `map` is `{ aspect }`, one body view's height over its width, to include the muscle map, or
 * null to leave it out; a model without levels has none either way. Returns the canvas size and
 * a flat list of items for drawWorkoutCard; a text item carries its size and weight, the font
 * family is the drawer's.
 */
export declare function layoutWorkoutCard(model: any, { measure, rtl, width, map }: {
    map?: null | undefined;
    measure: any;
    rtl?: boolean | undefined;
    width?: number | undefined;
}): {
    width: number;
    height: number;
    rtl: boolean;
    items: ({
        weight?: undefined;
        kind: string;
        x: number;
        y: number;
        w: number;
        h: number;
        view?: undefined;
        level?: undefined;
        anchor?: undefined;
        text?: undefined;
        size?: undefined;
        color?: undefined;
    } | {
        weight?: undefined;
        kind: string;
        view: string;
        x: number;
        y: number;
        w: number;
        h: number;
        level?: undefined;
        anchor?: undefined;
        text?: undefined;
        size?: undefined;
        color?: undefined;
    } | {
        weight?: undefined;
        view?: undefined;
        w?: undefined;
        h?: undefined;
        kind: string;
        x: number;
        y: number;
        size: number;
        level: number;
        anchor?: undefined;
        text?: undefined;
        color?: undefined;
    } | {
        view?: undefined;
        w?: undefined;
        h?: undefined;
        level?: undefined;
        kind: string;
        text: any;
        x: number;
        y: number;
        size: number;
        weight: number;
        color: string;
        anchor: string;
    } | {
        weight?: undefined;
        view?: undefined;
        w?: undefined;
        h?: undefined;
        level?: undefined;
        anchor?: undefined;
        kind: string;
        x: number;
        y: number;
        size: number;
        text?: undefined;
        color?: undefined;
    } | {
        view?: undefined;
        w?: undefined;
        h?: undefined;
        level?: undefined;
        anchor?: undefined;
        kind: string;
        text: string;
        x: number;
        y: number;
        size: number;
        weight: number;
        color: string;
    })[];
};
export declare function parseColor(value: any): number[] | null;
export declare function mixColor(a: any, b: any, p: any): any;
/**
 * The muscle map's fills for the card, worked out the way index.css works them out for .bodymap:
 * the silhouette and an untouched muscle as a little label over the surface, levels 1–4 as more
 * and more accent over that. A semi-transparent label (the light theme's) is flattened onto the
 * surface first.
 */
export declare function mapColors({ label, surface, acc }: {
    acc: any;
    label: any;
    surface: any;
}): {
    sil: any;
    levels: any[];
};
export declare const CARD_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif";
/** One body view's height over its width, from its `vb` ("minX minY width height"). */
export declare const viewAspect: (view: any) => number;
/**
 * Paint a layout. `colors` holds bg, surface, tile, label, label2 and acc as CSS colours — the
 * app's current theme and accent, read off the root element by the caller. `map`, when the
 * layout has a map in it, is `{ body, levels }`: body-paths.js geometry for the profile's body
 * ({ front, back }) and the model's levels.
 */
export declare function drawWorkoutCard(ctx: any, layout: any, colors: any, map?: null, family?: string): void;
