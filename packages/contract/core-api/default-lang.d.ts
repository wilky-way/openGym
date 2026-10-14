/** A language tag ('pt-BR', 'pt_br', 'de-AT', 'en-US') as one of LANGS' keys, or null. */
export declare function matchLocale(tag: any): string | null;
/** The language a copy that never chose one should be in, or null for a copy that chose. */
export declare function autoLang(S: any, config: any, navLangs?: any[]): string | null;
export declare function rememberDefaultLang(config: any): void;
/**
 * The language to show this copy in, on this device: its own `lang`, or for a copy that never
 * picked one, what autoLang says. Before the config is in, the default this device last saw
 * stands in for it; with none seen yet the copy's stored language is used unchanged.
 */
export declare function effectiveLang(S: any, config: any, navLangs?: string[]): any;
export declare function browserLangs(): string[];
