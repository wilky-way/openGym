export declare const LANGS: {
    en: string;
    de: string;
    'de-CH': string;
    es: string;
    fr: string;
    it: string;
    pt: string;
    'pt-BR': string;
    pl: string;
    tr: string;
    ru: string;
    uk: string;
    zh: string;
    'zh-TW': string;
    ko: string;
    hi: string;
    bn: string;
    th: string;
    hu: string;
    ar: string;
};
import { INSTR_LANGS, EXERCISE_NAME_LANGS } from './catalogue-langs.js';
export { INSTR_LANGS, EXERCISE_NAME_LANGS };
export declare const RTL_LANGS: Set<string>;
export declare const DATE_LOCALES: {
    en: string;
    de: string;
    'de-CH': string;
    es: string;
    fr: string;
    it: string;
    pt: string;
    'pt-BR': string;
    pl: string;
    tr: string;
    ru: string;
    uk: string;
    zh: string;
    'zh-TW': string;
    ko: string;
    hi: string;
    bn: string;
    th: string;
    hu: string;
    ar: string;
};
export declare const DERIVED_LOCALES: {
    'de-CH': {
        base: string;
        transform: (s: any) => any;
    };
};
export declare const baseLang: (l: any) => any;
export declare function derivePack(l: any, pack: any): any;
export declare const getLang: () => string;
export declare const dateLocale: () => any;
export declare const getVersion: () => number;
export declare function t(s: any, ...args: any[]): any;
/**
 * A translated count. `one` and `other` are the English source strings, as written at
 * the call site today; `n` picks the form. A pack entry that is an object supplies the
 * forms of the target language, falling back through `other` to the English pair.
 */
export declare function tn(one: any, other: any, n: any, ...rest: any[]): any;
export declare function _detailsFailed(retryMs?: number): void;
export declare const instrFor: (ex: any) => any;
export declare const instrTranslated: (ex: any) => boolean;
export declare const descFor: (ex: any) => any;
export declare function _setDetailsLoader(fn: any): void;
export declare function _setDetails(newEnInstr: any, newEnDescs: any, newDescs: any, forLang?: string): boolean;
export declare const exerciseNameFor: (ex: any) => any;
export declare const CASED_NAME_LANGS: string[];
export declare const exerciseNameClass: (ex: any) => "" | "capitalize";
export declare const exerciseNameSearchText: (ex: any) => any;
export declare function _setLangState(newLang: any, newDict: any, newInstr: any, newExerciseNames: any, showEn?: boolean, enOnlyFlag?: boolean): number;
