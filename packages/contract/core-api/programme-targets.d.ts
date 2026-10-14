export declare function validateSetTarget(target: any): void;
export declare function setTargetAt(cfg: any, index: any): any;
/** A display copy only: authored targets and logged ratings never change. */
export declare function targetForScale(target: any, kind?: string): any;
export declare function targetLabel(target: any, t?: (s: any, n: any) => any, kind?: string): string;
/** Range endpoints reverse when changing scale: RPE 7–8 is RIR 2–3. */
export declare function effortRangeLabel(authoredKind: any, min: any, max?: any, kind?: string): string;
export declare function programmeNote(S: any, cfg: any, context?: { definition?: any; programme?: any }): any;
export declare function programmeQueueLabel(S: any, label?: any): any;
