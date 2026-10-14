export declare const auditCat: (ev: any) => string;
export declare const auditLabel: (ev: any) => any;
export declare const auditReason: (msg: any) => any;
export declare const auditAct: (act: any) => any;
export declare function auditLine(e: any): {
    title: any;
    sub: string;
};
export declare function fmtWhen(ts: any, now?: number): string;
