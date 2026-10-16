import { EXDB } from './exercises-data.js';
export { EXDB };
export declare const CATALOGUE: Exercise[];
export declare const smOf: (ex: any) => any[];
export declare const EXIDX: ExerciseIndex;
export declare const canonicalExId: (id: any, index?: ExerciseIndex) => any;
export declare const BODYPARTS: any[];
export declare function equipmentOf(list: any): string[];
export declare const CATEGORIES: string[];
export declare function categoriesOf(list: any): string[];
export declare function byCategory(list: any, cat: any): {
    opts: string[];
    on: any;
    list: any;
};
export declare function registerCustom(list?: unknown): ExerciseIndex;
export declare const isCustomEx: (ex: any, index?: ExerciseIndex) => boolean;
export declare function healCustomEx(list: any): any;
export declare const allExercises: (st: any) => any[];
export declare function searchScore(exercise: any, query: any): number;
export declare function matchesExerciseSearch(exercise: any, query: any): boolean;
export declare const figureOf: (S: any) => any;
export declare const imgSrc: (ex: any, figure: any) => any;
export declare const gifSrc: (ex: any, figure: any) => any;
export declare const isVideoSrc: (src: any) => boolean;
export declare const isCardio: (idOrEx?: string | Exercise | null, index?: ExerciseIndex) => boolean;
export declare const isBodyweightEq: (idOrEx?: string | Exercise | null, index?: ExerciseIndex) => boolean;
export declare const isLoadedEq: (idOrEx?: string | Exercise | null, index?: ExerciseIndex) => boolean;
export declare function defaultIncrement(exId: string, unit?: string, index?: ExerciseIndex): 2.5 | 5 | 10;
export declare function isAssisted(idOrEx?: string | Exercise | null, index?: ExerciseIndex): boolean;
/** The better of two loads for this exercise: less assistance, or more weight. */
export declare const betterWeight: (idOrEx: any, a: any, b: any, index?: ExerciseIndex) => number;
/** Is `w` a better load than `prev`? `prev` of 0 means nothing logged yet. */
export declare const beatsWeight: (idOrEx: any, w: any, prev: any, index?: ExerciseIndex) => boolean;
export declare const exOr: (id: string, index?: ExerciseIndex) => Exercise;
export declare const normalizeStr: (s: any) => any;
export declare function matchExercise(e: any, query: any): any;
export declare function searchExercises(list: any, query: any): any;
export declare function similarExercises(list: any, query: any, exclude?: any[], limit?: number): any[];

/** R2: caller-owned index; EXIDX is the catalogue-only default (K03). */
export interface Exercise {
  id?: string; n?: string; bp?: string; tg?: string; eq?: string; mg?: string;
  sm?: string[] | string; st?: string[]; cat?: string; img?: string; gif?: string;
  fv?: string; mv?: string; desc?: string; custom?: boolean; assisted?: boolean;
  primaries?: string[]; secondaries?: string[]; muscleWeights?: Record<string, number>;
  target?: { assisted?: boolean } | null; [key: string]: unknown;
}
declare const CUSTOM_IDS: unique symbol;
export type ExerciseIndex = Readonly<Record<string, Exercise>> & { readonly [CUSTOM_IDS]?: ReadonlySet<unknown> };
export declare function createExerciseIndex(customEx?: unknown): ExerciseIndex;
